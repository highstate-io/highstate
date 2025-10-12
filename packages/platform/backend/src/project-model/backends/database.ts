import type { Logger } from "pino"
import type { DatabaseManager } from "../../database"
import type { ProjectModel, ProjectModelStorageSpec, ProjectOutput } from "../../shared"
import type { ProjectModelBackend } from "../abstractions"
import {
  getInstanceId,
  type HubModel,
  type HubModelPatch,
  hubModelSchema,
  type InstanceModel,
  type InstanceModelPatch,
  instanceModelSchema,
} from "@highstate/contract"
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

/**
 * A project model backend that stores the project models in the project database.
 *
 * Uses the InstanceModel and HubModel tables in the project database.
 */
export class DatabaseProjectModelBackend implements ProjectModelBackend {
  constructor(
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  async getProjectModel(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
  ): Promise<ProjectModel> {
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      const [instanceRecords, hubRecords] = await Promise.all([
        projectDatabase.instanceModel.findMany({
          select: { model: true },
        }),
        projectDatabase.hubModel.findMany({
          select: { model: true },
        }),
      ])

      const instances = instanceRecords.map(record => instanceModelSchema.parse(record.model))
      const hubs = hubRecords.map(record => hubModelSchema.parse(record.model))

      return { instances, hubs }
    } catch (error) {
      throw new ProjectModelOperationError("get project model", project.id, error)
    }
  }

  async createProjectModel(project: ProjectOutput, spec: ProjectModelStorageSpec): Promise<void> {
    assertDatabaseSpec(spec)

    try {
      // for database storage, creating an empty project model means ensuring tables exist
      // the tables are created automatically by Prisma migrations, so nothing to do here
      this.logger.info({ projectId: project.id }, "created project model")
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
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      const existingRecord = await projectDatabase.instanceModel.findUnique({
        where: { id: instanceId },
      })

      if (!existingRecord) {
        throw new ProjectModelInstanceNotFoundError(project.id, instanceId)
      }

      const instance = instanceModelSchema.parse(existingRecord.model)

      // apply patch
      applyInstancePatch(instance, patch)

      // update in database
      await projectDatabase.instanceModel.update({
        where: { id: instanceId },
        data: { model: instance },
      })

      this.logger.info({ projectId: project.id, instanceId }, "updated instance in project model")

      return instance
    } catch (error) {
      throw new ProjectModelOperationError("update instance", project.id, error)
    }
  }

  async deleteInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
  ): Promise<void> {
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      // this is a multi-node operation, so we need a transaction
      await projectDatabase.$transaction(async tx => {
        const existingRecord = await tx.instanceModel.findUnique({
          where: { id: instanceId },
        })

        if (!existingRecord) {
          throw new ProjectModelInstanceNotFoundError(project.id, instanceId)
        }

        // delete the instance
        await tx.instanceModel.delete({
          where: { id: instanceId },
        })

        // get all instances and hubs to clean up references
        const [instanceRecords, hubRecords] = await Promise.all([
          tx.instanceModel.findMany({ select: { id: true, model: true } }),
          tx.hubModel.findMany({ select: { id: true, model: true } }),
        ])

        const instances = instanceRecords.map(record => instanceModelSchema.parse(record.model))
        const hubs = hubRecords.map(record => hubModelSchema.parse(record.model))

        // clean up references
        cleanupInstanceReferences(instances, hubs, instanceId)

        // update modified instances and hubs back to database
        await Promise.all([
          ...instances.map(instance =>
            tx.instanceModel.update({
              where: { id: instance.id },
              data: { model: instance },
            }),
          ),
          ...hubs.map(hub =>
            tx.hubModel.update({
              where: { id: hub.id },
              data: { model: hub },
            }),
          ),
        ])
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
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      // this is a multi-node operation, so we need a transaction
      const renamedInstance = await projectDatabase.$transaction(async tx => {
        const existingRecord = await tx.instanceModel.findUnique({
          where: { id: instanceId },
        })

        if (!existingRecord) {
          throw new ProjectModelInstanceNotFoundError(project.id, instanceId)
        }

        const instance = instanceModelSchema.parse(existingRecord.model)
        const newInstanceId = getInstanceId(instance.type, newName)

        // check if new instance ID already exists
        const conflictRecord = await tx.instanceModel.findUnique({
          where: { id: newInstanceId },
        })

        if (conflictRecord) {
          throw new ProjectModelInstanceAlreadyExistsError(project.id, newInstanceId)
        }

        // update instance
        instance.id = newInstanceId
        instance.name = newName

        // delete old record and create new one
        await tx.instanceModel.delete({ where: { id: instanceId } })
        await tx.instanceModel.create({
          data: { id: newInstanceId, model: instance },
        })

        // get all instances and hubs to update references
        const [instanceRecords, hubRecords] = await Promise.all([
          tx.instanceModel.findMany({ select: { id: true, model: true } }),
          tx.hubModel.findMany({ select: { id: true, model: true } }),
        ])

        const instances = instanceRecords.map(record => instanceModelSchema.parse(record.model))
        const hubs = hubRecords.map(record => hubModelSchema.parse(record.model))

        // update references
        updateInstanceReferences(instances, hubs, instanceId, newInstanceId)

        // update modified instances and hubs back to database
        await Promise.all([
          ...instances.map(inst =>
            tx.instanceModel.update({
              where: { id: inst.id },
              data: { model: inst },
            }),
          ),
          ...hubs.map(hub =>
            tx.hubModel.update({
              where: { id: hub.id },
              data: { model: hub },
            }),
          ),
        ])

        return instance
      })

      this.logger.info(
        { projectId: project.id, oldInstanceId: instanceId, newInstanceId: renamedInstance.id },
        "renamed instance in project model",
      )

      return renamedInstance
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
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      const existingRecord = await projectDatabase.hubModel.findUnique({
        where: { id: hubId },
      })

      if (!existingRecord) {
        throw new ProjectModelHubNotFoundError(project.id, hubId)
      }

      const hub = hubModelSchema.parse(existingRecord.model)

      // apply patch
      applyHubPatch(hub, patch)

      // update in database
      await projectDatabase.hubModel.update({
        where: { id: hubId },
        data: { model: hub },
      })

      this.logger.info({ projectId: project.id, hubId }, "updated hub in project model")

      return hub
    } catch (error) {
      throw new ProjectModelOperationError("update hub", project.id, error)
    }
  }

  async deleteHub(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    hubId: string,
  ): Promise<void> {
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      // this is a multi-node operation, so we need a transaction
      await projectDatabase.$transaction(async tx => {
        const existingRecord = await tx.hubModel.findUnique({
          where: { id: hubId },
        })

        if (!existingRecord) {
          throw new ProjectModelHubNotFoundError(project.id, hubId)
        }

        // delete the hub
        await tx.hubModel.delete({
          where: { id: hubId },
        })

        // get all instances and hubs to clean up references
        const [instanceRecords, hubRecords] = await Promise.all([
          tx.instanceModel.findMany({ select: { id: true, model: true } }),
          tx.hubModel.findMany({ select: { id: true, model: true } }),
        ])

        const instances = instanceRecords.map(record => instanceModelSchema.parse(record.model))
        const hubs = hubRecords.map(record => hubModelSchema.parse(record.model))

        // clean up references
        cleanupHubReferences(instances, hubs, hubId)

        // update modified instances and hubs back to database
        await Promise.all([
          ...instances.map(instance =>
            tx.instanceModel.update({
              where: { id: instance.id },
              data: { model: instance },
            }),
          ),
          ...hubs.map(hub =>
            tx.hubModel.update({
              where: { id: hub.id },
              data: { model: hub },
            }),
          ),
        ])
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
    assertDatabaseSpec(spec)

    try {
      const projectDatabase = await this.database.forProject(project.id)

      // this is a multi-node operation, so we need a transaction
      await projectDatabase.$transaction(async tx => {
        // check for conflicts
        const [conflictingInstance, conflictingHub] = await Promise.all([
          instances.length > 0
            ? tx.instanceModel.findFirst({
                where: { id: { in: instances.map(i => i.id) } },
                select: { id: true },
              })
            : null,
          hubs.length > 0
            ? tx.hubModel.findFirst({
                where: { id: { in: hubs.map(h => h.id) } },
                select: { id: true },
              })
            : null,
        ])

        if (conflictingInstance) {
          throw new ProjectModelInstanceAlreadyExistsError(project.id, conflictingInstance.id)
        }

        if (conflictingHub) {
          throw new ProjectModelHubAlreadyExistsError(project.id, conflictingHub.id)
        }

        // create instances and hubs using createMany
        await Promise.all([
          instances.length > 0
            ? tx.instanceModel.createMany({
                data: instances.map(instance => ({
                  id: instance.id,
                  model: instance,
                })),
              })
            : Promise.resolve(),
          hubs.length > 0
            ? tx.hubModel.createMany({
                data: hubs.map(hub => ({
                  id: hub.id,
                  model: hub,
                })),
              })
            : Promise.resolve(),
        ])
      })

      this.logger.debug(
        { projectId: project.id, instanceCount: instances.length, hubCount: hubs.length },
        "created nodes in project model",
      )
    } catch (error) {
      throw new ProjectModelOperationError("create nodes", project.id, error)
    }
  }
}

/**
 * Type guard and casting helper for database storage spec.
 *
 * @param spec The project model storage specification.
 * @throws Error if spec is not database type.
 */
function assertDatabaseSpec(
  spec: ProjectModelStorageSpec,
): asserts spec is Extract<ProjectModelStorageSpec, { type: "database" }> {
  if (spec.type !== "database") {
    throw new Error(`Expected database spec, got ${spec.type}`)
  }
}
