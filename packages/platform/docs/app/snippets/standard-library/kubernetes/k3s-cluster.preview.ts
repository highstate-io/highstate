import { common, k3s } from "@highstate/library"

const { server: master } = common.existingServer({
  name: "master",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { server: worker1 } = common.existingServer({
  name: "worker-1",
  args: {
    endpoint: "192.168.1.11",
  },
})

k3s.cluster({
  name: "my-cluster",
  args: {
    cni: "flannel",
  },
  inputs: {
    masters: [master],
    workers: [worker1],
  },
})
