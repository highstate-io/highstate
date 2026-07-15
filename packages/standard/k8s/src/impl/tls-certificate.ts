import { tlsCertificateMediator } from "@highstate/common"
import { common, k8s, tls } from "@highstate/library"
import { makeEntityOutput, makeSecretOutput, output } from "@highstate/pulumi"
import { Namespace } from "../namespace"
import { getProvider } from "../shared"
import { Certificate } from "../tls"

const certManagerUsages: Record<tls.CertificateUsage, string> = {
  digitalSignature: "digital signature",
  keyEncipherment: "key encipherment",
  serverAuth: "server auth",
  clientAuth: "client auth",
}

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

    const certificate = Certificate.create(
      name,
      {
        namespace,

        commonName: spec.commonName,
        dnsNames: spec.dnsNames,
        usages: spec.usages
          ? output(spec.usages).apply(usages => usages.map(mapCertificateUsage))
          : undefined,
        privateKey: spec.privateKey
          ? output(spec.privateKey).apply(privateKey => ({
              algorithm: privateKey.algorithm,
              ...(privateKey.size ? { size: privateKey.size } : {}),
            }))
          : undefined,
        issuerRef: {
          name: data.clusterIssuerName,
          kind: "ClusterIssuer",
        },
        secretName: `hs-certificate-${name}`,
      },
      { ...opts, provider },
    )

    const secret = certificate.secret
    const certificatePem = secret.apply(secret => secret.getValue("tls.crt"))
    const privateKeyPem = secret.apply(secret => secret.getValue("tls.key"))
    const chain = makeEntityOutput({
      entity: common.fileEntity,
      identity: `${name}:tls.crt`,
      meta: {
        title: "tls.crt",
      },
      value: {
        meta: {
          name: "tls.crt",
          contentType: "application/x-pem-file",
        },
        content: {
          type: "embedded-secret",
          value: makeSecretOutput(certificatePem),
        },
      },
    })
    const root = secret.apply(secret => {
      return secret.data.apply(data => {
        if (!data["ca.crt"]) {
          return undefined
        }

        return makeEntityOutput({
          entity: common.fileEntity,
          identity: `${name}:ca.crt`,
          meta: {
            title: "ca.crt",
          },
          value: {
            meta: {
              name: "ca.crt",
              contentType: "application/x-pem-file",
            },
            content: {
              type: "embedded",
              value: Buffer.from(data["ca.crt"], "base64").toString(),
            },
          },
        })
      })
    })
    const privateKey = makeEntityOutput({
      entity: common.fileEntity,
      identity: `${name}:tls.key`,
      meta: {
        title: "tls.key",
      },
      value: {
        meta: {
          name: "tls.key",
          contentType: "application/x-pem-file",
        },
        content: {
          type: "embedded-secret",
          value: makeSecretOutput(privateKeyPem),
        },
      },
    })
    const certificateChain = makeEntityOutput({
      entity: tls.certificateChainEntity,
      identity: `${name}:chain`,
      meta: {
        title: name,
      },
      value: {
        chain,
        root,
      },
    })

    return {
      resource: certificate,
      certificate: makeEntityOutput({
        entity: tls.certificateEntity,
        identity: certificate.metadata.uid,
        meta: {
          title: name,
        },
        value: {
          chain: certificateChain,
          privateKey,
        },
      }),
    }
  },
)

function mapCertificateUsage(usage: tls.CertificateUsage): string {
  return certManagerUsages[usage]
}
