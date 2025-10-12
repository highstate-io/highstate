import type { common, ssh } from "@highstate/library"
import { homedir } from "node:os"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputOrArray,
  interpolate,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { sha256 } from "@noble/hashes/sha2"
import { local, remote, type types } from "@pulumi/command"
import { flat } from "remeda"
import { l3EndpointToString } from "./network"

/**
 * Creates a connection object for the given SSH credentials.
 *
 * @param ssh The SSH credentials.
 * @returns An output connection object for Pulumi remote commands.
 */
export function getServerConnection(
  ssh: Input<ssh.Connection>,
): Output<types.input.remote.ConnectionArgs> {
  return output(ssh).apply(ssh => ({
    host: l3EndpointToString(ssh.endpoints[0]),
    port: ssh.endpoints[0].port,
    user: ssh.user,
    password: ssh.password,
    privateKey: ssh.keyPair?.privateKey,
    dialErrorLimit: 3,
    hostKey: ssh.hostKey,
  }))
}

export type CommandHost = "local" | Input<common.Server>
export type CommandRunMode = "auto" | "prefer-host"

export type CommandArgs = {
  /**
   * The host to run the command on.
   *
   * Can be "local" for local execution or a server object for remote execution.
   */
  host: CommandHost

  /**
   * The command to run when the resource is created.
   *
   * If an array is provided, it will be joined with spaces.
   */
  create: InputOrArray<string>

  /**
   * The command to run when the resource is updated or one of the triggers changes.
   *
   * If not set, the `create` command will be used.
   */
  update?: InputOrArray<string>

  /**
   * The command to run when the resource is deleted.
   */
  delete?: InputOrArray<string>

  /**
   * The stdin content to pass to the command.
   */
  stdin?: Input<string>

  /**
   * The logging level for the command.
   */
  logging?: Input<local.Logging>

  /**
   * The triggers for the command.
   *
   * They will be captured in the command's state and will trigger the command to run again
   * if they change.
   */
  triggers?: InputOrArray<unknown>

  /**
   * The update triggers for the command.
   *
   * Unlike `triggers`, which replace the entire resource on change, these will only trigger the `update` command.
   *
   * Under the hood, it is implemented using a hash of the provided values and passing it as environment variable.
   * It is recommended to pass only primitive values (strings, numbers, booleans) or small objects/arrays for proper serialization.
   */
  updateTriggers?: InputOrArray<unknown>

  /**
   * The working directory for the command.
   *
   * If not set, the command will run in the user's home directory (for both local and remote hosts).
   */
  cwd?: Input<string>

  /**
   * The environment variables to set for the command.
   */
  environment?: Input<Record<string, Input<string>>>

  /**
   * The run mode for the command.
   *
   * - `auto` (default): if the `image` is set, it will always run in a container, never on the host;
   * otherwise, it will run on the host.
   *
   * - `prefer-host`: it will try to run on the host if the executable is available;
   * otherwise, it will run in a container or throw an error if the `image` is not set.
   */
  runMode?: CommandRunMode

  /**
   * The container image to use to run the command.
   */
  image?: Input<string>

  /**
   * The paths to mount if the command runs in a container.
   *
   * They will be mounted to the same paths in the container.
   */
  mounts?: InputOrArray<string>
}

export type TextFileArgs = {
  /**
   * The host to run the command on.
   */
  host: CommandHost

  /**
   * The absolute path to the file on the host.
   */
  path: Input<string>

  /**
   * The content to write to the file.
   */
  content: Input<string>
}

export type WaitForArgs = CommandArgs & {
  /**
   * The timeout in seconds to wait for the command to complete.
   *
   * Defaults to 5 minutes (300 seconds).
   */
  timeout?: Input<number>

  /**
   * The interval in seconds to wait between checks.
   *
   * Defaults to 5 seconds.
   */
  interval?: Input<number>
}

function createCommand(command: string | string[]): string {
  if (Array.isArray(command)) {
    return command.join(" ")
  }

  return command
}

function wrapWithWorkDir(dir?: Input<string>) {
  if (!dir) {
    return (command: string) => output(command)
  }

  return (command: string) => interpolate`cd "${dir}" && ${command}`
}

function wrapWithEnvironment(environment?: Input<Record<string, Input<string>>>) {
  if (!environment) {
    return (command: string) => output(command)
  }

  return (command: string) =>
    output({ command, environment }).apply(({ command, environment }) => {
      if (!environment || Object.keys(environment).length === 0) {
        return command
      }

      const envExport = Object.entries(environment)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join(" && ")

      return `${envExport} && ${command}`
    })
}

function wrapWithWaitFor(timeout: Input<number> = 300, interval: Input<number> = 5) {
  return (command: string | string[]) =>
    // TOD: escape the command
    interpolate`timeout ${timeout} bash -c 'while ! ${createCommand(command)}; do sleep ${interval}; done'`
}

function applyUpdateTriggers(
  env: Input<Record<string, Input<string>>> | undefined,
  triggers: InputOrArray<unknown> | undefined,
) {
  return output({ env, triggers }).apply(({ env, triggers }) => {
    if (!triggers) {
      return env
    }

    const hash = sha256(JSON.stringify(triggers))
    const hashHex = Buffer.from(hash).toString("hex")

    return {
      ...env,
      HIGHSTATE_UPDATE_TRIGGER_HASH: hashHex,
    }
  })
}

export class Command extends ComponentResource {
  public readonly stdout: Output<string>
  public readonly stderr: Output<string>

  constructor(name: string, args: CommandArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:Command", name, args, opts)

    const environment = applyUpdateTriggers(
      args.environment,
      args.updateTriggers,
    ) as local.CommandArgs["environment"]

    const command =
      args.host === "local"
        ? new local.Command(
            name,
            {
              create: output(args.create).apply(createCommand),
              update: args.update ? output(args.update).apply(createCommand) : undefined,
              delete: args.delete ? output(args.delete).apply(createCommand) : undefined,
              logging: args.logging,
              triggers: args.triggers ? output(args.triggers).apply(flat) : undefined,
              dir: args.cwd ?? homedir(),
              environment,
              stdin: args.stdin,
              addPreviousOutputInEnv: false,
            },
            { ...opts, parent: this },
          )
        : new remote.Command(
            name,
            {
              connection: output(args.host).apply(server => {
                if (!server.ssh) {
                  throw new Error(`The server "${server.hostname}" has no SSH credentials`)
                }

                return getServerConnection(server.ssh)
              }),

              create: output(args.create)
                .apply(createCommand)
                .apply(wrapWithWorkDir(args.cwd))
                .apply(wrapWithEnvironment(environment)),

              update: args.update
                ? output(args.update)
                    .apply(createCommand)
                    .apply(wrapWithWorkDir(args.cwd))
                    .apply(wrapWithEnvironment(environment))
                : undefined,

              delete: args.delete
                ? output(args.delete)
                    .apply(createCommand)
                    .apply(wrapWithWorkDir(args.cwd))
                    .apply(wrapWithEnvironment(environment))
                : undefined,

              logging: args.logging,
              triggers: args.triggers ? output(args.triggers).apply(flat) : undefined,
              stdin: args.stdin,

              addPreviousOutputInEnv: false,

              // TODO: does not work if server do not define AcceptEnv
              // environment,
            },
            { ...opts, parent: this },
          )

    this.stdout = command.stdout
    this.stderr = command.stderr

    this.registerOutputs({
      stdout: this.stdout,
      stderr: this.stderr,
    })
  }

  /**
   * Waits for the command to complete and returns its output.
   * The standard output will be returned.
   */
  async wait(): Promise<string> {
    return await toPromise(this.stdout)
  }

  /**
   * Creates a command that writes the given content to a file on the host.
   * The file will be created if it does not exist, and overwritten if it does.
   *
   * Use for small text files like configuration files.
   */
  static createTextFile(
    name: string,
    options: TextFileArgs,
    opts?: ComponentResourceOptions,
  ): Command {
    return new Command(
      name,
      {
        host: options.host,
        create: interpolate`mkdir -p $(dirname "${options.path}") && cat > ${options.path}`,
        delete: interpolate`rm -rf ${options.path}`,
        stdin: options.content,
      },
      opts,
    )
  }

  /**
   * Creates a command that waits for a file to be created and then reads its content.
   * This is useful for waiting for a file to be generated by another process.
   *
   * Use for small text files like configuration files.
   */
  static receiveTextFile(
    name: string,
    options: Omit<TextFileArgs, "content">,
    opts?: ComponentResourceOptions,
  ): Command {
    return new Command(
      name,
      {
        host: options.host,
        create: interpolate`while ! test -f "${options.path}"; do sleep 1; done; cat "${options.path}"`,
        logging: "stderr",
      },
      opts,
    )
  }

  /**
   * Creates a command that waits for a condition to be met.
   * The command will run until the condition is met or the timeout is reached.
   *
   * The condition is considered met if the command returns a zero exit code.
   *
   * @param name The name of the command resource.
   * @param args The arguments for the command, including the condition to check.
   * @param opts Optional resource options.
   */
  static waitFor(name: string, args: WaitForArgs, opts?: ComponentResourceOptions): Command {
    return new Command(
      name,
      {
        ...args,
        create: output(args.create).apply(wrapWithWaitFor(args.timeout, args.interval)),
        update: args.update
          ? output(args.update).apply(wrapWithWaitFor(args.timeout, args.interval))
          : undefined,
        delete: args.delete
          ? output(args.delete).apply(wrapWithWaitFor(args.timeout, args.interval))
          : undefined,
      },
      opts,
    )
  }
}
