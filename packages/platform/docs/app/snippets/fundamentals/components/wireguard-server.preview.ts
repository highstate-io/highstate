import { wireguard } from "@highstate/library"

const { identity: client1Id, peer: client1 } = wireguard.identity({
  name: "client-1",
})

const { identity: client2Id, peer: client2 } = wireguard.identity({
  name: "client-2",
})

const { identity: serverId } = wireguard.identity({
  name: "server",
})

const { peer: server } = wireguard.nodeK8s({
  name: "server",
  inputs: {
    k8sCluster: null!,
    identity: serverId,
    peers: [client1, client2],
  },
})

wireguard.config({
  name: "client-1",
  inputs: {
    identity: client1Id,
    peers: [server],
  },
})

wireguard.config({
  name: "client-2",
  inputs: {
    identity: client2Id,
    peers: [server],
  },
})
