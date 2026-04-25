import type { common, ssh } from "@highstate/library"
import type { MaterializedFile } from "./files"
import { homedir } from "node:os"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  type InputOrArray,
  interpolate,
  mergeOptions,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { sha256 } from "@noble/hashes/sha2"
import { local, remote, type types } from "@pulumi/command"
import { flat, isNonNullish } from "remeda"
import { mergeResourceHooks } from "./lifetime"
import { l3EndpointToString } from "./network/endpoints"

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
    password: ssh.password?.value,
    privateKey: ssh.keyPair?.privateKey.value,
    dialErrorLimit: 3,
    hostKey: ssh.hostKey,
  }))
}

export type CommandHost = "local" | Input<common.Server>
export type CommandRunMode = "auto" | "prefer-host"

export type CommandContainerShell = "none" | "sh" | "bash"

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
  triggers?: InputArray<unknown>

  /**
   * The update triggers for the command.
   *
   * Unlike `triggers`, which replace the entire resource on change, these will only trigger the `update` command.
   *
   * Under the hood, it is implemented using a hash of the provided values and passing it as environment variable.
   * It is recommended to pass only primitive values (strings, numbers, booleans) or small objects/arrays for proper serialization.
   */
  updateTriggers?: InputArray<unknown>

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
   * The container image to use to run the command.
   */
  image?: Input<string>

  /**
   * How to execute the command inside the container.
   *
   * - "none" runs the command as container argv (default).
   *   This preserves ENTRYPOINT-style images.
   * - "sh" runs `sh -lc '<command>'` inside the container.
   * - "bash" runs `bash -lc '<command>'` inside the container.
   *
   * Use a shell mode when the command relies on shell features like pipes,
   * redirects, globbing, or compound statements.
   */
  containerShell?: CommandContainerShell

  /**
   * Whether to run the command with host network (only applicable for container commands).
   */
  hostNetwork?: boolean

  /**
   * The files to pass to the command.
   *
   * They will we automatically materialized when command is executed + mounted in the container if `image` is set.
   *
   * For now, files are only supported for local commands.
   */
  files?: MaterializedFile[]

  /**
   * The paths to mount if the command runs in a container.
   *
   * They will be mounted to the same paths in the container.
   */
  mounts?: InputArray<string>

  /**
   * Whether to ignore all changes to the command's create, update, and delete properties.
   *
   * You can still trigger the command rerun by changing the triggers or updateTriggers.
   *
   * By default, this option is set to `true`.
   */
  ignoreCommandChanges?: boolean
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

function wrapWithWorkDir(dir?: Input<string>, image?: Input<string>) {
  if (image) {
    // do not wrap with work dir for container commands, as the command will be run with -w option
    return (command: string) => output(command)
  }

  if (!dir) {
    return (command: string) => output(command)
  }

  return (command: string) => interpolate`cd "${dir}" && ${command}`
}

function wrapWithEnvironment(
  environment?: Input<Record<string, Input<string>>>,
  image?: Input<string>,
) {
  if (image) {
    // do not wrap with environment for container commands, as the command will be run with -e option
    return (command: string) => output(command)
  }

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

function shellQuotePosix(value: string): string {
  // Wrap a string so it is treated as a single argument by a POSIX shell.
  // This is used when we need to pass a full script to `sh -lc` / `bash -lc`.
  const escaped = value.replaceAll("'", `"'"'"'"`)

  return `'${escaped}'`
}

function wrapWithPodman(
  dir?: Input<string>,
  environment?: Input<Record<string, Input<string>>>,
  image?: Input<string> | undefined,
  mounts?: InputOrArray<string> | undefined,
  shell?: CommandContainerShell | undefined,
  hostNetwork?: boolean | undefined,
  stdin?: Input<string>,
  files?: MaterializedFile[] | undefined,
) {
  if (!image) {
    return (command: string) => output(command)
  }

  return (command: string) =>
    output({ command, image, mounts, stdin, files }).apply(({ command, image, mounts, files }) => {
      const allMounts = [...(mounts ?? []), ...(files?.map(file => file.path) ?? [])]

      const mountsArgs = allMounts
        .filter(isNonNullish)
        .map(mount => `-v ${mount}:${mount}`)
        .join(" ")

      const workDirArg = dir ? `-w ${dir}` : ""

      const envArgs = environment
        ? Object.entries(environment)
            .map(([key, value]) => `-e ${key}="${value}"`)
            .join(" ")
        : ""

      const hostNetworkArg = hostNetwork ? "--network host" : ""
      const stdinArg = stdin ? "-i" : ""

      const containerShell = shell ?? "none"
      if (containerShell !== "none") {
        const shellBinary = containerShell
        const shellCommand = shellQuotePosix(command)

        return `podman run --rm ${workDirArg} ${envArgs} ${mountsArgs} ${hostNetworkArg} ${stdinArg} ${image} ${shellBinary} -lc ${shellCommand}`
      }

      return `podman run --rm ${workDirArg} ${envArgs} ${mountsArgs} ${hostNetworkArg} ${stdinArg} ${image} ${command}`
    })
}

function buildLocalCommand(
  command: InputOrArray<string>,
  args: CommandArgs,
  files?: MaterializedFile[] | undefined,
): Output<string> {
  return output(command)
    .apply(createCommand)
    .apply(
      wrapWithPodman(
        args.cwd,
        args.environment,
        args.image,
        args.mounts,
        args.containerShell,
        args.hostNetwork,
        args.stdin,
        files,
      ),
    )
}

function buildRemoteCommand(command: InputOrArray<string>, args: CommandArgs): Output<string> {
  return output(command)
    .apply(createCommand)
    .apply(wrapWithWorkDir(args.cwd, args.image))
    .apply(wrapWithEnvironment(args.environment, args.image))
    .apply(
      wrapWithPodman(
        args.cwd,
        args.environment,
        args.image,
        args.mounts,
        args.containerShell,
        args.hostNetwork,
        args.stdin,
      ),
    )
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

    if (args.files && args.files.length > 0 && args.host !== "local") {
      throw new Error("Files are only supported for local commands")
    }

    const hooks = mergeResourceHooks(args.files?.map(file => file.hooks) ?? [])

    const command =
      args.host === "local"
        ? new local.Command(
            name,
            {
              create: buildLocalCommand(args.create, args, args.files),
              update: args.update ? buildLocalCommand(args.update, args) : undefined,
              delete: args.delete ? buildLocalCommand(args.delete, args) : undefined,
              logging: args.logging,
              triggers: args.triggers ? output(args.triggers).apply(flat) : undefined,

              // don't set working directory for container commands, as it will be passed in the command itself
              dir: args.image ? undefined : (args.cwd ?? homedir()),

              // don't pass environment for container commands, as it will be passed in the command itself
              environment: args.image ? undefined : environment,

              stdin: args.stdin,
              addPreviousOutputInEnv: false,
            },
            mergeOptions(opts, {
              parent: this,
              ignoreChanges:
                args.ignoreCommandChanges !== false ? ["create", "update", "delete"] : undefined,
              hooks,
            }),
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

              create: buildRemoteCommand(args.create, args),
              update: args.update ? buildRemoteCommand(args.update, args) : undefined,
              delete: args.delete ? buildRemoteCommand(args.delete, args) : undefined,

              logging: args.logging,
              triggers: args.triggers ? output(args.triggers).apply(flat) : undefined,
              stdin: args.stdin,

              addPreviousOutputInEnv: false,
            },
            mergeOptions(opts, {
              parent: this,
              ignoreChanges:
                args.ignoreCommandChanges !== false ? ["create", "update", "delete"] : undefined,
            }),
          )

    this.stdout = command.stdout
    this.stderr = command.stderr
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
