import { cert_manager } from "@highstate/cert-manager"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { dns01SolverMediator } from "../../dns01-solver"
import { Namespace } from "../../namespace"
import { getProviderAsync } from "../../shared"

const { name, inputs, outputs } = forUnit(k8s.dns01TlsIssuer)

const provider = await getProviderAsync(inputs.k8sCluster)

const certManagerNs = Namespace.get("cert-manager", {
  name: "cert-manager",
  cluster: inputs.k8sCluster,
})

new cert_manager.v1.ClusterIssuer(
  name,
  {
    metadata: {
      name,
    },
    spec: {
      acme: {
        server: "https://acme-v02.api.letsencrypt.org/directory",
        solvers: [
          {
            dns01: dns01SolverMediator.callOutput(inputs.dnsProvider.implRef, {
              namespace: certManagerNs,
            }),
            selector: { dnsZones: [inputs.dnsProvider.domain] },
          },
        ],
        privateKeySecretRef: {
          name,
        },
      },
    },
  },
  { provider },
)

export default outputs({
  $statusFields: {
    domain: inputs.dnsProvider.domain,
  },

  tlsIssuer: {
    domain: inputs.dnsProvider.domain,
    implRef: {
      package: "@highstate/k8s",
      data: {
        clusterIssuerName: name,
        cluster: inputs.k8sCluster,
      },
    },
  },
})
