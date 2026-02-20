import { Command, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { generateIdentityConfig } from "../shared"

const { args, inputs, outputs } = forUnit(wireguard.node)

const { identity, server, peers } = await toPromise(inputs)

// generate interface name (max 15 chars for Linux)
const identityName = identity.peer.name.replaceAll(".", "-")
const interfaceName = args.interfaceName ?? `wg-${identityName}`.substring(0, 15)

// create script files for user-provided scripts
const scriptFiles: Command[] = []

if (args.preUpScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-preup-script", {
      host: server,
      path: `/etc/wireguard/${interfaceName}.pre-up.sh`,
      content: `#!/bin/bash\n${args.preUpScript}`,
    }),
  )
}

if (args.postUpScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-postup-script", {
      host: server,
      path: `/etc/wireguard/${interfaceName}.post-up.sh`,
      content: `#!/bin/bash\n${args.postUpScript}`,
    }),
  )
}

if (args.preDownScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-predown-script", {
      host: server,
      path: `/etc/wireguard/${interfaceName}.pre-down.sh`,
      content: `#!/bin/bash\n${args.preDownScript}`,
    }),
  )
}

if (args.postDownScript) {
  scriptFiles.push(
    Command.createTextFile("wireguard-postdown-script", {
      host: server,
      path: `/etc/wireguard/${interfaceName}.post-down.sh`,
      content: `#!/bin/bash\n${args.postDownScript}`,
    }),
  )
}

// build up the pre/post commands
const preUp: string[] = []
const postUp: string[] = []
const preDown: string[] = []
const postDown: string[] = []

// reference script files if they exist
if (args.preUpScript) preUp.push(`/etc/wireguard/${interfaceName}.pre-up.sh`)
if (args.postUpScript) postUp.push(`/etc/wireguard/${interfaceName}.post-up.sh`)
if (args.preDownScript) preDown.push(`/etc/wireguard/${interfaceName}.pre-down.sh`)
if (args.postDownScript) postDown.push(`/etc/wireguard/${interfaceName}.post-down.sh`)

// add IP masquerading if enabled
if (args.enableMasquerade) {
  postUp.push("iptables -t nat -A POSTROUTING -j MASQUERADE")
  postUp.push("iptables -A FORWARD -i %i -j ACCEPT")
  postUp.push("iptables -A FORWARD -o %i -j ACCEPT")

  preDown.push("iptables -t nat -D POSTROUTING -j MASQUERADE || true")
  preDown.push("iptables -D FORWARD -i %i -j ACCEPT || true")
  preDown.push("iptables -D FORWARD -o %i -j ACCEPT || true")
}

// add forwarding restrictions for specified CIDRs
for (const restrictedCidr of args.forwardRestrictedIps) {
  postUp.push(`iptables -I FORWARD -d ${restrictedCidr} -j DROP`)
  preDown.push(`iptables -D FORWARD -d ${restrictedCidr} -j DROP || true`)
}

// generate WireGuard configuration
const wgConfig = generateIdentityConfig({
  identity,
  peers,
  listenPort: identity.peer.listenPort,
  preUp,
  postUp,
  preDown,
  postDown,
})

// create WireGuard configuration file
const configFile = Command.createTextFile(
  "wireguard-config",
  {
    host: server,
    path: `/etc/wireguard/${interfaceName}.conf`,
    content: wgConfig,
  },
  { dependsOn: scriptFiles },
)

// set proper permissions on the config and script files
const setPermissions = new Command(
  "wireguard-permissions",
  {
    host: server,
    create: `
      chmod 600 /etc/wireguard/${interfaceName}.conf
      ${args.preUpScript ? `chmod 755 /etc/wireguard/${interfaceName}.pre-up.sh` : ""}
      ${args.postUpScript ? `chmod 755 /etc/wireguard/${interfaceName}.post-up.sh` : ""}
      ${args.preDownScript ? `chmod 755 /etc/wireguard/${interfaceName}.pre-down.sh` : ""}
      ${args.postDownScript ? `chmod 755 /etc/wireguard/${interfaceName}.post-down.sh` : ""}
    `,
  },
  { dependsOn: [configFile] },
)

// check for wg-quick template service and enable it
new Command(
  "wireguard-service",
  {
    host: server,
    create: `
      # check if wg-quick template service exists
      if ! systemctl list-unit-files | grep -q "^wg-quick@.service"; then
        echo "Error: wg-quick@.service template not found. Please install wireguard-tools." >&2
        exit 1
      fi
      
      # enable and start the service instance
      systemctl enable --now wg-quick@${interfaceName}.service
    `,
    update: `
      # restart the service to apply new configuration
      systemctl restart wg-quick@${interfaceName}.service
    `,
    delete: `
      # stop and disable the service instance
      systemctl disable --now wg-quick@${interfaceName}.service || true
      
      # clean up the interface if it still exists
      ip link delete ${interfaceName} 2>/dev/null || true
    `,
    updateTriggers: [wgConfig],
  },
  { dependsOn: [setPermissions] },
)

// calculate endpoints from server L3 endpoints (only if listen port is specified)
const endpoints = identity.peer.listenPort
  ? (server.endpoints?.map(e => l3EndpointToL4(e, identity.peer.listenPort!)) ?? [])
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
