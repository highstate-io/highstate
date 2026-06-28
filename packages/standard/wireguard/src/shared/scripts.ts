import { posix } from "node:path"
import { Command, type CommandHost } from "@highstate/common"

export type ExecutableScriptFileArgs = {
  host: CommandHost
  path: string
  content: string
}

export type FeedDaemonHookScriptsArgs = {
  host: CommandHost
  directory: string
  serviceName: string
  configPath: string
  statePath: string
  interfaceName: string
  forwardRestrictedSubnets: string[]
  lockdownUpstream: boolean
}

export type FeedDaemonHookScripts = {
  preStart: Command
  postStop: Command
  preStartPath: string
  postStopPath: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function createExecutableScriptFile(
  name: string,
  { host, path, content }: ExecutableScriptFileArgs,
): Command {
  return Command.createTextFile(name, {
    host,
    path,
    content: `#!/usr/bin/env bash\n${content}`,
    mode: "755",
  })
}

export function createFeedDaemonHookScripts({
  host,
  directory,
  serviceName,
  configPath,
  statePath,
  interfaceName,
  forwardRestrictedSubnets,
  lockdownUpstream,
}: FeedDaemonHookScriptsArgs): FeedDaemonHookScripts {
  const preStartPath = `${directory}/${serviceName}.pre-start.sh`
  const postStopPath = `${directory}/${serviceName}.post-stop.sh`

  const preStartCommands = [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(posix.dirname(configPath))} ${shellQuote(posix.dirname(statePath))}`,
  ]

  for (const restrictedCidr of forwardRestrictedSubnets) {
    preStartCommands.push(
      `iptables -C FORWARD -d ${shellQuote(restrictedCidr)} -j DROP || iptables -I FORWARD -d ${shellQuote(restrictedCidr)} -j DROP`,
    )
  }

  if (lockdownUpstream) {
    preStartCommands.push("ip route replace blackhole default table 100")
    preStartCommands.push(
      `ip rule show | grep -q ${shellQuote(`iif ${interfaceName} lookup 100`)} || ip rule add iif ${shellQuote(interfaceName)} lookup 100 priority 100`,
    )
  }

  const postStopCommands = ["set -u"]

  for (const restrictedCidr of forwardRestrictedSubnets) {
    postStopCommands.push(`iptables -D FORWARD -d ${shellQuote(restrictedCidr)} -j DROP || true`)
  }

  if (lockdownUpstream) {
    postStopCommands.push(
      `ip rule del iif ${shellQuote(interfaceName)} lookup 100 priority 100 || true`,
    )
    postStopCommands.push("ip route del blackhole default table 100 || true")
  }

  return {
    preStartPath,
    postStopPath,
    preStart: createExecutableScriptFile("wg-feed-daemon-pre-start-script", {
      host,
      path: preStartPath,
      content: preStartCommands.join("\n"),
    }),
    postStop: createExecutableScriptFile("wg-feed-daemon-post-stop-script", {
      host,
      path: postStopPath,
      content: postStopCommands.join("\n"),
    }),
  }
}
