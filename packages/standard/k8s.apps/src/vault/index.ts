import { generateKey, l4EndpointToL7, l7EndpointToString } from "@highstate/common"
import { z } from "@highstate/contract"
import { Chart, ClusterAccessScope, KubeCommand, Namespace, Secret } from "@highstate/k8s"
import { k8s, vault } from "@highstate/library"
import { forUnit, makeEntityOutput, makeSecretOutput, output, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../shared"

const {
  //
  args,
  getSecret,
  inputs,
  invokedTriggers,
  outputs,
  stateId,
  setSecret,
} = forUnit(k8s.apps.vault)

const vaultInitOutputSchema = z.object({
  root_token: z.string(),
  unseal_keys_b64: z.string().array(),
})

function createVaultInitScript(): string {
  return [
    "set -u",
    "export VAULT_ADDR=http://127.0.0.1:8200",
    "status_code=1",
    'while [ "$status_code" -eq 1 ]; do',
    "  status_code=0",
    "  vault status >/dev/null 2>&1 || status_code=$?",
    '  if [ "$status_code" -eq 1 ]; then sleep 2; fi',
    "done",
    `init_output=$(vault operator init -format=json -key-shares=${args.autoInit.shares} -key-threshold=${args.autoInit.threshold} 2>&1) && { printf '%s\n' "$init_output"; exit 0; }`,
    "init_status=$?",
    'case "$init_output" in',
    '  *"Vault is already initialized"*)',
    "    exit 0",
    "    ;;",
    "  *)",
    "    printf '%s\n' \"$init_output\" >&2",
    '    exit "$init_status"',
    "    ;;",
    "esac",
  ].join("\n")
}

function createVaultInitCommand(): string {
  const script = Buffer.from(createVaultInitScript()).toString("base64")

  return `sh -c "echo ${script} | base64 -d | sh"`
}

function parseVaultInitOutput(stdout: string): { rootToken: string; unsealKeys: string[] } {
  const parsed = vaultInitOutputSchema.parse(JSON.parse(stdout))

  return {
    rootToken: parsed.root_token,
    unsealKeys: parsed.unseal_keys_b64,
  }
}

const { k8sCluster, s3Bucket, resticRepo } = await toPromise(inputs)

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: k8sCluster })

const backupKey = getSecret("backupKey", generateKey)
let rootToken = getSecret("rootToken", () => "")

// prepare secrets and values for chart
// biome-ignore lint/suspicious/noExplicitAny: dynamic chart values
let chartValues: any = {
  server: {
    ha: {
      enabled: false,
    },
    readinessProbe: {
      enabled: false, // otherwise service will freeze unless vault is unsealed
    },
  },
}

let s3Secret: Secret | undefined

if (args.backend === "s3") {
  if (!s3Bucket) {
    throw new Error("s3Bucket input is required when backend is 's3'")
  }

  s3Secret = Secret.create(`${args.appName}-s3-credentials`, {
    namespace,
    stringData: {
      AWS_ACCESS_KEY_ID: s3Bucket.credentials.accessKey.value,
      AWS_SECRET_ACCESS_KEY: s3Bucket.credentials.secretKey.value,
    },
  })

  chartValues = {
    ...chartValues,
    server: {
      ...chartValues.server,
      dataStorage: {
        storageType: "s3",
        s3: {
          bucket: s3Bucket.name,
          region: s3Bucket.region,
          endpoint: s3Bucket.endpoints[0]?.address,
          existingSecret: s3Secret.metadata.name,
          existingSecretAccessKey: "AWS_ACCESS_KEY_ID",
          existingSecretSecretKey: "AWS_SECRET_ACCESS_KEY",
        },
      },
    },
  }
}

const backupJobPair =
  resticRepo && args.backend === "file"
    ? new BackupJobPair(
        `${args.appName}-0`,
        {
          namespace,

          resticRepo,
          backupKey,
          scheduling: args.scheduling,

          volume: {
            name: "data",
            persistentVolumeClaim: {
              claimName: `data-${args.appName}-0`,
            },
          },
        },
        { deletedWith: namespace },
      )
    : undefined

const restoreAccess = backupJobPair
  ? new ClusterAccessScope(
      `${args.appName}-restore`,
      {
        namespace,
        rule: backupJobPair.restoreWaitRule,
      },
      { deletedWith: namespace },
    )
  : undefined

const chart = new Chart(
  args.appName,
  {
    namespace,
    args,
    chart: charts.vault,
    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,
      ...chartValues,
      injector: args.scheduling,
      server: {
        ...chartValues.server,
        ...args.scheduling,
        ...(backupJobPair &&
          restoreAccess && {
            extraInitContainers: [backupJobPair.restoreWaitContainer],
            serviceAccount: {
              create: false,
              name: restoreAccess.serviceAccountName,
            },
          }),
      },
      csi: {
        pod: args.scheduling,
      },
    },
    routes: args.fqdn
      ? {
          main: {
            type: "http",
            fqdn: args.fqdn,
            accessPoint: inputs.accessPoint,
            servicePort: 8200,
          },
        }
      : {},
  },
  { dependsOn: s3Secret, deletedWith: namespace },
)

if (args.autoInit.enabled) {
  const initCommand = KubeCommand.execInto(
    args.appName,
    {
      workload: chart.statefulSet,
      create: createVaultInitCommand(),
    },
    { dependsOn: chart, deletedWith: namespace },
  )

  const initStdout = (await toPromise(initCommand.stdout)).trim()

  if (initStdout !== "") {
    const initOutput = parseVaultInitOutput(initStdout)
    rootToken = output(initOutput.rootToken)

    setSecret("unsealKeys", initOutput.unsealKeys)
    setSecret("rootToken", initOutput.rootToken)
  }
}

const service = await toPromise(chart.service)
const endpoints = (await toPromise(service.endpoints))
  .filter(endpoint => endpoint.port === 8200)
  .map(endpoint => l4EndpointToL7(endpoint, "http"))

if (endpoints.length === 0) {
  throw new Error("Vault service does not expose API port 8200")
}

const connection = makeEntityOutput({
  entity: vault.connectionEntity,
  identity: stateId,
  meta: {
    title: args.appName,
  },
  value: {
    endpoints,
    credentials: {
      type: "token",
      token: makeSecretOutput(rootToken),
    },
  },
})

const backupJobPairs = output(backupJobPair ? [backupJobPair] : [])

export default outputs({
  connection,
  statefulSet: chart.statefulSet.entity,

  $statusFields: {
    endpoint: args.fqdn ? `https://${args.fqdn}` : undefined,
    endpoints: endpoints.map(l7EndpointToString),
  },

  $triggers: backupJobPairs.apply(backupJobPairs => {
    return backupJobPairs.map(backupJobPair => backupJobPair.handleTrigger(invokedTriggers))
  }),

  $terminals: output({ backupJobPairs, terminals: chart.terminals }).apply(
    ({ backupJobPairs, terminals }) => {
      return [...terminals, ...backupJobPairs.flatMap(backupJobPair => backupJobPair.terminals)]
    },
  ),
})
