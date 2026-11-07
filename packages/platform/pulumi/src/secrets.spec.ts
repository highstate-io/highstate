import { HighstateSignature } from "@highstate/contract"
import { output, runtime, secret } from "@pulumi/pulumi"
import { describe, expect, it } from "vitest"
import { protectResourceSecrets } from "./secrets"

runtime.setMocks(
  {
    newResource: args => ({ id: args.name, state: args.inputs }),
    call: args => args.inputs,
  },
  "secrets",
  "preview",
  true,
)

const { serializeProperties, deserializeProperty, specialSigKey, specialSecretSig } = runtime

async function transform(props: Record<string, unknown>) {
  // match the SDK callback boundary: serialize, resolve wire inputs, transform, serialize
  const serialized = await serializeProperties("synthetic input", props)

  const resolved = Object.fromEntries(
    Object.entries(serialized).map(([key, value]) => [key, deserializeProperty(value)]),
  )

  const opts = { protect: true }

  const result = await protectResourceSecrets({
    type: "test:component:Resource",
    name: "synthetic",
    custom: false,
    props: resolved,
    opts,
  })

  expect(result!.opts).toBe(opts)

  return await serializeProperties("synthetic transformed input", result!.props)
}

describe("Highstate resource-input secret restoration", () => {
  it("protects only wrapper values through nested records, arrays, promises and outputs", async () => {
    const wrapper = { [HighstateSignature.Secret]: true, value: "synthetic-canary" }

    const host = {
      hostname: "synthetic.invalid",
      port: 22,
      metadata: { visible: true },
      credentials: [wrapper],
    }

    for (const input of [host, Promise.resolve(host), output(host)]) {
      const result = await transform({ host: input })
      expect(result.host.hostname).toBe(host.hostname)
      expect(result.host.port).toBe(22)
      expect(result.host.metadata).toEqual(host.metadata)
      expect(result.host[specialSigKey]).toBeUndefined()
      expect(result.host.credentials[0][HighstateSignature.Secret]).toBe(true)
      expect(result.host.credentials[0][specialSigKey]).toBeUndefined()
      expect(result.host.credentials[0].value[specialSigKey]).toBe(specialSecretSig)
      expect(result.host.credentials[0].value.value === wrapper.value).toBe(true)
    }

    expect(typeof wrapper.value).toBe("string")
  })

  it("preserves existing Pulumi secrecy without unwrapping or double wrapping", async () => {
    const props = {
      host: secret({
        credential: { [HighstateSignature.Secret]: true, value: "synthetic-canary" },
        public: "visible",
      }),
    }

    const before = await serializeProperties("synthetic existing secret", props)
    expect(await transform(props)).toEqual(before)
  })

  it("preserves unknown values and visible known siblings", async () => {
    const unknown = deserializeProperty(runtime.unknownValue)

    const result = await transform({
      host: {
        hostname: "synthetic.invalid",
        password: { [HighstateSignature.Secret]: true, value: unknown },
        endpoint: unknown,
      },
    })

    expect(result.host.hostname).toBe("synthetic.invalid")
    expect(result.host.endpoint).toBe(runtime.unknownValue)
    expect(result.host.password[HighstateSignature.Secret]).toBe(true)
    expect(result.host.password.value).toBe(runtime.unknownValue)
    const unresolved = await transform({ host: output(unknown), public: "visible" })
    expect(unresolved.host).toBe(runtime.unknownValue)
    expect(unresolved.public).toBe("visible")
  })

  it("leaves ordinary values and invalid secret markers public", async () => {
    const props = {
      literal: { value: "public" },
      falseMarker: { [HighstateSignature.Secret]: false, value: "public" },
      missingValue: { [HighstateSignature.Secret]: true },
    }

    expect(await transform(props)).toEqual(props)
  })
})
