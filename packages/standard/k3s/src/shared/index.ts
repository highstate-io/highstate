import type { common, network } from "@highstate/library"
import { Command, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { type Input, type InputRecord, interpolate, output } from "@highstate/pulumi"
import { mergeDeep } from "remeda"

export type K3sNodeType = "server" | "agent"

export type CreateK3sNodeOptions = {
  server: common.Server
  type: K3sNodeType
  env: InputRecord<string>
  config: Record<string, unknown>
  registries: Record<string, unknown>
  nodeConfig?: Record<string, Record<string, unknown>>
  dependsOn?: Command[]
}

export type CreateK3sWorkerOptions = {
  server: common.Server
  bootstrapEndpoint: network.L4Endpoint
  agentToken: Input<string>
  agentConfig: Record<string, unknown>
  registries: Record<string, unknown>
  config?: Record<string, unknown>
  nodeConfig?: Record<string, Record<string, unknown>>
  dependsOn?: Command[]
}

export function createK3sNode(options: CreateK3sNodeOptions): Command {
  const privateEndpoint = options.server.endpoints.find(
    endpoint => endpoint.type !== "hostname" && endpoint.metadata["iana.scope"] === "private",
  )
  const publicEndpoint = options.server.endpoints.find(
    endpoint => endpoint.type !== "hostname" && endpoint.metadata["iana.scope"] === "global",
  )
  const nodeIp = privateEndpoint ? l3EndpointToString(privateEndpoint) : undefined
  const externalIp = publicEndpoint ? l3EndpointToString(publicEndpoint) : undefined
  const nodeSpecificConfig = options.nodeConfig?.[options.server.hostname] ?? {}
  const nodeConfig = {
    ...(nodeIp ? { "node-ip": nodeIp } : {}),
    ...(nodeIp && externalIp ? { "node-external-ip": externalIp } : {}),
    ...(options.type === "server" && nodeIp ? { "advertise-address": nodeIp } : {}),
  }
  const mergedConfig = mergeDeep(mergeDeep(options.config, nodeSpecificConfig), nodeConfig)

  const configFileCommand = Command.createTextFile(`config-${options.server.hostname}`, {
    host: options.server,
    path: "/etc/rancher/k3s/config.yaml",
    content: JSON.stringify(mergedConfig, null, 2),
  })

  const registryConfigFileCommand = Command.createTextFile(
    `registry-config-${options.server.hostname}`,
    {
      host: options.server,
      path: "/etc/rancher/k3s/registries.yaml",
      content: JSON.stringify(options.registries, null, 2),
    },
  )

  const effectiveEnv = {
    INSTALL_K3S_EXEC: options.type,
    ...options.env,
  }

  const envString = output(effectiveEnv).apply(env => {
    return Object.entries(env)
      .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
      .join(" ")
  })

  return new Command(
    `install-${options.server.hostname}`,
    {
      host: options.server,
      create: interpolate`set -o pipefail; curl -fL https://raw.githubusercontent.com/k3s-io/k3s/refs/heads/main/install.sh | ${envString} sh -s -`,
      delete: "/usr/local/bin/k3s-agent-uninstall.sh || /usr/local/bin/k3s-uninstall.sh || true",
    },
    {
      dependsOn: [configFileCommand, registryConfigFileCommand, ...(options.dependsOn ?? [])],
    },
  )
}

export function createK3sWorker(options: CreateK3sWorkerOptions): Command {
  return createK3sNode({
    server: options.server,
    type: "agent",
    env: {
      K3S_TOKEN: options.agentToken,
      K3S_URL: `https://${l4EndpointToString(options.bootstrapEndpoint)}`,
    },
    config: mergeDeep(options.agentConfig, options.config ?? {}),
    registries: options.registries,
    nodeConfig: options.nodeConfig,
    dependsOn: options.dependsOn,
  })
}
