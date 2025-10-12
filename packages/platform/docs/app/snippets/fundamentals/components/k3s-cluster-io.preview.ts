import { common, k3s } from "@highstate/library"

// create three existing servers
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

const { server: worker2 } = common.existingServer({
  name: "worker-2",
  args: {
    endpoint: "192.168.1.12",
  },
})

// create k3s cluster with master and worker nodes
k3s.cluster({
  name: "my-cluster",
  inputs: {
    masters: [master],
    workers: [worker1, worker2],
  },
})
