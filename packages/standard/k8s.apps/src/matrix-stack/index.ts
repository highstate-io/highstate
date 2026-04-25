import { getEntityId } from "@highstate/contract"
import { Chart, ConfigMap, Deployment, Namespace } from "@highstate/k8s"
import { k8s, type postgresql } from "@highstate/library"
import { forUnit, output } from "@highstate/pulumi"
import { charts, createPostgresqlCredentialsSecret, images } from "../shared"
import { createInitSecretsJob } from "./init-secrets-job"

const { args, inputs, outputs } = forUnit(k8s.apps.matrixStack)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const synapseHost = `synapse.${args.fqdn}`
const elementWebHost = `chat.${args.fqdn}`
const matrixAuthenticationServiceHost = `account.${args.fqdn}`
const matrixRtcHost = `mrtc.${args.fqdn}`
const elementAdminHost = `admin.${args.fqdn}`

const HELM_INGRESS_DISABLED_VALUE = "none"

function createPostgresConfig(connection: postgresql.Connection) {
  if (!connection.database) {
    throw new Error(`Connection "${getEntityId(connection)}" does not have a database specified`)
  }

  const postgresCredentials = createPostgresqlCredentialsSecret(
    `${args.appName}-${connection.database}-postgres-credentials`,
    namespace,
    connection,
  )

  return output({
    host: postgresCredentials.stringData.host,
    port: postgresCredentials.stringData.port.apply(parseInt),
    user: postgresCredentials.stringData.username,
    database: postgresCredentials.stringData.database,
    sslMode: connection.insecure ? "disable" : "require",
    password: {
      secret: postgresCredentials.metadata.name,
      secretKey: "password",
    },
  })
}

const initSecretsJob = await createInitSecretsJob(args.appName, namespace, inputs.k8sCluster)

const chart = new Chart(
  args.appName,
  {
    namespace,
    chart: charts["matrix-stack"],

    values: {
      serverName: args.fqdn,
      ingress: {
        className: HELM_INGRESS_DISABLED_VALUE,
      },

      synapse: {
        ingress: {
          host: args.fqdn,
        },
        postgres: createPostgresConfig(inputs.synapsePostgresql),
        additional: {
          "user-config.yaml": {
            config: JSON.stringify(
              {
                federation_domain_whitelist: args.federationDomainWhitelist,
              },
              null,
              2,
            ),
          },
        },
      },
      elementWeb: {
        ingress: {
          host: elementWebHost,
        },
      },
      elementAdmin: {
        ingress: {
          host: elementAdminHost,
        },
      },
      matrixAuthenticationService: {
        ingress: {
          host: matrixAuthenticationServiceHost,
        },
        postgres: createPostgresConfig(inputs.masPostgresql),
        additional: {
          "auth.yaml": {
            config: JSON.stringify(
              {
                account: {
                  password_registration_enabled: true,
                  registration_token_required: true,
                  password_registration_email_required: false,
                  password_change_allowed: true,
                },
              },
              null,
              2,
            ),
          },
        },
      },
      matrixRTC: {
        ingress: {
          host: matrixRtcHost,
        },
      },
      wellKnownDelegation: {
        baseDomainRedirect: {
          enabled: false,
        },
      },
      postgres: {
        enabled: false,
      },
    },

    accessPoint: inputs.accessPoint,

    routes: {
      main: {
        type: "http",
        fqdn: args.fqdn,
        rules: {
          discovery: {
            path: "/.well-known/matrix",
            serviceName: `${args.appName}-well-known`,
          },
          synapse: {
            paths: ["/_matrix", "/_synapse"],
            serviceName: `${args.appName}-synapse`,
          },
          mas: {
            paths: [
              "/_matrix/client/api/v1/login",
              "/_matrix/client/api/v1/refresh",
              "/_matrix/client/api/v1/logout",
              "/_matrix/client/r0/login",
              "/_matrix/client/r0/refresh",
              "/_matrix/client/r0/logout",
              "/_matrix/client/v3/login",
              "/_matrix/client/v3/refresh",
              "/_matrix/client/v3/logout",
              "/_matrix/client/unstable/login",
              "/_matrix/client/unstable/refresh",
              "/_matrix/client/unstable/logout",
            ],
            serviceName: `${args.appName}-matrix-authentication-service`,
          },
        },
      },
      "element-web": {
        type: "http",
        fqdn: elementWebHost,
        serviceName: `${args.appName}-element-web`,
      },
      "element-admin": {
        type: "http",
        fqdn: elementAdminHost,
        serviceName: `${args.appName}-element-admin`,
      },
      mas: {
        type: "http",
        fqdn: matrixAuthenticationServiceHost,
        serviceName: `${args.appName}-matrix-authentication-service`,
      },
      rtc: {
        type: "http",
        fqdn: matrixRtcHost,
        rules: {
          sfu: {
            serviceName: `${args.appName}-matrix-rtc-sfu`,
          },
          auth: {
            paths: ["/sfu/get", "/get_token"],
            serviceName: `${args.appName}-matrix-rtc-authorisation-service`,
          },
        },
      },
    },

    terminal: {
      shell: "sh",
    },
  },
  {
    dependsOn: initSecretsJob,
    transforms: [
      args => {
        if (args.type === "kubernetes:networking.k8s.io/v1:Ingress") {
          return {
            props: {
              ...args.props,
              metadata: {
                ...args.props.metadata,
                annotations: {
                  ...args.props.metadata?.annotations,
                  "pulumi.com/skipAwait": "true",
                },
              },
            },
            opts: args.opts,
          }
        }

        return undefined
      },
    ],
  },
)

const createUserTerminal = chart
  .getWorkloadOutput(`${args.appName}-matrix-authentication-service`)
  .apply(workload => {
    return workload.createTerminal(
      "create-user",
      {
        title: "MAS Create User",
        globalTitle: `MAS Create User | ${args.appName}`,
        description: "Register a user in Matrix Authentication Service.",
        icon: "simple-icons:matrix",
      },
      ["mas-cli", "manage", "register-user"],
    )
  })

if (args.enableCinny) {
  const config = {
    defaultHomeserver: 0,
    homeserverList: [args.fqdn, "vinaigrette.mktk.cc"],
    allowCustomHomeservers: false,

    featuredCommunities: {
      openAsDefault: false,
      spaces: [],
      rooms: [],
      servers: [],
    },

    hashRouter: {
      enabled: false,
      basename: "/",
    },
  }

  const configMap = ConfigMap.create(`${args.appName}-cinny-config`, {
    namespace,

    data: {
      "config.json": JSON.stringify(config, null, 2),
    },
  })

  Deployment.create(`${args.appName}-cinny`, {
    namespace,

    containers: [
      {
        name: "cinny",
        image: images.cinny.image,

        port: {
          name: "web",
          containerPort: 80,
        },
      },
      {
        name: "config",
        image: images["static-file-server"].image,

        port: {
          name: "config",
          containerPort: 8080,
        },

        volumeMount: {
          volume: configMap,
          mountPath: "/web",
        },
      },
    ],

    route: {
      accessPoint: inputs.accessPoint,
      type: "http",
      fqdn: `cinny.${args.fqdn}`,

      rules: {
        cinny: {
          servicePort: "web",
        },
        config: {
          servicePort: "config",
          path: "/config.json",
        },
      },
    },
  })
}

export default outputs({
  $statusFields: {
    serverName: args.fqdn,
    synapse: `https://${synapseHost}`,
    elementWeb: `https://${elementWebHost}`,
    elementAdmin: `https://${elementAdminHost}`,
    matrixAuthenticationService: `https://${matrixAuthenticationServiceHost}`,
    matrixRtc: `https://${matrixRtcHost}`,
  },

  $terminals: output({ terminals: chart.terminals, createUserTerminal }).apply(
    ({ terminals, createUserTerminal }) => [...terminals, createUserTerminal],
  ),
})
