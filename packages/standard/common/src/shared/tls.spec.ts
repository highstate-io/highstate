import { resolveCname } from "node:dns/promises"
import { common, type tls } from "@highstate/library"
import { ComponentResource, makeEntity, output, runtime, toPromise } from "@highstate/pulumi"
import { expect, it, vi } from "vitest"
import { TlsCertificate, tlsCertificateMediator } from "./tls"

vi.hoisted(() => {
  // other suites share the module cache because test isolation is disabled
  vi.resetModules()
})

vi.mock("node:dns/promises", () => ({ resolveCname: vi.fn() }))

runtime.setMocks({
  newResource: args => ({ id: args.name, state: args.inputs }),
  call: args => args.inputs,
})

it("validates delegation before selecting an alias-capable issuer and preserves certificate names", async () => {
  const makeIssuer = (name: string, zones: string[], supportsDnsChallengeAliases?: boolean) =>
    makeEntity({
      entity: common.tlsIssuerEntity,
      identity: name,
      value: { zones, supportsDnsChallengeAliases, implRef: { package: name, data: {} } },
    })

  const original = makeIssuer("original", ["external.example"], true)
  const unsupported = makeIssuer("unsupported", ["managed.example"])
  const delegated = makeIssuer("delegated", ["managed.example"], true)
  const resource = new ComponentResource("test:tls:Certificate", "issued")

  const call = vi.spyOn(tlsCertificateMediator, "call").mockResolvedValue({
    resource,
    certificate: output({} as tls.Certificate),
  })

  vi.mocked(resolveCname).mockResolvedValue(["validation.managed.example."])

  const certificate = new TlsCertificate("delegated-certificate", {
    issuers: [original, unsupported, delegated],
    dnsNames: ["api.external.example"],
    dnsChallengeAliases: { "api.external.example": "validation.managed.example" },
  })

  expect(await toPromise(certificate.resource)).toBe(resource)
  expect(resolveCname).toHaveBeenCalledWith("_acme-challenge.api.external.example")

  expect(call).toHaveBeenCalledWith(
    delegated.implRef,
    expect.objectContaining({
      spec: expect.objectContaining({ dnsNames: ["api.external.example"] }),
    }),
  )

  expect(vi.mocked(resolveCname).mock.invocationCallOrder[0]).toBeLessThan(
    call.mock.invocationCallOrder[0],
  )
})
