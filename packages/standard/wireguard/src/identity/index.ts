import { l4EndpointToString } from "@highstate/common"
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

const peer = createPeerEntity(name, args, resolvedInpus, publicKey, presharedKeyPart)

export default outputs({
  identity: {
    peer,
    privateKey,
  },

  peer,

  endpoints: peer.endpoints,

  $statusFields: {
    publicKey,
    endpoints: {
      value: peer.endpoints.map(l4EndpointToString),
      complementaryTo: "endpoints",
    },
    excludedIps: {
      value: peer.excludedIps,
      complementaryTo: "excludedIps",
    },
  },
})
