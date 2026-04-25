import { tlsCertificateMediator } from "@highstate/common"
import { k8s } from "@highstate/library"
import { Namespace } from "../namespace"
import { getProvider } from "../shared"
import { Certificate } from "../tls"

export const createCertificate = tlsCertificateMediator.implement(
  k8s.tlsIssuerDataSchema,
  ({ name, spec, opts }, data) => {
    const provider = getProvider(data.cluster)

    const metadata = spec.metadata as Record<string, unknown> | undefined
    const metadataNamespace = metadata?.["k8s.namespace"]

    const namespace =
      metadataNamespace instanceof Namespace
        ? metadataNamespace
        : metadataNamespace
          ? Namespace.for(metadataNamespace as k8s.Namespace, data.cluster)
          : Namespace.get("cert-manager", { name: "cert-manager", cluster: data.cluster })

    return Certificate.create(
      name,
      {
        namespace,

        commonName: spec.commonName,
        dnsNames: spec.dnsNames,
        issuerRef: {
          name: data.clusterIssuerName,
          kind: "ClusterIssuer",
        },
        secretName: `hs-certificate-${name}`,
      },
      { ...opts, provider },
    )
  },
)
