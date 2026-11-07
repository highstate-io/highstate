import { common, network, ssh } from "@highstate/library"
import { isSecret, makeEntity, output, runtime, secret, toPromise } from "@highstate/pulumi"
import getKeys from "micro-key-producer/ssh.js"
import { describe, expect, it } from "vitest"
import { Command, getServerConnection } from "./command"
import { l3EndpointToL4 } from "./network/endpoints"
import { createServerEntity, sshPrivateKeyToKeyPair } from "./ssh"

runtime.setMocks(
  {
    newResource: args => ({
      id: args.name,
      state: {
        ...args.inputs,
        stdout: args.name.endsWith(".host-key") ? "synthetic-host-key" : "synthetic-hostname",
        stderr: "",
      },
    }),
    call: args => args.inputs,
  },
  "secret-test",
  "preview",
  true,
)

const { serializeProperties, specialSecretSig, specialSigKey } = runtime

const endpoint = makeEntity({
  entity: network.l3EndpointEntity,
  identity: "synthetic-endpoint",
  value: { type: "hostname", hostname: "synthetic.invalid", metadata: {} },
})

function createCredentials() {
  return {
    password: secret("synthetic-password-canary"),
    keyPair: secret(getKeys(new Uint8Array(32).fill(7)).privateKey).apply(sshPrivateKeyToKeyPair),
  }
}

describe("command credential provenance", () => {
  it("retains input secrecy through SSH key conversion", async () => {
    const { keyPair, password } = createCredentials()
    expect(await isSecret(keyPair)).toBe(true)
    expect(await isSecret(keyPair.privateKey.value)).toBe(true)
    expect(await isSecret(password)).toBe(true)
  })

  it("isolates secrecy loss to server materialization and plain entity reconstruction", async () => {
    const { keyPair, password } = createCredentials()

    const server = await createServerEntity({
      name: "synthetic",
      endpoints: [endpoint],
      sshPassword: password,
      sshKeyPair: keyPair,
      waitForPing: false,
      waitForSsh: false,
    })

    expect(await isSecret(output(server.ssh?.password?.value))).toBe(false)
    expect(await isSecret(output(server.ssh?.keyPair?.privateKey.value))).toBe(false)

    let props: Record<string, unknown> = {}

    const command = new Command(
      "synthetic-consumer",
      { host: server, create: "true" },
      {
        transformations: [
          args => {
            if (args.type === "highstate:common:Command") {
              props = args.props
            }

            return undefined
          },
        ],
      },
    )

    await toPromise(command.urn)
    const serialized = await serializeProperties("synthetic host", props)
    expect(serialized.host.hostname).toBe("synthetic-hostname")
    expect(serialized.host.ssh.password.value === (await toPromise(password))).toBe(true)

    expect(
      serialized.host.ssh.keyPair.privateKey.value === (await toPromise(keyPair.privateKey.value)),
    ).toBe(true)

    const reconstructed = common.serverEntity.schema.parse(JSON.parse(JSON.stringify(server)))

    const serializedInput = await serializeProperties("synthetic reconstructed host", {
      host: reconstructed,
    })

    expect(serializedInput.host.ssh.password.value === serialized.host.ssh.password.value).toBe(
      true,
    )

    expect(
      serializedInput.host.ssh.keyPair.privateKey.value ===
        serialized.host.ssh.keyPair.privateKey.value,
    ).toBe(true)
  })

  it("propagates normal Pulumi secrecy through the unchanged connection helper", async () => {
    const { keyPair } = createCredentials()

    const connection = keyPair.apply(keyPair =>
      makeEntity({
        entity: ssh.connectionEntity,
        identity: "synthetic",
        value: {
          endpoints: [l3EndpointToL4(endpoint, 22)],
          user: "root",
          hostKey: "synthetic-host-key",
          keyPair,
        },
      }),
    )

    const derived = getServerConnection(connection)
    expect(await isSecret(derived)).toBe(true)

    const serialized = await serializeProperties("synthetic secret connection", {
      connection: derived,
    })

    expect(serialized.connection[specialSigKey]).toBe(specialSecretSig)
  })
})
