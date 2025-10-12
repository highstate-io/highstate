import { text, trimIndentation } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { fileFromString, forUnit, interpolate, output, secret, toPromise } from "@highstate/pulumi"
import { join } from "remeda"
import { createK8sTerminal } from "../../cluster"
import { ConfigMap } from "../../config-map"
import { Deployment } from "../../deployment"
import { Namespace } from "../../namespace"
import { PersistentVolumeClaim } from "../../pvc"
import { ClusterAccessScope } from "../../rbac"
import { Secret } from "../../secret"
import { Service } from "../../service"
import { StatefulSet } from "../../stateful-set"

const { name, args, inputs, outputs } = forUnit(k8s.reducedAccessCluster)

const resolvedInputs = await toPromise(inputs)

const resources = [
  ...resolvedInputs.deployments.map(r => Deployment.for(r, inputs.k8sCluster)),
  ...resolvedInputs.statefulSets.map(r => StatefulSet.for(r, inputs.k8sCluster)),
  ...resolvedInputs.services.map(r => Service.for(r, inputs.k8sCluster)),
  ...resolvedInputs.persistentVolumeClaims.map(r =>
    PersistentVolumeClaim.for(r, inputs.k8sCluster),
  ),
  ...resolvedInputs.secrets.map(r => Secret.for(r, inputs.k8sCluster)),
  ...resolvedInputs.configMaps.map(r => ConfigMap.for(r, inputs.k8sCluster)),
]

const accessScope = await ClusterAccessScope.forResources(args.serviceAccountName ?? name, {
  namespace: Namespace.for(resolvedInputs.namespace, inputs.k8sCluster),
  verbs: args.verbs,
  resources,
})

const resourceLines = await toPromise(
  output(
    resources.map(r => interpolate`- ${r.kind} "${r.metadata.namespace}/${r.metadata.name}"`),
  ).apply(join("\n")),
)

export default outputs({
  k8sCluster: accessScope.cluster,

  $terminals: [createK8sTerminal(accessScope.cluster.kubeconfig)],

  $pages: {
    index: {
      meta: {
        title: "Reduced Access Cluster",
      },
      content: [
        {
          type: "markdown",
          content: text`
            The access to this cluster was reduced to the following resources:
            
            ${resourceLines}
          `,
        },
        {
          type: "markdown",
          content: text`
            You can access these resources using the following kubeconfig:
          `,
        },
        {
          type: "file",
          file: fileFromString("kubeconfig", accessScope.cluster.kubeconfig, {
            contentType: "text/yaml",
            isSecret: true,
          }),
        },
        {
          type: "markdown",
          content: secret(
            interpolate`
              You can also copy the following content of the kubeconfig file:

              \`\`\`yaml
              ${accessScope.cluster.kubeconfig}
              \`\`\`
            `.apply(trimIndentation),
          ),
        },
        {
          type: "markdown",
          content: "You can also use terminal to verify the access to the resources.",
        },
      ],
    },
  },
})
