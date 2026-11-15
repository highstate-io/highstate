import {
  AddLibraryPackageResponseSchema,
  GetLibraryPackageVersionResponseSchema,
  GetProjectLibraryResponseSchema,
  ListLibraryPackageVersionsResponseSchema,
  RemoveLibraryPackageResponseSchema,
  RetryLibrarySnapshotImageResponseSchema,
  SetLocalLibraryOverlayResponseSchema,
  UpdateAllLibraryPackagesResponseSchema,
  UpdateLibraryPackageResponseSchema,
  UpdateProjectPlacementResponseSchema,
} from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { valid } from "semver"
import { humanDetails, humanTable, messageJson } from "../shared/remote"
import { RemoteCommand } from "./remote"

function exactVersion(value: string): string {
  if (valid(value) !== value) {
    throw new Error(`Package version "${value}" must be an exact semantic version`)
  }

  return value
}

abstract class PackageSelectionCommand extends RemoteCommand {
  packageName = Option.String({ required: true })
  version = Option.String({ required: true })
}

export class LibraryPackageAddCommand extends PackageSelectionCommand {
  static paths = [["library", "package", "add"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Adds an exact library package version.",
  })

  async execute(): Promise<void> {
    const version = exactVersion(this.version)
    const { clients, target } = await this.remote()

    const response = await clients.library.addLibraryPackage({
      projectId: target.projectId,
      packageName: this.packageName,
      version,
    })

    const result = messageJson(AddLibraryPackageResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryPackageUpdateCommand extends PackageSelectionCommand {
  static paths = [["library", "package", "update"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Updates a library package to an exact version.",
  })

  async execute(): Promise<void> {
    const version = exactVersion(this.version)
    const { clients, target } = await this.remote()

    const response = await clients.library.updateLibraryPackage({
      projectId: target.projectId,
      packageName: this.packageName,
      version,
    })

    const result = messageJson(UpdateLibraryPackageResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryPackageRemoveCommand extends RemoteCommand {
  static paths = [["library", "package", "remove"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Removes a selected library package.",
  })

  packageName = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()

    const response = await clients.library.removeLibraryPackage({
      projectId: target.projectId,
      packageName: this.packageName,
    })

    const result = messageJson(RemoveLibraryPackageResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryPackageUpdateAllCommand extends RemoteCommand {
  static paths = [["library", "package", "update-all"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Atomically updates all selected library packages.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.updateAllLibraryPackages({ projectId: target.projectId })
    const result = messageJson(UpdateAllLibraryPackagesResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryPackageListCommand extends RemoteCommand {
  static paths = [["library", "package", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists selected exact library packages, including unresolved selections.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getProjectLibrary({ projectId: target.projectId })

    this.print(
      {
        selected_packages: response.selectedPackages.map(value => ({
          package_name: value.packageName,
          version: value.version,
        })),
      },
      humanTable(
        ["PACKAGE", "VERSION"],
        response.selectedPackages.map(value => [value.packageName, value.version]),
        "No selected packages",
      ),
    )
  }
}

export class LibraryPackageVersionsCommand extends RemoteCommand {
  static paths = [["library", "package", "versions"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists available exact package versions.",
  })

  packageName = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()

    const response = await clients.library.listLibraryPackageVersions({
      projectId: target.projectId,
      packageName: this.packageName,
    })

    this.print(
      messageJson(ListLibraryPackageVersionsResponseSchema, response),
      response.versions.join("\n") || "No versions",
    )
  }
}

export class LibraryPackageGetCommand extends RemoteCommand {
  static paths = [["library", "package", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets an evaluated package version by ID or exact package/version pair.",
  })

  id = Option.String({ required: false })
  packageName = Option.String("--package-name")
  version = Option.String("--version")

  async execute(): Promise<void> {
    if (
      this.id
        ? this.packageName !== undefined || this.version !== undefined
        : !this.packageName || !this.version
    ) {
      throw new Error("Provide a package-version ID or both --package-name and --version")
    }

    const version = this.version === undefined ? undefined : exactVersion(this.version)
    const { clients, target } = await this.remote()

    const response = await clients.library.getLibraryPackageVersion({
      projectId: target.projectId,
      libraryPackageVersionId: this.id ?? "",
      packageName: this.packageName,
      version,
    })

    const result = messageJson(GetLibraryPackageVersionResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryStatusCommand extends RemoteCommand {
  static paths = [["library", "status"]]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Shows package selections, snapshot image progress, diagnostics, and local overlay state.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getProjectLibrary({ projectId: target.projectId })
    const result = messageJson(GetProjectLibraryResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

function overlayEnabled(value: string): boolean {
  if (!["enabled", "disabled", "enable", "disable", "true", "false"].includes(value)) {
    throw new Error("Local overlay must be enabled or disabled")
  }

  return ["enabled", "enable", "true"].includes(value)
}

export class LibraryLocalOverlayCommand extends RemoteCommand {
  static paths = [["library", "local-overlay"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Enables or disables the local development library overlay.",
  })

  state = Option.String({ required: true })

  async execute(): Promise<void> {
    const enabled = overlayEnabled(this.state)
    const { clients, target } = await this.remote()

    const response = await clients.library.setLocalLibraryOverlay({
      projectId: target.projectId,
      enabled,
    })

    const result = messageJson(SetLocalLibraryOverlayResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class LibraryRetryCommand extends RemoteCommand {
  static paths = [["library", "retry"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Retries desired library snapshot image materialization.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()

    const response = await clients.library.retryLibrarySnapshotImage({
      projectId: target.projectId,
    })

    const result = messageJson(RetryLibrarySnapshotImageResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}

export class ProjectPlacementCommand extends RemoteCommand {
  static paths = [["project", "placement"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Selects the project container runtime and Pulumi state backend.",
  })

  containerRuntimeId = Option.String("--container-runtime", { required: true })
  pulumiStateBackendId = Option.String("--pulumi-state-backend", { required: true })
  localOverlay = Option.String("--local-overlay")

  async execute(): Promise<void> {
    const localOverlayEnabled =
      this.localOverlay === undefined ? undefined : overlayEnabled(this.localOverlay)

    const { clients, target } = await this.remote()

    const response = await clients.project.updateProjectPlacement({
      projectId: target.projectId,
      containerRuntimeId: this.containerRuntimeId,
      pulumiStateBackendId: this.pulumiStateBackendId,
      localOverlayEnabled,
    })

    const result = messageJson(UpdateProjectPlacementResponseSchema, response)
    this.print(result, humanDetails(result))
  }
}
