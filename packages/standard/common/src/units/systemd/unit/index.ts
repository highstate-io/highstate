import { getEntityId } from "@highstate/contract"
import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { Command } from "../../../shared"

const { name, args, inputs, outputs } = forUnit(common.systemdUnit)

const servers = await toPromise(inputs.servers)
const serviceName = args.serviceName ?? name.replaceAll(".", "-")

if (!/^[A-Za-z0-9:_.@-]+$/.test(serviceName)) {
  throw new Error(`Invalid systemd service name "${serviceName}"`)
}

const scriptPath = `/usr/local/lib/highstate/${serviceName}.sh`
const servicePath = `/etc/systemd/system/${serviceName}.service`
const unitContent = [
  "[Unit]",
  `Description=Highstate service ${serviceName}`,
  ...(args.after.length > 0 ? [`After=${args.after.join(" ")}`] : []),
  ...(args.wants.length > 0 ? [`Wants=${args.wants.join(" ")}`] : []),
  ...(args.requires.length > 0 ? [`Requires=${args.requires.join(" ")}`] : []),
  "",
  "[Service]",
  `Type=${args.type}`,
  `ExecStart=${scriptPath}`,
  ...(args.type === "oneshot" ? ["RemainAfterExit=yes"] : ["Restart=always", "RestartSec=5s"]),
  "",
  "[Install]",
  "WantedBy=multi-user.target",
  ...(args.extraConfig ? ["", args.extraConfig] : []),
].join("\n")

for (const server of servers) {
  const resourceName = `${getEntityId(server)}-${server.hostname}`

  const scriptFile = Command.createTextFile(`${resourceName}-script`, {
    host: server,
    path: scriptPath,
    content: `#!/bin/bash\n${args.script}`,
    mode: "755",
  })

  const serviceFile = Command.createTextFile(`${resourceName}-unit`, {
    host: server,
    path: servicePath,
    content: unitContent,
    mode: "644",
  })

  new Command(
    resourceName,
    {
      host: server,
      create: `systemctl daemon-reload && systemctl enable --now ${serviceName}.service`,
      update: `systemctl daemon-reload && systemctl restart ${serviceName}.service`,
      delete: [
        `systemctl disable --now ${serviceName}.service || true`,
        `rm -f ${servicePath}`,
        "systemctl daemon-reload",
      ].join("\n"),
      updateTriggers: [args.script, unitContent],
    },
    { dependsOn: [scriptFile, serviceFile] },
  )
}

export default outputs({
  servers,
  $statusFields: {
    serviceName,
  },
})
