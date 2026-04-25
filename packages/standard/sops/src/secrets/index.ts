import { Command, MaterializedFile } from "@highstate/common"
import { common, sops } from "@highstate/library"
import { forUnit, makeEntity, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { isNonNullish } from "remeda"

const { name, inputs, secrets, outputs } = forUnit(sops.secrets)

const servers = await toPromise(inputs.servers ?? [])
const secretsData = await toPromise(secrets.data)

if (servers.length === 0) {
  throw new Error("At least one server must be provided")
}

const serversWithSsh = servers.filter(server => server.ssh?.hostKey)
if (serversWithSsh.length === 0) {
  throw new Error("No servers with SSH host keys found")
}

// convert each SSH key to age key
const ageKeys = await toPromise(
  serversWithSsh
    .map(server => server.ssh?.hostKey)
    .filter(isNonNullish)
    .map((hostKey, index) => {
      return new Command(`ssh-to-age-${index}`, {
        host: "local",
        create: `echo "${hostKey}" | ssh-to-age`,
      }).stdout
    }),
)

const file = makeEntity({
  entity: common.fileEntity,
  identity: name,
  value: {
    meta: {
      name: `${name}.json`,
    },
    content: {
      type: "embedded",
      value: JSON.stringify(secretsData, null, 2),
    },
  },
})

const dataFile = MaterializedFile.for(file)

// encrypt secrets using sops
const encryptCommand = new Command("sops-encrypt", {
  host: "local",
  create: `sops encrypt --age ${ageKeys.join(",")} ${dataFile.path}`,
  files: [dataFile],
})

export default outputs({
  file: makeEntityOutput({
    entity: common.fileEntity,
    identity: name,
    value: {
      meta: {
        name: `${name}.json`,
      },
      content: {
        type: "embedded",
        value: encryptCommand.stdout,
      },
    },
  }),
})
