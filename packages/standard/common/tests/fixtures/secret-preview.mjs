import { defineUnit, z } from "@highstate/contract"
import { common } from "@highstate/library"
import { sshPrivateKeyToKeyPair } from "@highstate/common"
import { ComponentResource, forUnit, makeEntityAsync, makeSecretOutput, output, runtime } from "@highstate/pulumi"

const unit = defineUnit({
  type: "test.credentials.v1",
  source: { package: "@highstate/common", path: "synthetic" },
  secrets: { rootPassword: z.string(), sshPrivateKey: z.string() },
  inputs: { server: common.serverEntity },
})

const { inputs, getSecret } = forUnit(unit)
forUnit(unit)
const publicHost = await makeEntityAsync({
  entity: common.serverEntity,
  identity: inputs.server.$meta.identity,
  value: inputs.server,
})
const credentialHost = await makeEntityAsync({
  entity: common.serverEntity,
  identity: publicHost.$meta.identity,
  value: {
    ...publicHost,
    ssh: {
      ...publicHost.ssh,
      password: makeSecretOutput(getSecret("rootPassword")),
      keyPair: getSecret("sshPrivateKey").apply(sshPrivateKeyToKeyPair),
    },
  },
})

new ComponentResource("test:secrets:Host", "reconstructed-host", { host: inputs.server })
new ComponentResource("test:secrets:Host", "materialized-host", { host: Promise.resolve(publicHost) })
new ComponentResource("test:secrets:Host", "output-host", { host: output(publicHost) })
new ComponentResource("test:secrets:Host", "unit-credentials", { host: credentialHost })
const dependency = new ComponentResource("test:secrets:Dependency", "dependency", {})
new ComponentResource("test:secrets:Host", "dependent-host", { host: dependency.urn.apply(() => publicHost) })
new ComponentResource("test:secrets:Host", "existing-secret", { credential: getSecret("rootPassword") })
new ComponentResource("test:secrets:Host", "unknown-host", {
  host: {
    hostname: publicHost.hostname,
    password: { ...publicHost.ssh.password, value: runtime.deserializeProperty(runtime.unknownValue) },
    endpoint: runtime.deserializeProperty(runtime.unknownValue),
  },
})
