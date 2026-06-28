import { Command, l3EndpointToL4, l4EndpointToString, l7EndpointToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, secret, toPromise } from "@highstate/pulumi"
import artifacts from "../../assets/artifacts.json"
import { createFeedDaemonHookScripts, generateFeedDaemonConfigContent } from "../shared"

const { name, args, inputs, secrets, outputs } = forUnit(wireguard.nodeFeed)

const { server, peer } = await toPromise(inputs)

const inputEndpoints = await toPromise(inputs.endpoints ?? [])
const secretEndpoints = await toPromise(secrets.endpoints)
const setupUrls = [...inputEndpoints.map(l7EndpointToString), ...secretEndpoints]

if (setupUrls.length === 0) {
  throw new Error(
    "At least one endpoint must be provided via inputs.endpoints or secrets.endpoints",
  )
}

const serviceName = args.serviceName ?? `wg-feed-${name}`.replaceAll(".", "-")
const configContent = generateFeedDaemonConfigContent({
  statePath: args.statePath,
  feedName: args.feedName,
  backendName: args.backendName,
  backendType: args.backendType,
  syncMode: args.syncMode,
  pollingInterval: args.pollingInterval,
  endpoints: setupUrls,
  enabledTunnels: args.enabledTunnels,
})

const binary = Command.downloadArtifactFile("wg-feed-daemon-binary", artifacts.wgFeedDaemon, {
  host: server,
  path: args.daemonPath,
  mode: "755",
})

const configFile = Command.createTextFile(
  "wg-feed-daemon-config",
  {
    host: server,
    path: args.configPath,
    content: secret(configContent),
    mode: "600",
  },
  { dependsOn: [binary] },
)

const hookScripts = createFeedDaemonHookScripts({
  host: server,
  directory: "/etc/wg-feed",
  serviceName,
  configPath: args.configPath,
  statePath: args.statePath,
  interfaceName: args.interfaceName,
  forwardRestrictedSubnets: args.forwardRestrictedSubnets,
  lockdownUpstream: args.lockdownUpstream,
})

const unitContent = [
  "[Unit]",
  "Description=wg-feed daemon",
  "After=network-online.target",
  "Wants=network-online.target",
  "",
  "[Service]",
  "Type=simple",
  `ExecStartPre=${hookScripts.preStartPath}`,
  `ExecStart=${args.daemonPath} --config ${args.configPath}`,
  `ExecStopPost=${hookScripts.postStopPath}`,
  "Restart=always",
  "RestartSec=5s",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
].join("\n")

const serviceFile = Command.createTextFile(
  "wg-feed-daemon-service-file",
  {
    host: server,
    path: `/etc/systemd/system/${serviceName}.service`,
    content: unitContent,
    mode: "644",
  },
  { dependsOn: [binary, configFile, hookScripts.preStart, hookScripts.postStop] },
)

new Command(
  "wg-feed-daemon-service",
  {
    host: server,
    create: `systemctl daemon-reload && systemctl enable --now ${serviceName}.service`,
    update: `systemctl daemon-reload && systemctl restart ${serviceName}.service`,
    delete: `systemctl disable --now ${serviceName}.service || true && rm -f /etc/systemd/system/${serviceName}.service && systemctl daemon-reload`,
    updateTriggers: [configContent, unitContent, artifacts.wgFeedDaemon],
  },
  { dependsOn: [serviceFile] },
)

const exposedEndpoints =
  server.endpoints?.map(endpoint => l3EndpointToL4(endpoint, args.listenPort, "udp")) ?? []

export default outputs({
  peer: peer
    ? {
        ...peer,
        endpoints: exposedEndpoints,
      }
    : undefined,

  $statusFields: {
    serviceName,
    endpoints: exposedEndpoints.map(l4EndpointToString),
  },
})
