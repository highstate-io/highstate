import { Command, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import {
  generateIdentityConfig,
  getNodeConfigContent,
  resolveNodeInputs,
  resolveNodeNetwork,
} from "../shared"

const { args, inputs, outputs } = forUnit(wireguard.node)

const { identity: inputIdentity, config, server, peers: inputPeers } = await toPromise(inputs)
const { identity, peers } = resolveNodeInputs({
  identity: inputIdentity,
  config,
  peers: inputPeers,
})

const network = resolveNodeNetwork(identity, peers)

const isAmneziaBackend = network?.backend === "amneziawg"
const quickServiceTemplate = isAmneziaBackend ? "awg-quick@" : "wg-quick@"
const quickServiceInstallHint = isAmneziaBackend ? "amneziawg-tools" : "wireguard-tools"
const configDirectory = isAmneziaBackend ? "/etc/amnezia/amneziawg" : "/etc/wireguard"

// generate interface name (max 15 chars for Linux)
const identityName = identity.peer.name.replaceAll(".", "-")
const interfacePrefix = isAmneziaBackend ? "awg" : "wg"
const interfaceName = args.interfaceName ?? `${interfacePrefix}-${identityName}`.substring(0, 15)

// create script files for user-provided scripts
const scriptFiles: Command[] = []

if (args.preUpScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-preup-script", {
      host: server,
      path: `${configDirectory}/${interfaceName}.pre-up.sh`,
      content: `#!/bin/bash\n${args.preUpScript}`,
      mode: "755",
    }),
  )
}

if (args.postUpScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-postup-script", {
      host: server,
      path: `${configDirectory}/${interfaceName}.post-up.sh`,
      content: `#!/bin/bash\n${args.postUpScript}`,
      mode: "755",
    }),
  )
}

if (args.preDownScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-predown-script", {
      host: server,
      path: `${configDirectory}/${interfaceName}.pre-down.sh`,
      content: `#!/bin/bash\n${args.preDownScript}`,
      mode: "755",
    }),
  )
}

if (args.postDownScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-postdown-script", {
      host: server,
      path: `${configDirectory}/${interfaceName}.post-down.sh`,
      content: `#!/bin/bash\n${args.postDownScript}`,
      mode: "755",
    }),
  )
}

// build up the pre/post commands
const preUp: string[] = []
const postUp: string[] = []
const preDown: string[] = []
const postDown: string[] = []

// reference script files if they exist
if (args.preUpScript) preUp.push(`${configDirectory}/${interfaceName}.pre-up.sh`)
if (args.postUpScript) postUp.push(`${configDirectory}/${interfaceName}.post-up.sh`)
if (args.preDownScript) preDown.push(`${configDirectory}/${interfaceName}.pre-down.sh`)
if (args.postDownScript) postDown.push(`${configDirectory}/${interfaceName}.post-down.sh`)

// add IP masquerading if enabled
if (args.enableMasquerade) {
  postUp.push("iptables -t nat -A POSTROUTING -o %i -j MASQUERADE")
  postUp.push("iptables -A FORWARD -i %i -j ACCEPT")
  postUp.push("iptables -A FORWARD -o %i -j ACCEPT")

  preDown.push("iptables -t nat -D POSTROUTING -o %i -j MASQUERADE || true")
  preDown.push("iptables -D FORWARD -i %i -j ACCEPT || true")
  preDown.push("iptables -D FORWARD -o %i -j ACCEPT || true")
}

// add forwarding restrictions for specified CIDRs
for (const restrictedCidr of args.forwardRestrictedIps) {
  postUp.push(`iptables -I FORWARD -d ${restrictedCidr} -j DROP`)
  preDown.push(`iptables -D FORWARD -d ${restrictedCidr} -j DROP || true`)
}

// when config input is provided, use its file content directly instead of regenerating it
const wgConfig = config
  ? getNodeConfigContent(config)
  : generateIdentityConfig({
      identity,
      peers,
      listenPort: identity.peer.listenPort,
      listen: args.listen,
      peerEndpointFilter: args.peerEndpointFilter,
      preUp,
      postUp,
      preDown,
      postDown,
      network,
    })

// create WireGuard configuration file
const configFile = Command.createTextFile(
  "wireguard-config",
  {
    host: server,
    path: `${configDirectory}/${interfaceName}.conf`,
    content: wgConfig,
    mode: "600",
  },
  { dependsOn: scriptFiles },
)

// check for wg-quick template service and enable it
new Command(
  "wireguard-service",
  {
    host: server,
    create: `
      # check if quick template service exists
      if ! systemctl list-unit-files | grep -q "^${quickServiceTemplate}.service"; then
        echo "Error: ${quickServiceTemplate}.service template not found. Please install ${quickServiceInstallHint}." >&2
        exit 1
      fi
      
      # enable and start the service instance
      systemctl enable --now ${quickServiceTemplate}${interfaceName}.service
    `,
    update: `
      # restart the service to apply new configuration
      systemctl restart ${quickServiceTemplate}${interfaceName}.service
    `,
    delete: `
      # stop and disable the service instance
      systemctl disable --now ${quickServiceTemplate}${interfaceName}.service || true
      
      # clean up the interface if it still exists
      ip link delete ${interfaceName} 2>/dev/null || true
    `,
    updateTriggers: [wgConfig],
  },
  { dependsOn: [configFile] },
)

// calculate endpoints from server L3 endpoints (only if listen port is specified)
const endpoints = identity.peer.listenPort
  ? (server.endpoints?.map(e => l3EndpointToL4(e, identity.peer.listenPort!, "udp")) ?? [])
  : []

export default outputs({
  peer: identity.peer.listenPort
    ? {
        ...identity.peer,
        endpoints,
      }
    : identity.peer,

  $statusFields: {
    interfaceName,
    ...(identity.peer.listenPort && endpoints.length > 0
      ? {
          endpoints: endpoints.map(l4EndpointToString),
        }
      : {}),
  },
})
