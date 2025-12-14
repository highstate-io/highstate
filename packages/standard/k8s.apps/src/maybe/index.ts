import { generatePassword, l4EndpointToString } from "@highstate/common"
import { Deployment, Namespace, NetworkPolicy, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { PostgreSQLDatabase } from "../postgresql"
import { images } from "../shared"

const { args, inputs, getSecret, outputs } = forUnit(k8s.apps.maybe)

const backupKey = getSecret("backupKey", generatePassword)

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
        backupKey,

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

  REDIS_URL: inputs.redis.endpoints[0].apply(l4EndpointToString).apply(ep => `redis://${ep}/1`),
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
        toEndpoints: inputs.redis.endpoints,
      },
    },
  },
  {
    dependsOn: backupJobPair?.restoreJob
      ? [database.initJob, backupJobPair?.restoreJob]
      : [database.initJob],
  },
)

Deployment.create(`${args.appName}-worker`, {
  namespace,

  container: {
    image: images.maybe.image,
    command: ["bundle", "exec", "sidekiq"],

    environment: sharedEnv,
  },

  networkPolicy: {
    egressRule: {
      toEndpoints: inputs.redis.endpoints,
    },
  },
})

NetworkPolicy.isolateNamespace(namespace, inputs.k8sCluster)

export default outputs({})
