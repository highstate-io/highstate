import { text, trimIndentation } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { fileFromString, forUnit, interpolate, output, secret, toPromise } from "@highstate/pulumi"
import { join } from "remeda"
import { createK8sTerminal } from "../../cluster"
import { Namespace } from "../../namespace"
import { ClusterAccessScope } from "../../rbac"

const { args, inputs, outputs } = forUnit(k8s.reducedAccessCluster)

const resolvedInputs = await toPromise(inputs)

const accessScope = new ClusterAccessScope(
  "scope",
  {
    namespace: Namespace.for(resolvedInputs.namespace, inputs.k8sCluster),
    extraNamespaces: resolvedInputs.extraNamespaces.map(ns => Namespace.for(ns, inputs.k8sCluster)),
    rules: args.rules,
    resources: resolvedInputs.resources,
  },
  {},
)

const resourceLines = await toPromise(
  output(
    resolvedInputs.resources.map(r =>
      r.isNamespaced
        ? interpolate`- ${r.kind} "${r.metadata.namespace}/${r.metadata.name}"`
        : interpolate`- ${r.kind} "${r.metadata.name}"`,
    ),
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
