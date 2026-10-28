export type ZitadelValuesConfig = {
  appName: string
  fqdn: string
  imageTag: string
  loginImageTag: string
  replicas: number
  organizationName: string
  adminEmail: string
  adminFirstName: string
  adminLastName: string
  managementTokenExpiration: string
  scheduling?: Record<string, unknown>
}

/**
 * Values for the official zitadel/zitadel chart, validated against chart 10.4.0.
 */
export function zitadelValues(
  config: ZitadelValuesConfig,
  configSecretName: string,
  masterkeySecretName: string,
) {
  return {
    ...config.scheduling,
    fullnameOverride: config.appName,
    image: { tag: config.imageTag },
    replicaCount: config.replicas,
    postgresql: { enabled: false },
    ingress: { enabled: false },
    service: {
      port: 8080,
      appProtocol: "kubernetes.io/h2c",
      annotations: { "traefik.ingress.kubernetes.io/service.serversscheme": "h2c" },
    },
    // the database and its owner are provisioned by the separate PostgreSQL input
    initJob: { command: "zitadel" },
    zitadel: {
      masterkeySecretName,
      configSecretName,
      configmapConfig: {
        ExternalDomain: config.fqdn,
        ExternalPort: 443,
        ExternalSecure: true,
        TLS: { Enabled: false },
        FirstInstance: {
          Org: {
            Name: config.organizationName,
            Human: {
              UserName: config.adminEmail,
              FirstName: config.adminFirstName,
              LastName: config.adminLastName,
              Email: { Address: config.adminEmail, Verified: true },
            },
            Machine: {
              Machine: {
                Username: `${config.appName}-management`,
                Name: "Highstate application provisioning",
              },
              MachineKey: { ExpirationDate: config.managementTokenExpiration, Type: 1 },
              Pat: { ExpirationDate: config.managementTokenExpiration },
            },
          },
        },
      },
    },
    login: {
      ...config.scheduling,
      enabled: true,
      fullnameOverride: `${config.appName}-login`,
      image: { tag: config.loginImageTag },
      replicaCount: config.replicas,
      ingress: { enabled: false },
    },
  }
}
