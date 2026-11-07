import { common, network, ssh } from "@highstate/library"
import {
  isSecret,
  makeEntity,
  makeSecret,
  output,
  runtime,
  secret,
  toPromise,
} from "@highstate/pulumi"
import { describe, expect, it } from "vitest"
import { Command, getServerConnection } from "./command"

const { serializeProperties, specialSecretSig, specialSigKey } = runtime

runtime.setMocks(
  {
    newResource: args => ({ id: args.name, state: { ...args.inputs, stdout: "", stderr: "" } }),
    call: args => args.inputs,
  },
  "secret-test",
  "preview",
  true,
)

function createHost() {
  const endpoint = makeEntity({
    entity: network.l4EndpointEntity,
    identity: "synthetic-endpoint",
    value: {
      type: "hostname",
      hostname: "synthetic.invalid",
      port: 22,
      protocol: "tcp",
      metadata: {},
    },
  })

  const keyPair = makeEntity({
    entity: ssh.keyPairEntity,
    identity: "synthetic-key",
    value: {
      type: "ed25519",
      fingerprint: "synthetic-fingerprint",
      publicKey: "synthetic-public-key",
      privateKey: makeSecret("synthetic-private-canary"),
    },
  })

  const connection = makeEntity({
    entity: ssh.connectionEntity,
    identity: "synthetic-connection",
    value: {
      endpoints: [endpoint],
      user: "root",
      hostKey: "synthetic-host-key",
      password: makeSecret("synthetic-password-canary"),
      keyPair,
      proxy: { endpoint, user: "proxy" },
    },
  })

  return makeEntity({
    entity: common.serverEntity,
    identity: "synthetic-server",
    value: { hostname: "synthetic", endpoints: [endpoint], ssh: connection },
  })
}

describe("command credential serialization", () => {
  it("reproduces the plaintext wrapper serialization without Pulumi secrecy", async () => {
    const host = createHost()
    const serialized = await serializeProperties("synthetic baseline", { host })
    expect(serialized.host[specialSigKey]).not.toBe(specialSecretSig)
    expect(serialized.host.ssh.password.value === host.ssh?.password?.value).toBe(true)

    expect(
      serialized.host.ssh.keyPair.privateKey.value === host.ssh?.keyPair?.privateKey.value,
    ).toBe(true)
  })

  it.each([
    "plain",
    "promise",
    "output",
    "secret",
  ])("protects the entire component host supplied as %s while retaining API wrappers", async kind => {
    const host = createHost()

    const input =
      kind === "promise"
        ? Promise.resolve(host)
        : kind === "output"
          ? output(host)
          : kind === "secret"
            ? secret(host)
            : host

    let props: Record<string, unknown> = {}

    const command = new Command(
      `synthetic-${kind}`,
      { host: input, create: "true" },
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
    const serialized = await serializeProperties("synthetic component", props)
    expect(serialized.host[specialSigKey]).toBe(specialSecretSig)
    expect(serialized.host.value).toEqual(host)
    expect(props.create).toBe("true")
  })

  it("protects unwrapped target and proxy credentials in provider inputs", async () => {
    const host = createHost()
    const connection = getServerConnection(host.ssh!)
    const serialized = await serializeProperties("synthetic connection", { connection })
    expect(serialized.connection[specialSigKey]).toBe(specialSecretSig)
    const value = await toPromise(connection)
    expect(value.password === host.ssh?.password?.value).toBe(true)
    expect(value.privateKey === host.ssh?.keyPair?.privateKey.value).toBe(true)
    expect(value.proxy?.password === host.ssh?.password?.value).toBe(true)
    expect(value.proxy?.privateKey === host.ssh?.keyPair?.privateKey.value).toBe(true)
  })

  it("does not evaluate unknown preview connections", async () => {
    const unknown = output(runtime.deserializeProperty(runtime.unknownValue) as ssh.Connection)
    const connection = getServerConnection(unknown)
    let evaluated = false

    connection.apply(() => {
      evaluated = true
    })

    await serializeProperties("synthetic unknown", { connection })
    expect(evaluated).toBe(false)
    expect(await isSecret(connection)).toBe(true)
  })

  it("preserves unknown preview hosts without evaluating remote connection logic", async () => {
    let props: Record<string, unknown> = {}
    const host = output(runtime.deserializeProperty(runtime.unknownValue) as common.Server)

    const command = new Command(
      "synthetic-unknown",
      { host, create: "true" },
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
    const serialized = await serializeProperties("synthetic unknown component", props)
    expect(serialized.host).toBe(runtime.unknownValue)
    expect(await isSecret(output(props.host))).toBe(true)
    expect(serialized.create).toBe("true")
  })

  it("retains optional credentials and connection fields", async () => {
    const host = createHost()

    const connection = await toPromise(
      getServerConnection({
        ...host.ssh!,
        password: undefined,
        keyPair: undefined,
        proxy: undefined,
      }),
    )

    expect(connection).toEqual({
      host: "synthetic.invalid",
      port: 22,
      user: "root",
      hostKey: "synthetic-host-key",
      dialErrorLimit: 3,
      password: undefined,
      privateKey: undefined,
      proxy: undefined,
    })
  })

  it("keeps local hosts public", async () => {
    let props: Record<string, unknown> = {}

    const command = new Command(
      "synthetic-local",
      { host: "local", create: "true" },
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
    const serialized = await serializeProperties("synthetic local", props)
    expect(serialized.host).toBe("local")
  })
})
