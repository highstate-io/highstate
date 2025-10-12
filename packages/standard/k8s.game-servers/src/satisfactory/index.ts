import {
  DnsRecordSet,
  filterEndpoints,
  generateKey,
  l3EndpointToString,
  TlsCertificate,
} from "@highstate/common"
import {
  type Certificate,
  Deployment,
  getProviderAsync,
  Namespace,
  PersistentVolumeClaim,
} from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, type Output, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { images } from "../shared"

const { args, inputs, invokedTriggers, getSecret, outputs } = forUnit(k8s.gameServers.satisfactory)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })
const _provider = await getProviderAsync(inputs.k8sCluster)

const backupKey = getSecret("backupKey", generateKey)

// 1. setup cert-manager ca issur to generate the certs for the game server which will be able to be vefified by the access point

// the one-time issuer for ca
// const caIssuer = new cert_manager.v1.Issuer(
//   "ca",
//   {
//     metadata: { name: "ca", namespace: namespace.metadata.name },
//     spec: {
//       selfSigned: {},
//     },
//   },
//   { provider },
// )

// // the ca itself
// const ca = Certificate.create("ca", {
//   namespace,

//   isCA: true,
//   commonName: "satisfactory-ca",
//   secretName: "satisfactory-ca",
//   issuerRef: {
//     name: caIssuer.metadata.name,
//     kind: "Issuer",
//   },
// })

// // the actual issuer for the certs
// const issuer = new cert_manager.v1.Issuer(
//   "server",
//   {
//     metadata: { name: "server", namespace: namespace.metadata.name },
//     spec: {
//       ca: {
//         secretName: ca.spec.secretName,
//       },
//     },
//   },
//   { provider },
// )

// // the cert for the game server
// const certificate = Certificate.create("server", {
//   namespace,

//   commonName: "satisfactory-server",
//   secretName: "satisfactory-tls",
//   issuerRef: {
//     name: issuer.metadata.name,
//     kind: "Issuer",
//   },

//   // TODO: support possible custom cluster domain
//   dnsNames: [`${args.appName}.${args.appName}.svc.cluster.local`],
// })

const dataVolumeClaim = PersistentVolumeClaim.create("data", {
  namespace,
  size: "1Gi",
})

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        volume: dataVolumeClaim,

        // include only game saves, blueprints and server settings
        include: ["/data/saved"],
      },
      { dependsOn: dataVolumeClaim },
    )
  : undefined

const certificate = TlsCertificate.createOnce("satisfactory", {
  issuers: inputs.accessPoint.tlsIssuers,
  dnsNames: [args.fqdn],
  nativeData: namespace,
})

// 2. deploy the game server itself
const deployment = Deployment.create(args.appName, {
  namespace,

  // set permissions for the data volume
  initContainer: {
    image: images.busybox.image,
    command: ["sh", "-c", "chown -R 1000:1000 /data"],

    volumeMount: {
      volume: dataVolumeClaim,
      mountPath: "/data",
    },
  },

  container: {
    image: images.satisfactory.image,

    volumeMounts: [
      { volume: dataVolumeClaim, mountPath: "/config" },

      // mount the certs so the game server can use them
      {
        volume: (certificate.resource as Output<Certificate>).secret,
        mountPath: "/config/gamefiles/FactoryGame/Certificates/cert_chain.pem",
        subPath: "tls.crt",
      },
      {
        volume: (certificate.resource as Output<Certificate>).secret,
        mountPath: "/config/gamefiles/FactoryGame/Certificates/private_key.pem",
        subPath: "tls.key",
      },
    ],

    ports: [
      { name: "api", containerPort: args.port, protocol: "TCP" },
      { name: "game", containerPort: args.port, protocol: "UDP" },
      { name: "messaging", containerPort: 8888, protocol: "TCP" },
    ],

    securityContext: {
      runAsUser: 1000,
      runAsGroup: 1000,
      runAsNonRoot: true,
    },
  },

  service: {
    external: true,
  },
})

const endpoints = await toPromise(inputs.k8sCluster.endpoints)
const publicEndpoint = filterEndpoints(endpoints, ["public"])[0]

if (!publicEndpoint) {
  throw new Error(
    "Failed to determine public endpoint of the game server. Available endpoints: " +
      endpoints.map(l3EndpointToString).join(", "),
  )
}

new DnsRecordSet(args.fqdn, {
  providers: inputs.accessPoint.dnsProviders,
  value: filterEndpoints(endpoints, ["public"])[0],
  waitAt: "local",
})

export default outputs({
  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: [deployment.terminal, backupJobPair?.terminal],
})
