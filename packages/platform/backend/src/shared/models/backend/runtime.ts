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
        /**
         * The CA bundle as ASCII-armored AGE ciphertext encrypted to the backend AGE recipient.
         */
        encryptedCaBundle?: string

        /**
         * The client certificate as ASCII-armored AGE ciphertext encrypted to the backend AGE recipient.
         */
        encryptedClientCertificate?: string

        /**
         * The client key as ASCII-armored AGE ciphertext encrypted to the backend AGE recipient.
         */
        encryptedClientKey?: string
      }
    }
  | {
      type: "kubernetes"
      /**
       * The kubeconfig as ASCII-armored AGE ciphertext encrypted to the backend AGE recipient.
       */
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
  /**
   * Authentication text as ASCII-armored AGE ciphertext encrypted to the backend AGE recipient.
   */
  encryptedCredentials?: string
}
