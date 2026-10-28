import type { k8s, oauth, postgresql } from "@highstate/library"
import { describe, expect, it } from "bun:test"
import { Namespace, Secret } from "@highstate/k8s"
import { makeFile, makeSecret, toPromise } from "@highstate/pulumi"
import { core } from "@pulumi/kubernetes"
import { isSecret, runtime, secret } from "@pulumi/pulumi"
import { createLoginConfig, createPostgresqlConfig } from "./config"
import { createRuntimeDeployment } from "./workload"

runtime.setMocks(
  {
    newResource: args => ({
      id: args.name,
      state: { ...args.inputs, metadata: { ...args.inputs.metadata, uid: args.name }, status: {} },
    }),
    call: args => args.inputs,
  },
  "highstate-test",
  "test",
)

const loginProvider: oauth.LoginProvider = {
  $meta: { type: "auth.login-provider.v1", identity: "test" },
  id: "example",
  title: "Example",
  clientId: makeSecret("client-id"),
  clientSecret: makeSecret("client-secret"),
  clientAuthMethod: "client_secret_basic",
  scopes: ["openid"],
  identity: { protocol: "oidc", issuer: "https://issuer.example" },
}

describe("Highstate runtime topology", () => {
  it("resolves secret references, exclusive runtime lifecycle, and shared Docker bind paths through Pulumi", async () => {
    const cluster = {
      name: "mock",
      id: "mock",
      connectionId: "mock",
      kubeconfig: makeFile({ name: "kubeconfig", content: "mock", isSecret: true }),
    } as k8s.Cluster

    const namespace = Namespace.wrap("test", {
      cluster,
      namespace: new core.v1.Namespace("test", { metadata: { name: "test" } }),
    })

    const credentials = Secret.create("runtime-test", {
      namespace,
      stringData: {
        "providers.json": secret(createLoginConfig([loginProvider])),
        "postgresql-url": secret("postgresql://user:password@db/highstate"),
      },
    })

    const deployment = createRuntimeDeployment({
      name: "runtime-test",
      namespace,
      runtime: credentials,
      claimName: "exclusive-data",
      image: "runtime@sha256:abc",
      dockerImage: "docker@sha256:def",
      publicUrl: "https://highstate.example",
      maintenance: false,
    })

    const spec = await toPromise(deployment.spec)
    const pod = spec.template.spec
    expect(spec.replicas).toBe(1)
    expect(spec.strategy.type).toBe("Recreate")
    expect(pod.hostNetwork).toBeUndefined()
    expect(pod.volumes.every(volume => !volume.hostPath)).toBe(true)
    const application = pod.containers[0]
    const docker = pod.initContainers[0]
    expect(docker.restartPolicy).toBe("Always")
    expect(docker.securityContext.privileged).toBe(true)

    expect(docker.startupProbe.exec.command).toEqual([
      "docker",
      "-H",
      "unix:///run/highstate-docker/docker.sock",
      "info",
    ])

    for (const path of ["/data", "/tmp", "/run/user/0", "/run/highstate-docker"]) {
      const mount = application.volumeMounts.find(mount => mount.mountPath === path)
      expect(mount).toBeDefined()

      expect(
        docker.volumeMounts.some(
          candidate => candidate.name === mount?.name && candidate.mountPath === path,
        ),
      ).toBe(true)
    }

    expect(
      pod.volumes.find(volume => volume.name === "data")?.persistentVolumeClaim.claimName,
    ).toBe("exclusive-data")

    expect(
      JSON.stringify(pod.volumes.find(volume => volume.name === "docker-data")?.emptyDir),
    ).toBe("{}")

    expect(
      application.env.find(env => env.name === "HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL")
        ?.valueFrom.secretKeyRef,
    ).toMatchObject({ name: "runtime-test", key: "postgresql-url" })

    expect(JSON.stringify(application)).not.toContain("password@")
    expect(JSON.stringify(application)).not.toContain("client-secret")

    expect(application.env.find(env => env.name === "HIGHSTATE_AUTH_PROVIDERS_FILE")?.value).toBe(
      "/recovery/providers.json",
    )

    expect(await isSecret(credentials.stringData)).toBe(true)
    const config = JSON.parse((await toPromise(credentials.stringData))["providers.json"])
    expect(config[0].clientId).toBe("client-id")
    expect(config[0].clientSecret).toBe("client-secret")
    expect(config[0].$meta).toBeUndefined()
  })

  it("rejects ambiguous provider IDs and invalid unwrapped credentials before deployment", () => {
    expect(() => createLoginConfig([loginProvider, loginProvider])).toThrow("unique IDs")
    expect(() => createLoginConfig([{ ...loginProvider, clientSecret: undefined }])).toThrow()
  })

  it("preserves encoded PostgreSQL credentials and verifies TLS with an explicit trust store", async () => {
    const connection: postgresql.Connection = {
      $meta: { type: "postgresql.connection.v1", identity: "test" },
      endpoints: [
        {
          $meta: { type: "network.l4-endpoint.v1", identity: "db" },
          level: 4,
          type: "hostname",
          hostname: "db.example",
          port: 5432,
          protocol: "tcp",
          metadata: {},
        },
      ],
      credentials: { type: "password", username: "user@name", password: makeSecret("p@ss/word") },
      database: "highstate",
      insecure: false,
    }

    const cluster = { name: "test", id: "test" } as k8s.Cluster
    const config = await createPostgresqlConfig(connection, cluster)
    const url = new URL(config.url)
    expect(decodeURIComponent(url.username)).toBe("user@name")
    expect(decodeURIComponent(url.password)).toBe("p@ss/word")
    expect(url.searchParams.get("sslmode")).toBe("verify-full")
    expect(url.searchParams.get("sslrootcert")).toBe("/etc/ssl/certs/ca-certificates.crt")
    const insecure = await createPostgresqlConfig({ ...connection, insecure: true }, cluster)
    expect(new URL(insecure.url).searchParams.get("sslmode")).toBe("disable")

    await expect(
      createPostgresqlConfig(
        { ...connection, insecure: true, ca: makeFile({ name: "ca.crt", content: "CA" }) },
        cluster,
      ),
    ).rejects.toThrow("insecure")
  })
})
