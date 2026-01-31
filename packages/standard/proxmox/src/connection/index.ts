import type { UnitTerminal } from "@highstate/contract"
import type { Output } from "@highstate/pulumi"
import { createServerBundle, parseEndpoint } from "@highstate/common"
import { type common, proxmox, type ssh } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { cluster, Provider, storage } from "@muhlba91/pulumi-proxmoxve"

const { name, args, secrets, inputs, outputs } = forUnit(proxmox.connection)

const provider = await toPromise(
  output({ args, secrets }).apply(({ args, secrets }) => {
    return new Provider("proxmox", {
      endpoint: args.endpoint,
      insecure: args.insecure,

      username: args.username,
      password: secrets.sshPassword,

      apiToken: secrets.apiToken,
    })
  }),
)

const nodes = await cluster.getNodes({ provider })
if (nodes.names.length === 0) {
  throw new Error("No nodes found")
}

const nodeName = args.defaultNodeName ?? nodes.names[0]
if (!nodes.names.includes(nodeName)) {
  throw new Error(`Node "${nodeName}" not found in the cluster`)
}

const datastores = await storage.getDatastores({ nodeName }, { provider })
if (datastores.datastoreIds.length === 0) {
  throw new Error(`No datastores found in the node "${nodeName}"`)
}

const datastoreId = args.defaultDatastoreId ?? datastores.datastoreIds[0]
if (!datastores.datastoreIds.includes(datastoreId)) {
  throw new Error(`Datastore "${datastoreId}" not found in the node "${nodeName}"`)
}

const endpoint = parseEndpoint(args.endpoint, 7)

let serverEntity: Output<common.Server> | undefined
let sshCredentials: Output<ssh.Connection | undefined> | undefined
let nodeTerminal: Output<UnitTerminal> | undefined

if (inputs.sshKeyPair || secrets.sshPassword || secrets.sshPrivateKey) {
  const { server, terminal } = await createServerBundle({
    name,
    endpoints: [endpoint],
    sshArgs: args.ssh,
    sshPassword: secrets.sshPassword,
    sshPrivateKey: secrets.sshPrivateKey,
    sshKeyPair: inputs.sshKeyPair,
  })

  serverEntity = server
  sshCredentials = server.ssh
  nodeTerminal = terminal
}

const proxmoxCluster: Output<proxmox.Cluster> = output({
  endpoint,
  insecure: args.insecure,
  username: args.username,
  defaultNodeName: nodeName,
  defaultDatastoreId: datastoreId,
  password: secrets.sshPassword,
  apiToken: secrets.apiToken,
  ssh: sshCredentials,
})

export default outputs({
  proxmoxCluster,
  server: serverEntity,

  $terminals: [nodeTerminal],

  $statusFields: {
    defaultNodeName: {
      meta: {
        icon: "mdi:server",
      },
      value: proxmoxCluster.defaultNodeName,
    },
    defaultDatastoreId: {
      meta: {
        icon: "mdi:database",
      },
      value: proxmoxCluster.defaultDatastoreId,
    },
  },
})
