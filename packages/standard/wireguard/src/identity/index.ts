import { l4EndpointToString, makeEntityOutput, subnetToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import {
  convertPrivateKeyToPublicKey,
  createPeerEntity,
  generateKey,
  generatePresharedKey,
} from "../shared"

const { name, args, inputs, getSecret, outputs } = forUnit(wireguard.identity)

const privateKey = getSecret("privateKey", generateKey)
const presharedKeyPartOutput = getSecret("presharedKeyPart", generatePresharedKey)

const resolvedInpus = await toPromise(inputs)
const publicKey = await toPromise(privateKey.apply(convertPrivateKeyToPublicKey))
const presharedKeyPart = await toPromise(presharedKeyPartOutput)

const peer = await createPeerEntity(name, args, resolvedInpus, publicKey, presharedKeyPart)

const identity = makeEntityOutput({
  entity: wireguard.identityEntity,
  identity: publicKey,
  value: {
    peer,
    privateKey,
  },
})

export default outputs({
  identity,

  $statusFields: {
    publicKey,
    endpoints: peer.endpoints.map(l4EndpointToString),
    allowedSubnets: peer.allowedSubnets.map(subnetToString),
  },
})
