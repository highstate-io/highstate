import type { Namespace } from "@highstate/k8s"
import type { k8s } from "@highstate/library"
import { getProviderAsync } from "@highstate/k8s"
import { type Input, interpolate, output } from "@highstate/pulumi"
import { admissionregistration, batch, core, rbac } from "@pulumi/kubernetes"
import { charts } from "../shared"

type CertgenArgs = {
  appName: string
  namespace: Input<Namespace>
  cluster: Input<k8s.Cluster>
  nodeSelector: Record<string, string>
}

export async function createCertgenJob(args: CertgenArgs): Promise<batch.v1.Job> {
  const provider = await getProviderAsync(args.cluster)
  const namespaceName = output(args.namespace).metadata.name

  const chartVersion = charts["envoy-gateway"].version
  const certgenName = `${args.appName}-certgen`
  const webhookName = interpolate`${args.appName}-topology-injector.${namespaceName}`

  const labels = {
    "helm.sh/chart": `gateway-helm-${chartVersion}`,
    "app.kubernetes.io/name": "gateway-helm",
    "app.kubernetes.io/instance": args.appName,
    "app.kubernetes.io/version": `v${chartVersion}`,
    "app.kubernetes.io/managed-by": "Helm",
  }

  const serviceAccount = new core.v1.ServiceAccount(
    certgenName,
    {
      metadata: {
        name: certgenName,
        namespace: namespaceName,
        labels,
      },
    },
    { provider },
  )

  const webhook = new admissionregistration.v1.MutatingWebhookConfiguration(
    `${args.appName}-topology-injector`,
    {
      metadata: {
        name: webhookName,
        labels: {
          ...labels,
          "app.kubernetes.io/component": "topology-injector",
        },
      },
      webhooks: [
        {
          name: "topology.webhook.gateway.envoyproxy.io",
          admissionReviewVersions: ["v1"],
          sideEffects: "None",
          clientConfig: {
            service: {
              name: "envoy-gateway",
              namespace: namespaceName,
              path: "/inject-pod-topology",
              port: 9443,
            },
          },
          failurePolicy: "Ignore",
          rules: [
            {
              operations: ["CREATE"],
              apiGroups: [""],
              apiVersions: ["v1"],
              resources: ["pods/binding"],
            },
          ],
          namespaceSelector: {
            matchExpressions: [
              {
                key: "kubernetes.io/metadata.name",
                operator: "In",
                values: [namespaceName],
              },
            ],
          },
        },
      ],
    },
    { provider },
  )

  const clusterRole = new rbac.v1.ClusterRole(
    certgenName,
    {
      metadata: {
        name: interpolate`${certgenName}:${namespaceName}`,
        labels,
      },
      rules: [
        {
          apiGroups: ["admissionregistration.k8s.io"],
          resources: ["mutatingwebhookconfigurations"],
          verbs: ["get", "list", "watch"],
        },
        {
          apiGroups: ["admissionregistration.k8s.io"],
          resources: ["mutatingwebhookconfigurations"],
          resourceNames: [webhook.metadata.name],
          verbs: ["update", "patch"],
        },
      ],
    },
    { provider },
  )

  const clusterRoleBinding = new rbac.v1.ClusterRoleBinding(
    certgenName,
    {
      metadata: {
        name: clusterRole.metadata.name,
        labels,
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: clusterRole.metadata.name,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.metadata.name,
          namespace: namespaceName,
        },
      ],
    },
    { provider },
  )

  const role = new rbac.v1.Role(
    certgenName,
    {
      metadata: {
        name: certgenName,
        namespace: namespaceName,
        labels,
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["secrets"],
          verbs: ["get", "create", "update"],
        },
      ],
    },
    { provider },
  )

  const roleBinding = new rbac.v1.RoleBinding(
    certgenName,
    {
      metadata: {
        name: certgenName,
        namespace: namespaceName,
        labels,
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
          namespace: namespaceName,
        },
      ],
    },
    { provider },
  )

  return new batch.v1.Job(
    certgenName,
    {
      metadata: {
        name: certgenName,
        namespace: namespaceName,
        labels,
      },
      spec: {
        backoffLimit: 1,
        completions: 1,
        parallelism: 1,
        template: {
          metadata: {
            labels: {
              app: "certgen",
            },
          },
          spec: {
            containers: [
              {
                command: ["envoy-gateway", "certgen"],
                env: [
                  {
                    name: "ENVOY_GATEWAY_NAMESPACE",
                    valueFrom: {
                      fieldRef: {
                        apiVersion: "v1",
                        fieldPath: "metadata.namespace",
                      },
                    },
                  },
                  {
                    name: "KUBERNETES_CLUSTER_DOMAIN",
                    value: "cluster.local",
                  },
                ],
                image: `docker.io/envoyproxy/gateway:v${chartVersion}`,
                imagePullPolicy: "IfNotPresent",
                name: "envoy-gateway-certgen",
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: {
                    drop: ["ALL"],
                  },
                  privileged: false,
                  readOnlyRootFilesystem: true,
                  runAsGroup: 65532,
                  runAsNonRoot: true,
                  runAsUser: 65532,
                  seccompProfile: {
                    type: "RuntimeDefault",
                  },
                },
              },
            ],
            imagePullSecrets: [],
            nodeSelector: args.nodeSelector,
            restartPolicy: "Never",
            serviceAccountName: serviceAccount.metadata.name,
          },
        },
      },
    },
    {
      provider,
      dependsOn: [serviceAccount, webhook, clusterRole, clusterRoleBinding, role, roleBinding],
    },
  )
}
