import { expect, test } from "bun:test"
import { parseAllDocuments, stringify } from "yaml"
import { zitadelValues } from "./values"

test.skipIf(!Bun.which("helm"))(
  "official pinned chart renders external database, bootstrap credentials and separate h2c API/login services",
  async () => {
    const values = zitadelValues(
      {
        appName: "identity",
        fqdn: "identity.example.com",
        imageTag: "v4.19.2",
        loginImageTag: "v4.19.2",
        replicas: 2,
        organizationName: "Example",
        adminEmail: "admin@example.com",
        adminFirstName: "Example",
        adminLastName: "Admin",
        managementTokenExpiration: "2029-01-01T00:00:00Z",
      },
      "configuration",
      "masterkey",
    )
    const process = Bun.spawn(
      [
        "helm",
        "template",
        "identity",
        "zitadel",
        "--repo",
        "https://charts.zitadel.com",
        "--version",
        "10.4.0",
        "--namespace",
        "identity",
        "--kube-version",
        "1.30.0",
        "-f",
        "-",
      ],
      { stdin: new Blob([stringify(values)]), stdout: "pipe", stderr: "pipe" },
    )
    const [manifest, errors, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(errors).toBe("")
    expect(exitCode).toBe(0)
    const resources = parseAllDocuments(manifest)
      .map(document => document.toJSON())
      .filter(Boolean)
    const api = resources.find(
      resource => resource.kind === "Service" && resource.metadata.name === "identity",
    )
    expect(api.spec.ports[0].appProtocol).toBe("kubernetes.io/h2c")
    const login = resources.find(
      resource => resource.kind === "Service" && resource.metadata.name === "identity-login",
    )
    expect(login.spec.ports[0].port).toBe(3000)
    const setup = resources.find(
      resource => resource.kind === "Job" && resource.metadata.name === "identity-setup",
    )
    expect(setup.metadata.annotations["helm.sh/hook-weight"]).toBe("2")
    const setupContainer = setup.spec.template.spec.containers.find((container: { name: string }) =>
      container.name.endsWith("-setup"),
    )
    expect(setupContainer.args).toContain("/zitadel-secret-config-yaml/config-yaml")
    expect(
      setup.spec.template.spec.containers.some((container: { command?: string[] }) =>
        container.command?.join(" ").includes("identity-management-pat"),
      ),
    ).toBe(true)
    const configMap = resources.find(
      resource => resource.kind === "ConfigMap" && resource.data["zitadel-config-yaml"],
    )
    expect(configMap.data["zitadel-config-yaml"]).toContain("admin@example.com")
    expect(configMap.data["zitadel-config-yaml"]).toContain("ExternalPort: 443")
    const loginConfig = resources.find(
      resource => resource.kind === "ConfigMap" && resource.data[".env"],
    )
    expect(loginConfig.data[".env"]).toContain('ZITADEL_API_URL="http://identity:8080"')
    expect(resources.some(resource => resource.kind === "StatefulSet")).toBe(false)
  },
  120_000,
)
