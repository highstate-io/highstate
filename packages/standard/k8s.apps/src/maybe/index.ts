import { generatePassword, l4EndpointToString } from "@highstate/common"
import {
  Chart,
  Deployment,
  Namespace,
  NetworkPolicy,
  PersistentVolumeClaim,
  Secret,
} from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { PostgreSQLDatabase } from "../postgresql"
import { charts, images } from "../shared"

const { args, inputs, getSecret, outputs } = forUnit(k8s.apps.maybe)

const backupPassword = getSecret("backupPassword", generatePassword)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
})

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey: backupPassword,

        volume: dataVolumeClaim,
      },
      { dependsOn: dataVolumeClaim },
    )
  : undefined

const database = new PostgreSQLDatabase(args.appName, {
  namespace,
  postgresql: inputs.postgresql,
  password: getSecret("postgresqlPassword", generatePassword),
})

const secretKeySecret = Secret.create(`${args.appName}-secret-key`, {
  namespace,

  stringData: {
    "secret-key": getSecret("secretKey", () => bytesToHex(randomBytes(64))),
  },
})

const redis = new Chart(`${args.appName}-redis`, {
  namespace,

  chart: charts.redis,
  serviceName: `${args.appName}-redis-master`,

  values: {
    fullnameOverride: `${args.appName}-redis`,
    architecture: "standalone",
    auth: {
      enabled: false,
    },
    networkPolicy: {
      enabled: false,
    },
  },

  networkPolicy: {
    ingressRule: {
      fromNamespace: namespace,
    },
  },
})

const sharedEnv = {
  SELF_HOSTED: "true",
  RAILS_FORCE_SSL: "false",
  RAILS_ASSUME_SSL: "false",

  SECRET_KEY_BASE: {
    secret: secretKeySecret,
    key: "secret-key",
  },

  DB_HOST: {
    secret: database.credentials,
    key: "host",
  },

  DB_PORT: {
    secret: database.credentials,
    key: "port",
  },

  POSTGRES_DB: {
    secret: database.credentials,
    key: "database",
  },

  POSTGRES_USER: {
    secret: database.credentials,
    key: "username",
  },

  POSTGRES_PASSWORD: {
    secret: database.credentials,
    key: "password",
  },

  REDIS_URL: redis.service.endpoints[0].apply(l4EndpointToString).apply(ep => `redis://${ep}/1`),
}

Deployment.create(
  `${args.appName}-web`,
  {
    namespace,

    container: {
      image: images.maybe.image,

      port: {
        name: "http",
        containerPort: 3000,
      },

      environment: sharedEnv,
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },

    networkPolicy: {
      egressRule: {
        toEndpoints: redis.service.endpoints,
      },
    },
  },
  {
    dependsOn: backupJobPair?.restoreJob
      ? [database.initJob, backupJobPair?.restoreJob, redis.chart]
      : [database.initJob, redis.chart],
  },
)

Deployment.create(
  `${args.appName}-worker`,
  {
    namespace,

    container: {
      image: images.maybe.image,
      command: ["bundle", "exec", "sidekiq"],

      environment: sharedEnv,
    },

    networkPolicy: {
      egressRule: {
        toEndpoints: redis.service.endpoints,
      },
    },
  },
  {
    dependsOn: redis.chart,
  },
)

NetworkPolicy.isolate(namespace, inputs.k8sCluster)

export default outputs({})
