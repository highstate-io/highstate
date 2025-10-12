import { l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { createPeerEntity } from "../shared"

const { name, args, secrets, inputs, outputs } = forUnit(wireguard.peer)

const resolvedInpus = await toPromise(inputs)
const presharedKey = await toPromise(secrets.presharedKey)

const peer = createPeerEntity(name, args, resolvedInpus, args.publicKey, presharedKey)

export default outputs({
  peer,
  endpoints: peer.endpoints,

  $statusFields: {
    endpoints: {
      value: peer.endpoints.map(l4EndpointToString),
      complementaryTo: "endpoints",
    },
    allowedEndpoints: {
      value: peer.allowedEndpoints.map(l3EndpointToString),
      complementaryTo: "allowedEndpoints",
    },
  },
})
