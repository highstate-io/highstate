import type {
  UnlockMethodInput,
  UnlockMethodMeta,
  UnlockMethodType,
} from "@highstate/backend/shared"
import {
  armor,
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
  webauthn,
} from "age-encryption"

export type ReusablePasskey = {
  encryptedIdentity: string
  passkeyIdentity: string
}

/**
 * Authenticates an existing passkey before copying its self-contained identity envelope.
 */
export async function reusePasskeyUnlockMethod(
  meta: UnlockMethodMeta,
  passkey: ReusablePasskey,
): Promise<UnlockMethodInput> {
  const decrypter = new Decrypter()
  decrypter.addIdentity(new webauthn.WebAuthnIdentity({ identity: passkey.passkeyIdentity }))
  const identity = await decrypter.decrypt(armor.decode(passkey.encryptedIdentity), "text")

  return {
    type: "passkey",
    meta,
    ...passkey,
    recipient: await identityToRecipient(identity),
  }
}

async function createUnlockMethod(meta: UnlockMethodMeta, encrypter: Encrypter) {
  const identity = await generateIdentity()

  const encryptedIdentity = await encrypter.encrypt(identity)
  const armoredIdentity = armor.encode(encryptedIdentity)

  const recipient = await identityToRecipient(identity)

  return {
    meta,
    encryptedIdentity: armoredIdentity,
    recipient,
  }
}

export async function createPasswordUnlockMethod(
  password: string,
  meta: UnlockMethodMeta,
): Promise<UnlockMethodInput> {
  const encrypter = new Encrypter()
  encrypter.setPassphrase(password)
  const unlockMethod = await createUnlockMethod(meta, encrypter)

  return { type: "password", ...unlockMethod }
}

export async function createPasskeyUnlockMethod(
  meta: UnlockMethodMeta,
  _project: { id: string; name: string },
): Promise<UnlockMethodInput> {
  if (!meta.title) {
    throw new Error("Display name is required for passkey unlock method")
  }

  const identity = await webauthn.createCredential({
    keyName: `Highstate | ${meta.title}`,
  })

  const encrypter = new Encrypter()
  encrypter.addRecipient(new webauthn.WebAuthnRecipient({ identity }))
  const unlockMethod = await createUnlockMethod(meta, encrypter)

  return {
    type: "passkey",
    ...unlockMethod,
    passkeyIdentity: identity,
  }
}

export type UnlockMethodFormData = {
  type: UnlockMethodType
  title: string
  description: string
  password: string
  confirmPassword: string
  existingPasskey?: ReusablePasskey
}

export function createUnlockMethodFromForm(
  formData: UnlockMethodFormData,
  project: { id: string; name: string },
): Promise<UnlockMethodInput> {
  const meta: UnlockMethodMeta = {
    title: formData.title,
    description: formData.description,
  }

  if (formData.type === "password") {
    return createPasswordUnlockMethod(formData.password, meta)
  }

  if (formData.type === "passkey") {
    if (formData.existingPasskey) {
      return reusePasskeyUnlockMethod(meta, formData.existingPasskey)
    }

    return createPasskeyUnlockMethod(meta, project)
  }

  if (formData.type === "keyring") {
    return Promise.resolve({ type: "keyring", meta })
  }

  throw new Error(`Unsupported unlock method type: ${formData.type}`)
}
