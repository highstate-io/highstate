import { k8s } from "@highstate/library"

k8s.existingCluster({
  name: "existing",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,

    endpoints: ["192.168.1.10"],
    apiEndpoints: ["192.168.1.10:6443"],
  },
})
