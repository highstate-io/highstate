import { common, k3s, k8s } from "@highstate/library"

const { server: master } = common.existingServer({
  name: "master",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { k8sCluster } = k3s.cluster({
  name: "my-cluster",
  inputs: {
    masters: [master],
  },
})

const { namespace } = k8s.apps.workload({
  name: "demo",
  args: {
    image: "nginx:1.27",
  },
  inputs: {
    k8sCluster,
  },
})

k8s.reducedAccessCluster({
  name: "readonly",
  args: {
    rules: [
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list", "watch"],
      },
    ],
  },
  inputs: {
    k8sCluster,
    namespace,
  },
})
