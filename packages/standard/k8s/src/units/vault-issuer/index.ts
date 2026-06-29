import { cert_manager } from "@highstate/cert-manager"
import { l7EndpointToString } from "@highstate/common"
import { common, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput, output } from "@highstate/pulumi"
import { Namespace } from "../../namespace"
import { Secret } from "../../secret"
import { getProviderAsync } from "../../shared"

const { name, inputs, outputs } = forUnit(k8s.vaultTlsIssuer)

const provider = await getProviderAsync(inputs.k8sCluster)

const certManagerNs = Namespace.get("cert-manager", {
  name: "cert-manager",
  cluster: inputs.k8sCluster,
})

const vaultIssuer = output(inputs.vaultPkiIssuer)

const vaultConfig = vaultIssuer.apply(issuer => {
  const credentials = issuer.connection.credentials
  if (credentials.type !== "approle") {
    throw new Error("Vault PKI issuer connection must use AppRole credentials")
  }

  const endpoint = issuer.connection.endpoints[0]
  if (!endpoint) {
    throw new Error("Vault PKI issuer connection must include at least one endpoint")
  }

  return {
    server: l7EndpointToString(endpoint),
    path: `${issuer.path}/sign/${issuer.roleName}`,
    authPath: credentials.authPath,
    roleId: credentials.roleId,
    secretId: credentials.secretId.value,
    zones: issuer.dnsNames,
  }
})

const appRoleSecret = Secret.create(`${name}-vault-approle`, {
  namespace: certManagerNs,
  stringData: {
    secretId: vaultConfig.secretId,
  },
})

new cert_manager.v1.ClusterIssuer(
  name,
  {
    metadata: {
      name,
    },
    spec: {
      vault: {
        server: vaultConfig.server,
        path: vaultConfig.path,
        auth: {
          appRole: {
            path: vaultConfig.authPath,
            roleId: vaultConfig.roleId,
            secretRef: {
              name: appRoleSecret.metadata.name,
              key: "secretId",
            },
          },
        },
      },
    },
  },
  { provider, dependsOn: appRoleSecret },
)

export default outputs({
  tlsIssuer: makeEntityOutput({
    entity: common.tlsIssuerEntity,
    identity: `${name}:tls-issuer`,
    meta: {
      title: name,
    },
    value: {
      zones: vaultConfig.zones,
      implRef: {
        package: "@highstate/k8s",
        data: {
          clusterIssuerName: name,
          cluster: inputs.k8sCluster,
        },
      },
    },
  }),

  $statusFields: {
    zones: vaultConfig.zones,
  },
})
