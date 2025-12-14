import {
  Command,
  createSshHostKeyFile,
  createSshTerminal,
  l3EndpointToString,
  MaterializedFile,
} from "@highstate/common"
import { MaterializedRepository } from "@highstate/git"
import { nixos } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(nixos.system)

const { flake, server } = await toPromise(inputs)

if (!server.ssh) {
  throw new Error("Server must have an SSH endpoint defined")
}

const repo = await MaterializedRepository.open(flake)
await repo.git.add(".")

const privateKey = await MaterializedFile.create(
  "private-key",
  server.ssh.keyPair?.privateKey,
  0o600,
)

const hostKey = await MaterializedFile.open(createSshHostKeyFile(server))

const system = args.system ?? server.hostname

await new Command("system", {
  host: "local",

  // install the system using nixos-anywhere if not already installed
  create: [
    "nixos-anywhere",
    `--flake ${repo.path}#${system}`,
    `-i ${privateKey.path}`,
    `--target-host ${server.ssh.user}@${l3EndpointToString(server.ssh.endpoints[0])}`,
    `--ssh-port ${server.ssh.endpoints[0].port}`,
    "--copy-host-keys",
  ],

  // switch to the latest configuration on every update
  update: [
    `NIX_SSHOPTS="${[
      `-o IdentityFile=${privateKey.path}`,
      `-o StrictHostKeyChecking=yes`,
      `-o UserKnownHostsFile=${hostKey.path}`,
      `-p ${server.ssh.endpoints[0].port}`,
    ].join(" ")}"`,

    "nixos-rebuild",
    "switch",
    `--flake ${repo.path}#${system}`,
    `--use-remote-sudo`,
    `--target-host ${server.ssh.user}@${l3EndpointToString(server.ssh.endpoints[0])}`,
  ],
}).wait()

export default outputs({
  server: inputs.server,

  $terminals: [createSshTerminal(server.ssh)],
})
