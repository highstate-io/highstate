import type { Logger } from "pino"
import type { ProjectModel, ProjectModelStorageSpec, ProjectOutput } from "../../shared"
import type { ProjectModelBackend } from "../abstractions"
import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  getInstanceId,
  type HubModel,
  type HubModelPatch,
  hubModelSchema,
  type InstanceModel,
  type InstanceModelPatch,
  instanceModelSchema,
} from "@highstate/contract"
import { BetterLock } from "better-lock"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { resolveMainLocalProject } from "../../common"
import {
  ProjectModelHubAlreadyExistsError,
  ProjectModelHubNotFoundError,
  ProjectModelInstanceAlreadyExistsError,
  ProjectModelInstanceNotFoundError,
  ProjectModelOperationError,
} from "../errors"
import {
  applyHubPatch,
  applyInstancePatch,
  cleanupHubReferences,
  cleanupInstanceReferences,
  updateInstanceReferences,
} from "../utils"

const codebaseProjectDataSchema = z.object({
  instances: z.record(z.string(), instanceModelSchema),
  hubs: z.record(z.string(), hubModelSchema),
})

/**
 * A project model backend that stores the project models locally on disk.
 *
 * By default, the project models are stored in the `projects` directory near the "package.json" file.
 */
export class CodebaseProjectModelBackend implements ProjectModelBackend {
  private readonly lock = new BetterLock()

  constructor(
    private readonly projectsDir: string,
    private readonly logger: Logger,
  ) {}

  async getProjectModel(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
  ): Promise<ProjectModel> {
    assertCodebaseSpec(spec)

    try {
      const projectData = await this.loadProject(project.name)

      return {
        instances: Object.values(projectData.instances),
        hubs: Object.values(projectData.hubs),
      }
    } catch (error) {
      throw new ProjectModelOperationError("get project model", project.id, error)
    }
  }

  async createProjectModel(project: ProjectOutput, spec: ProjectModelStorageSpec): Promise<void> {
    assertCodebaseSpec(spec)

    try {
      const projectPath = this.getProjectPath(project.name)

      // check if project file already exists
      try {
        await access(projectPath, constants.F_OK)
        throw new Error(`Project "${project.name}" already exists`)
      } catch (error) {
        // if access throws ENOENT, file doesn't exist (which is what we want)
        if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
          throw error
        }
      }

      await this.withProject(project.name, () => {
        // create an empty project
        return { instances: {}, hubs: {} }
      })

      this.logger.info(
        { projectId: project.id, projectName: project.name },
        "created project model",
      )
    } catch (error) {
      throw new ProjectModelOperationError("create project model", project.id, error)
    }
  }

  async updateInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
    patch: InstanceModelPatch,
  ): Promise<InstanceModel> {
    assertCodebaseSpec(spec)

    try {
      return await this.withInstance(project.id, project.name, instanceId, instance => {
        applyInstancePatch(instance, patch)
        return instance
      })
    } catch (error) {
      throw new ProjectModelOperationError("update instance", project.id, error)
    }
  }

  async deleteInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
  ): Promise<void> {
    assertCodebaseSpec(spec)

    try {
      await this.withProject(project.name, projectData => {
        if (!projectData.instances[instanceId]) {
          throw new ProjectModelInstanceNotFoundError(project.id, instanceId)
        }

        delete projectData.instances[instanceId]

        cleanupInstanceReferences(
          Object.values(projectData.instances),
          Object.values(projectData.hubs),
          instanceId,
        )
      })

      this.logger.info({ projectId: project.id, instanceId }, "deleted instance from project model")
    } catch (error) {
      throw new ProjectModelOperationError("delete instance", project.id, error)
    }
  }

  async renameInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
    newName: string,
  ): Promise<InstanceModel> {
    assertCodebaseSpec(spec)

    try {
      return await this.withProject(project.name, projectData => {
        // rename the instance
        const instance = projectData.instances[instanceId]
        if (!instance) {
          throw new ProjectModelInstanceNotFoundError(project.id, instanceId)
        }

        const newInstanceId = getInstanceId(instance.type, newName)
        if (projectData.instances[newInstanceId]) {
          throw new ProjectModelInstanceAlreadyExistsError(project.id, newInstanceId)
        }

        delete projectData.instances[instanceId]
        instance.id = newInstanceId
        instance.name = newName
        projectData.instances[newInstanceId] = instance

        updateInstanceReferences(
          Object.values(projectData.instances),
          Object.values(projectData.hubs),
          instanceId,
          instance.id,
        )

        this.logger.info(
          { projectId: project.id, oldInstanceId: instanceId, newInstanceId: instance.id },
          "renamed instance in project model",
        )

        return instance
      })
    } catch (error) {
      throw new ProjectModelOperationError("rename instance", project.id, error)
    }
  }

  async updateHub(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    hubId: string,
    patch: HubModelPatch,
  ): Promise<HubModel> {
    assertCodebaseSpec(spec)

    try {
      return await this.withProject(project.name, projectData => {
        const hub = projectData.hubs[hubId]
        if (!hub) {
          throw new ProjectModelHubNotFoundError(project.id, hubId)
        }

        applyHubPatch(hub, patch)

        this.logger.info({ projectId: project.id, hubId }, "updated hub in project model")

        return hub
      })
    } catch (error) {
      throw new ProjectModelOperationError("update hub", project.id, error)
    }
  }

  async deleteHub(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    hubId: string,
  ): Promise<void> {
    assertCodebaseSpec(spec)

    try {
      await this.withProject(project.name, projectData => {
        if (!projectData.hubs[hubId]) {
          throw new ProjectModelHubNotFoundError(project.id, hubId)
        }

        delete projectData.hubs[hubId]

        cleanupHubReferences(
          Object.values(projectData.instances),
          Object.values(projectData.hubs),
          hubId,
        )
      })

      this.logger.info({ projectId: project.id, hubId }, "deleted hub from project model")
    } catch (error) {
      throw new ProjectModelOperationError("delete hub", project.id, error)
    }
  }

  async createNodes(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instances: InstanceModel[],
    hubs: HubModel[],
  ): Promise<void> {
    assertCodebaseSpec(spec)

    try {
      await this.withProject(project.name, projectData => {
        // ensure that instances and hubs do not conflict with existing ones
        for (const instance of instances) {
          if (projectData.instances[instance.id]) {
            throw new ProjectModelInstanceAlreadyExistsError(project.id, instance.id)
          }
          projectData.instances[instance.id] = instance
        }

        for (const hub of hubs) {
          if (projectData.hubs[hub.id]) {
            throw new ProjectModelHubAlreadyExistsError(project.id, hub.id)
          }
          projectData.hubs[hub.id] = hub
        }

        return {}
      })

      this.logger.debug(
        { projectId: project.id, instanceCount: instances.length, hubCount: hubs.length },
        "created nodes in project model",
      )
    } catch (error) {
      throw new ProjectModelOperationError("create nodes", project.id, error)
    }
  }

  private getProjectPath(projectName: string) {
    return `${this.projectsDir}/${projectName}.yaml`
  }

  private async loadProject(projectName: string) {
    const projectPath = this.getProjectPath(projectName)

    try {
      const content = await readFile(projectPath, "utf-8")

      return codebaseProjectDataSchema.parse(parse(content))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { instances: {}, hubs: {} }
      }

      throw error
    }
  }

  private async writeProject(
    projectName: string,
    project: z.infer<typeof codebaseProjectDataSchema>,
  ) {
    const projectPath = this.getProjectPath(projectName)
    const content = stringify(project, undefined, 2)

    await writeFile(projectPath, content)
  }

  private async withInstance<T>(
    projectId: string,
    projectName: string,
    instanceId: string,
    callback: (instance: InstanceModel) => T,
  ): Promise<T> {
    return await this.withProject(projectName, projectData => {
      const instance = projectData.instances[instanceId]
      if (!instance) {
        throw new ProjectModelInstanceNotFoundError(projectId, instanceId)
      }

      return callback(instance)
    })
  }

  private async withProject<T>(
    projectName: string,
    callback: (project: z.infer<typeof codebaseProjectDataSchema>) => T,
  ): Promise<T> {
    return await this.lock.acquire(projectName, async () => {
      const projectData = await this.loadProject(projectName)

      const result = callback(projectData)
      await this.writeProject(projectName, projectData)

      return result
    })
  }

  public static async create(logger: Logger): Promise<CodebaseProjectModelBackend> {
    const [mainProjectPath] = await resolveMainLocalProject()
    const projectsPath = resolve(mainProjectPath, "projects")

    await mkdir(projectsPath, { recursive: true })

    return new CodebaseProjectModelBackend(projectsPath, logger)
  }
}

/**
 * Type guard and casting helper for codebase storage spec.
 *
 * @param spec The project model storage specification.
 * @throws Error if spec is not codebase type.
 */
function assertCodebaseSpec(
  spec: ProjectModelStorageSpec,
): asserts spec is Extract<ProjectModelStorageSpec, { type: "codebase" }> {
  if (spec.type !== "codebase") {
    throw new Error(`Expected codebase spec, got ${spec.type}`)
  }
}
