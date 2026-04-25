import { ssh } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { generateSshPrivateKey, sshPrivateKeyToKeyPair } from "../../../shared"

const { getSecret, outputs } = forUnit(ssh.keyPair)

const privateKey = getSecret("privateKey", generateSshPrivateKey)
const keyPair = privateKey.apply(sshPrivateKeyToKeyPair)

export default outputs({
  keyPair,

  $statusFields: {
    fingerprint: keyPair.fingerprint,
    publicKey: keyPair.publicKey,
  },
})
