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
import { flat } from "remeda"
import {
  type ArtifactFile,
  artifactArchValues,
  resolveArtifact,
  resolveArtifactFile,
} from "./artifacts"
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
   * The binaries to resolve before running the command.
   *
   * Each artifact will be downloaded to the local Highstate cache, symlinked by its record key
   * into a temporary bin directory, and made available through PATH for the command execution.
   */
  binaries?: Record<string, ArtifactFile>

  /**
   * The files to pass to the command.
   *
   * For now, files are only supported for local commands.
   */
  files?: MaterializedFile[]

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

  /**
   * The permissions to set on the file (e.g. "600").
   *
   * By default, no permissions will be set (the file will be created with the default permissions of the host).
   */
  mode?: Input<string>
}

export type DownloadArtifactCommandArgs = {
  /**
   * The host to download the artifact on.
   */
  host: CommandHost

  /**
   * The host path where the downloaded artifact should be installed.
   */
  path: Input<string>

  /**
   * The permissions to set on the downloaded artifact.
   *
   * By default, the file is installed with 644 permissions.
   */
  mode?: Input<string>
}

export type DetectArtifactArchCommandArgs = {
  /**
   * The host to detect the architecture on.
   */
  host: CommandHost

  /**
   * The logging level for the command.
   */
  logging?: Input<local.Logging>
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

function shellQuotePosix(value: string): string {
  // Wrap a string so it is treated as a single argument by a POSIX shell.
  // This is used when we need to pass a full script to `sh -lc` / `bash -lc`.
  const escaped = value.replaceAll("'", `"'"'"'"`)

  return `'${escaped}'`
}

function assertBinaryName(name: string): void {
  if (!name || name.includes("/")) {
    throw new Error(`Invalid binary name: "${name}"`)
  }
}

function wrapWithBinaries(binaries?: Record<string, ArtifactFile>) {
  if (!binaries || Object.keys(binaries).length === 0) {
    return (command: string) => output(command)
  }

  return (command: string) =>
    output({ command, binaries }).apply(async ({ command, binaries }) => {
      const symlinks: string[] = []

      for (const [name, file] of Object.entries(binaries)) {
        assertBinaryName(name)
        const path = await resolveArtifact(name, file)
        symlinks.push(
          `ln -sf ${shellQuotePosix(path)} "$highstate_bin_dir"/${shellQuotePosix(name)}`,
        )
      }

      return [
        "highstate_bin_dir=$(mktemp -d)",
        "trap 'rm -rf \"$highstate_bin_dir\"' EXIT",
        ...symlinks,
        'export PATH="$highstate_bin_dir:$PATH"',
        command,
      ].join("\n")
    })
}

function getSingleArtifactSha(file: ArtifactFile): string | undefined {
  const entries = Object.entries(file.sha256)
  if (entries.length !== 1) {
    return undefined
  }

  return entries[0][1]
}

function createDownloadScript(url: string, sha256: string, path: string, mode: string): string {
  const quotedPath = shellQuotePosix(path)
  const quotedTempTemplate = shellQuotePosix(`${path}.tmp.XXXXXX`)
  const quotedUrl = shellQuotePosix(url)
  const quotedSha256 = shellQuotePosix(sha256)
  const quotedMode = shellQuotePosix(mode)

  return [
    "set -euo pipefail",
    `install_dir=$(dirname ${quotedPath})`,
    'mkdir -p "$install_dir"',
    `tmp_file=$(mktemp ${quotedTempTemplate})`,
    "trap 'rm -f \"$tmp_file\"' EXIT",
    `curl -fL --retry 3 ${quotedUrl} -o "$tmp_file"`,
    "actual_sha256=$(sha256sum \"$tmp_file\" | awk '{print $1}')",
    `expected_sha256=${quotedSha256}`,
    'if [ "$actual_sha256" != "$expected_sha256" ]; then',
    '  echo "Checksum mismatch: expected=$expected_sha256, actual=$actual_sha256" >&2',
    "  exit 1",
    "fi",
    `install -m ${quotedMode} "$tmp_file" ${quotedPath}`,
  ].join("\n")
}

function detectArtifactArchScript(variableName: string = "artifact_arch"): string {
  return [
    `${variableName}=$(uname -m)`,
    `case "$${variableName}" in`,
    "  x86_64|amd64)",
    `    ${variableName}=amd64`,
    "    ;;",
    "  aarch64|arm64)",
    `    ${variableName}=arm64`,
    "    ;;",
    "  *)",
    `    echo "Unsupported architecture: $${variableName}" >&2`,
    "    exit 1",
    "    ;;",
    "esac",
  ].join("\n")
}

function createArchDownloadScript(file: ArtifactFile, path: string, mode: string): string {
  const cases: string[] = []

  for (const arch of artifactArchValues) {
    const resolved = resolveArtifactFile(file, { arch })
    const sha256 = getSingleArtifactSha(resolved)
    if (!sha256) {
      continue
    }

    cases.push(
      [
        `${arch})`,
        `  artifact_url=${shellQuotePosix(resolved.url)}`,
        `  artifact_sha256=${shellQuotePosix(sha256)}`,
        "  ;;",
      ].join("\n"),
    )
  }

  if (cases.length === 0) {
    throw new Error("Artifact has no matching hashes for supported architectures")
  }

  const quotedPath = shellQuotePosix(path)
  const quotedTempTemplate = shellQuotePosix(`${path}.tmp.XXXXXX`)
  const quotedMode = shellQuotePosix(mode)

  return [
    "set -euo pipefail",
    detectArtifactArchScript("artifact_arch"),
    'case "$artifact_arch" in',
    ...cases,
    "  *)",
    '    echo "Unsupported artifact architecture: $artifact_arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    `install_dir=$(dirname ${quotedPath})`,
    'mkdir -p "$install_dir"',
    `tmp_file=$(mktemp ${quotedTempTemplate})`,
    "trap 'rm -f \"$tmp_file\"' EXIT",
    'curl -fL --retry 3 "$artifact_url" -o "$tmp_file"',
    "actual_sha256=$(sha256sum \"$tmp_file\" | awk '{print $1}')",
    'if [ "$actual_sha256" != "$artifact_sha256" ]; then',
    '  echo "Checksum mismatch: expected=$artifact_sha256, actual=$actual_sha256" >&2',
    "  exit 1",
    "fi",
    `install -m ${quotedMode} "$tmp_file" ${quotedPath}`,
  ].join("\n")
}

function buildLocalCommand(command: InputOrArray<string>, args: CommandArgs): Output<string> {
  return output(command).apply(createCommand).apply(wrapWithBinaries(args.binaries))
}

function buildRemoteCommand(command: InputOrArray<string>, args: CommandArgs): Output<string> {
  return output(command)
    .apply(createCommand)
    .apply(wrapWithWorkDir(args.cwd))
    .apply(wrapWithEnvironment(args.environment))
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

    if (args.binaries && args.host !== "local") {
      throw new Error("Binaries are only supported for local commands")
    }

    const hooks = mergeResourceHooks(args.files?.map(file => file.hooks) ?? [])

    const command =
      args.host === "local"
        ? new local.Command(
            name,
            {
              create: buildLocalCommand(args.create, args),
              update: args.update ? buildLocalCommand(args.update, args) : undefined,
              delete: args.delete ? buildLocalCommand(args.delete, args) : undefined,
              logging: args.logging,
              triggers: args.triggers ? output(args.triggers).apply(flat) : undefined,
              dir: args.cwd ?? homedir(),
              environment,

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
   * Creates a command that prints the target machine architecture.
   *
   * The detected value is normalized to a well-known artifact architecture value.
   *
   * @param name The name of the command resource.
   * @param args The command target options.
   * @param opts Optional resource options.
   * @returns The command resource that prints the normalized architecture.
   */
  static detectArtifactArch(
    name: string,
    args: DetectArtifactArchCommandArgs,
    opts?: ComponentResourceOptions,
  ): Command {
    return new Command(
      name,
      {
        host: args.host,
        create: `${detectArtifactArchScript("artifact_arch")}\nprintf '%s\\n' "$artifact_arch"`,
        logging: args.logging,
      },
      opts,
    )
  }

  /**
   * Creates a command that downloads an artifact and verifies its SHA256 hash.
   *
   * If the artifact URL contains an `arch` parameter, the generated command detects the target
   * architecture and selects the matching URL and hash in the same command execution.
   *
   * @param name The name of the command resource.
   * @param file The artifact file definition from an artifacts manifest.
   * @param args The download target options.
   * @param opts Optional resource options.
   * @returns The command resource that installs the verified artifact.
   */
  static downloadArtifactFile(
    name: string,
    file: Input<ArtifactFile>,
    args: DownloadArtifactCommandArgs,
    opts?: ComponentResourceOptions,
  ): Command {
    const command = output({ file, path: args.path, mode: args.mode ?? "644" }).apply(
      ({ file, path, mode }) => {
        const resolved = resolveArtifactFile(file)
        const sha256 = getSingleArtifactSha(resolved)
        if (sha256) {
          return createDownloadScript(resolved.url, sha256, path, mode)
        }

        return createArchDownloadScript(file, path, mode)
      },
    )

    return new Command(
      name,
      {
        host: args.host,
        create: command,
        update: command,
        delete: interpolate`rm -f ${args.path}`,
        updateTriggers: [file, args.path, args.mode ?? "644"],
      },
      opts,
    )
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
    const create = output(options.mode).apply(mode =>
      mode
        ? interpolate`mkdir -p $(dirname "${options.path}") && cat > ${options.path} && chmod ${mode} ${options.path}`
        : interpolate`mkdir -p $(dirname "${options.path}") && cat > ${options.path}`,
    )

    return new Command(
      name,
      {
        host: options.host,
        create,
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
