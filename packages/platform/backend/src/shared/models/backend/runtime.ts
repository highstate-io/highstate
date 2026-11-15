/**
 * Backend-owned runtime settings; stored secrets are encrypted rather than wire input bytes.
 */
export type ContainerRuntimeSpec = {
  runtimeApiUrl: string
  runtimeApiCaBundle?: string
  imageRepository?: string
} & (
  | {
      type: "docker"
      engineEndpoint: string
      local: boolean
      tls?: {
        encryptedCaBundle?: string
        encryptedClientCertificate?: string
        encryptedClientKey?: string
      }
    }
  | {
      type: "kubernetes"
      encryptedKubeconfig?: string
      context?: string
      namespace: string
      serviceAccount: string
      buildkitImage: string
    }
)

/**
 * Reusable Pulumi state configuration independent of workload placement.
 */
export type PulumiStateBackendSpec = {
  url: string
  encryptedCredentials?: string
}
