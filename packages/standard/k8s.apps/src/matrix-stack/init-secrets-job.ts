import type { k8s } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { getProviderAsync, Job, type Namespace } from "@highstate/k8s"
import { output } from "@highstate/pulumi"
import { core, rbac } from "@pulumi/kubernetes"
import { images } from "../shared"

const MATRIX_TOOLS_VERSION = images["matrix-tools"].tag

export async function createInitSecretsJob(
  appName: string,
  namespace: Input<Namespace>,
  cluster: Input<k8s.Cluster>,
): Promise<Job> {
  const provider = await getProviderAsync(cluster)

  const initSecretsName = `${appName}-init-secrets`

  const serviceAccount = new core.v1.ServiceAccount(
    initSecretsName,
    {
      metadata: {
        name: initSecretsName,
        namespace: output(namespace).metadata.name,
      },
    },
    { provider },
  )

  const role = new rbac.v1.Role(
    initSecretsName,
    {
      metadata: {
        name: initSecretsName,
        namespace: output(namespace).metadata.name,
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["secrets"],
          verbs: ["create"],
        },
        {
          apiGroups: [""],
          resources: ["secrets"],
          resourceNames: [`${appName}-generated`],
          verbs: ["get", "update"],
        },
      ],
    },
    { provider },
  )

  const roleBinding = new rbac.v1.RoleBinding(
    initSecretsName,
    {
      metadata: {
        name: initSecretsName,
        namespace: output(namespace).metadata.name,
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: role.metadata.name,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.metadata.name,
          namespace: serviceAccount.metadata.namespace,
        },
      ],
    },
    { provider },
  )

  const initSecretsLabelsArg = [
    "app.kubernetes.io/managed-by=Helm",
    "app.kubernetes.io/part-of=matrix-stack",
    "app.kubernetes.io/component=matrix-tools",
    "app.kubernetes.io/name=init-secrets",
    `app.kubernetes.io/instance=${initSecretsName}`,
    `app.kubernetes.io/version=${MATRIX_TOOLS_VERSION}`,
  ].join(",")

  const initSecretsArg = [
    `${appName}-generated:ELEMENT_CALL_LIVEKIT_SECRET:rand32`,
    `${appName}-generated:SYNAPSE_EXTRA:extra`,
    `${appName}-generated:SYNAPSE_MACAROON:rand32`,
    `${appName}-generated:SYNAPSE_REGISTRATION_SHARED_SECRET:rand32`,
    `${appName}-generated:SYNAPSE_SIGNING_KEY:signingkey`,
    `${appName}-generated:MAS_SYNAPSE_SHARED_SECRET:rand32`,
    `${appName}-generated:MAS_ENCRYPTION_SECRET:hex32`,
    `${appName}-generated:MAS_RSA_PRIVATE_KEY:rsa:4096:der`,
    `${appName}-generated:MAS_ECDSA_PRIME256V1_PRIVATE_KEY:ecdsaprime256v1`,
  ].join(",")

  return Job.create(
    initSecretsName,
    {
      namespace,
      backoffLimit: 6,
      completionMode: "NonIndexed",
      completions: 1,
      manualSelector: false,
      parallelism: 1,
      podReplacementPolicy: "TerminatingOrFailed",

      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/managed-by": "Helm",
            "app.kubernetes.io/part-of": "matrix-stack",
            "app.kubernetes.io/component": "matrix-tools",
            "app.kubernetes.io/name": "init-secrets",
            "app.kubernetes.io/instance": initSecretsName,
            "app.kubernetes.io/version": MATRIX_TOOLS_VERSION,
          },
        },
        spec: {
          automountServiceAccountToken: true,
          serviceAccountName: serviceAccount.metadata.name,
          restartPolicy: "Never",
          securityContext: {
            fsGroup: 10010,
            runAsGroup: 10010,
            runAsNonRoot: true,
            runAsUser: 10010,
            seccompProfile: {
              type: "RuntimeDefault",
            },
            supplementalGroups: [],
          },
          topologySpreadConstraints: [
            {
              labelSelector: {
                matchLabels: {
                  "app.kubernetes.io/instance": initSecretsName,
                },
              },
              matchLabelKeys: [],
              maxSkew: 1,
              topologyKey: "kubernetes.io/hostname",
              whenUnsatisfiable: "ScheduleAnyway",
            },
          ],
        },
      },

      container: {
        name: "init-secrets",
        image: images["matrix-tools"].image,
        imagePullPolicy: "Always",
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: {
            drop: ["ALL"],
          },
          readOnlyRootFilesystem: true,
        },
        resources: {
          limits: {
            memory: "200Mi",
          },
          requests: {
            cpu: "50m",
            memory: "50Mi",
          },
        },
        environment: {
          NAMESPACE: output(namespace).metadata.name,
        },
        args: ["generate-secrets", "-secrets", initSecretsArg, "-labels", initSecretsLabelsArg],
      },
    },
    { dependsOn: [serviceAccount, role, roleBinding] },
  )
}
