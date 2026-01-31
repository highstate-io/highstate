import { l4EndpointToString, subnetToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { createPeerEntity } from "../shared"

const { name, args, secrets, inputs, outputs } = forUnit(wireguard.peer)

const resolvedInpus = await toPromise(inputs)
const presharedKey = await toPromise(secrets.presharedKey)

const peer = await createPeerEntity(name, args, resolvedInpus, args.publicKey, presharedKey)

export default outputs({
  peer,

  $statusFields: {
    endpoints: peer.endpoints.map(l4EndpointToString),
    allowedSubnets: peer.allowedSubnets.map(subnetToString),
  },
})
