import { cert_manager } from "@highstate/cert-manager"
import { common, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { dns01SolverMediator } from "../../dns01-solver"
import { Namespace } from "../../namespace"
import { Secret } from "../../secret"
import { getProviderAsync } from "../../shared"

const { name, args, secrets, inputs, outputs } = forUnit(k8s.dns01TlsIssuer)

const provider = await getProviderAsync(inputs.k8sCluster)

const certManagerNs = Namespace.get("cert-manager", {
  name: "cert-manager",
  cluster: inputs.k8sCluster,
})

let eabSecret: Secret | undefined

if (args.acmeServer.type === "zerossl") {
  if (!secrets.eabKeyId || !secrets.eabKeySecret) {
    throw new Error("EAB key ID and secret are required for ZeroSSL ACME server")
  }

  eabSecret = Secret.create(`${name}-eab`, {
    namespace: certManagerNs,
    stringData: {
      keyId: secrets.eabKeyId,
      keySecret: secrets.eabKeySecret,
    },
  })
}

const getAcmeServer = () => {
  switch (args.acmeServer.type) {
    case "zerossl":
      return "https://acme.zerossl.com/v2/DV90"
    case "letsencrypt":
      return "https://acme-v02.api.letsencrypt.org/directory"
    case "custom":
      return args.acmeServer.url
  }
}

new cert_manager.v1.ClusterIssuer(
  name,
  {
    metadata: {
      name,
    },
    spec: {
      acme: {
        server: getAcmeServer(),
        solvers: [
          {
            dns01: dns01SolverMediator.callOutput(inputs.dnsProvider.implRef, {
              namespace: certManagerNs,
            }),
            selector: { dnsZones: inputs.dnsProvider.zones },
          },
        ],
        privateKeySecretRef: {
          name,
        },
        externalAccountBinding: eabSecret
          ? {
              keyID: eabSecret.stringData.keyId,
              keySecretRef: {
                name: eabSecret.metadata.name,
                key: "keySecret",
              },
            }
          : undefined,
      },
    },
  },
  { provider },
)

export default outputs({
  tlsIssuer: makeEntityOutput({
    entity: common.tlsIssuerEntity,
    identity: `${name}:tls-issuer`,
    meta: {
      title: name,
    },
    value: {
      zones: inputs.dnsProvider.zones,
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
    zones: inputs.dnsProvider.zones,
  },
})
