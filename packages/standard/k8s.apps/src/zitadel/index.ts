import { randomBytes } from "node:crypto"
import { AccessPointRoute, generatePassword } from "@highstate/common"
import { getProvider, Namespace, Secret, Service } from "@highstate/k8s"
import { k8s, oauth, zitadel } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { helm } from "@pulumi/kubernetes"
import { all, secret } from "@pulumi/pulumi"
import { stringify } from "yaml"
import { getPostgresqlConnectionUrl } from "../shared"
import { zitadelValues } from "./values"

const { args, inputs, secrets, getSecret, stateId, outputs } = forUnit(k8s.apps.zitadel)
const cluster = await toPromise(inputs.k8sCluster)
const namespace = await Namespace.createOrGet(args.appName, { cluster })
const provider = getProvider(cluster)
const issuer = `https://${args.fqdn}`

const masterkey = Secret.create(`${args.appName}-masterkey`, {
  namespace,
  stringData: { masterkey: getSecret("masterKey", () => randomBytes(24).toString("base64url")) },
})
const configuration = Secret.create(`${args.appName}-configuration`, {
  namespace,
  stringData: {
    "config-yaml": secret(
      all([inputs.postgresql, getSecret("adminPassword", generatePassword)]).apply(
        ([postgresql, password]) =>
          stringify({
            Database: { Postgres: { DSN: getPostgresqlConnectionUrl(postgresql, cluster) } },
            FirstInstance: { Org: { Human: { Password: password } } },
          }),
      ),
    ),
  },
})

// A release preserves the official chart's ordered init/setup and cleanup hooks.
const release = new helm.v3.Release(
  args.appName,
  {
    name: args.appName,
    chart: "zitadel",
    version: args.chartVersion,
    repositoryOpts: { repo: "https://charts.zitadel.com" },
    namespace: namespace.metadata.name,
    values: all([configuration.metadata.name, masterkey.metadata.name]).apply(
      ([configurationName, masterkeyName]) => zitadelValues(args, configurationName, masterkeyName),
    ),
    timeout: 900,
  },
  { provider, dependsOn: [configuration, masterkey], deletedWith: namespace },
)

const apiService = Service.get(
  `${args.appName}-api`,
  {
    namespace,
    name: args.appName,
  },
  { dependsOn: release },
)
const loginService = Service.get(
  `${args.appName}-login`,
  {
    namespace,
    name: `${args.appName}-login`,
  },
  { dependsOn: release },
)

new AccessPointRoute(
  args.appName,
  {
    type: "http",
    accessPoint: inputs.accessPoint,
    fqdn: args.fqdn,
    metadata: { "k8s.namespace": namespace },
    rules: {
      login: { path: "/ui/v2/login", backend: { endpoints: loginService.endpoints } },
      api: { path: "/", backend: { endpoints: apiService.endpoints } },
    },
  },
  { dependsOn: release },
)

const token =
  secrets.managementToken ??
  Secret.get(
    `${args.appName}-management-token`,
    {
      namespace,
      name: `${args.appName}-management-pat`,
    },
    { dependsOn: release },
  ).data.apply(data => {
    if (!data.pat) {
      throw new Error(
        "Zitadel bootstrap PAT is missing; supply the managementToken secret for an existing instance",
      )
    }

    return Buffer.from(data.pat, "base64").toString("utf8").trim()
  })

export default outputs({
  provider: makeEntityOutput({
    entity: oauth.providerEntity,
    identity: stateId,
    value: {
      identity: { protocol: "oidc", issuer },
      clientAuthMethod: "client_secret_basic",
      scopes: ["openid", "profile", "email"],
    },
  }),
  management: makeEntityOutput({
    entity: zitadel.managementEntity,
    identity: stateId,
    value: { issuer, token: secret(token) },
  }),
  $statusFields: { url: issuer, adminUsername: args.adminEmail },
})
