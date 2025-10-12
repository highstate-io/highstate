import { ssh } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { generateSshPrivateKey, sshPrivateKeyToKeyPair } from "../../../shared"

const { name, getSecret, outputs } = forUnit(ssh.keyPair)

const privateKey = getSecret("privateKey", generateSshPrivateKey)
const keyPair = sshPrivateKeyToKeyPair(privateKey)

export default outputs({
  keyPair,
  publicKeyFile: {
    meta: {
      name: `${name}.pub`,
      mode: 0o644,
    },
    content: {
      type: "embedded",
      value: keyPair.publicKey,
    },
  },
  $statusFields: {
    fingerprint: keyPair.fingerprint,
    publicKey: keyPair.publicKey,
  },
})
