import { Builtins, Cli } from "clipanion"
import {
  BackendIdentityCommand,
  BackendUnlockMethodAddCommand,
  BackendUnlockMethodDeleteCommand,
  BackendUnlockMethodListCommand,
  BuildCommand,
  ComponentGetCommand,
  ComponentListCommand,
  ComponentSchemaCommand,
  ContextAddCommand,
  ContextDeleteCommand,
  ContextListCommand,
  ContextShowCommand,
  ContextTestCommand,
  ContextUseCommand,
  DesignerCommand,
  EntityGetCommand,
  EntityListCommand,
  HubCreateCommand,
  HubDeleteCommand,
  HubGetCommand,
  HubListCommand,
  HubUpdateCommand,
  InitCommand,
  InstanceCreateCommand,
  InstanceDeleteCommand,
  InstanceGetCommand,
  InstanceListCommand,
  InstanceRenameCommand,
  InstanceUpdateCommand,
  LibraryListCommand,
  ModelCreateCommand,
  ModelGetCommand,
  OperationCancelCommand,
  OperationCancelInstanceCommand,
  OperationGetCommand,
  OperationLaunchCommand,
  OperationListCommand,
  OperationLogsCommand,
  OperationPlanCommand,
  OperationRunCommand,
  OperationWaitCommand,
  PackageCreateCommand,
  PackageListCommand,
  PackageRemoveCommand,
  PackageUpdateReferencesCommand,
  ProjectGetCommand,
  ProjectListCommand,
  ProjectUnsetCommand,
  ProjectUseCommand,
  StateGetCommand,
  StateListCommand,
  UpdateCommand,
} from "./commands"
import { readCurrentPackageVersion } from "./shared"

const version = await readCurrentPackageVersion(import.meta.url)

const cli = new Cli({
  binaryName: "highstate",
  binaryLabel: "Highstate",
  binaryVersion: version,
})

cli.register(BuildCommand)
cli.register(DesignerCommand)
cli.register(InitCommand)
cli.register(UpdateCommand)
cli.register(BackendIdentityCommand)
cli.register(BackendUnlockMethodListCommand)
cli.register(BackendUnlockMethodAddCommand)
cli.register(BackendUnlockMethodDeleteCommand)
cli.register(ContextAddCommand)
cli.register(ContextListCommand)
cli.register(ContextShowCommand)
cli.register(ContextUseCommand)
cli.register(ContextDeleteCommand)
cli.register(ContextTestCommand)
cli.register(ProjectListCommand)
cli.register(ProjectGetCommand)
cli.register(ProjectUseCommand)
cli.register(ProjectUnsetCommand)
cli.register(LibraryListCommand)
cli.register(ComponentListCommand)
cli.register(ComponentGetCommand)
cli.register(ComponentSchemaCommand)
cli.register(EntityListCommand)
cli.register(EntityGetCommand)
cli.register(ModelGetCommand)
cli.register(ModelCreateCommand)
cli.register(InstanceListCommand)
cli.register(InstanceGetCommand)
cli.register(InstanceCreateCommand)
cli.register(InstanceUpdateCommand)
cli.register(InstanceRenameCommand)
cli.register(InstanceDeleteCommand)
cli.register(HubListCommand)
cli.register(HubGetCommand)
cli.register(HubCreateCommand)
cli.register(HubUpdateCommand)
cli.register(HubDeleteCommand)
cli.register(StateListCommand)
cli.register(StateGetCommand)
cli.register(OperationPlanCommand)
cli.register(OperationLaunchCommand)
cli.register(OperationRunCommand)
cli.register(OperationListCommand)
cli.register(OperationGetCommand)
cli.register(OperationWaitCommand)
cli.register(OperationLogsCommand)
cli.register(OperationCancelCommand)
cli.register(OperationCancelInstanceCommand)
cli.register(PackageUpdateReferencesCommand)
cli.register(PackageListCommand)
cli.register(PackageCreateCommand)
cli.register(PackageRemoveCommand)
cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

await cli.runExit(process.argv.slice(2))
