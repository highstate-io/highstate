import type {
  UnlockMethodInput,
  UnlockMethodMeta,
  UnlockMethodType,
} from "@highstate/backend/shared"
import { armor, Encrypter, generateIdentity, identityToRecipient, webauthn } from "age-encryption"

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
): Promise<UnlockMethodInput> {
  if (!meta.title) {
    throw new Error("Display name is required for passkey unlock method")
  }

  const identity = await webauthn.createCredential({ keyName: meta.title })
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
}

export function createUnlockMethodFromForm(
  formData: UnlockMethodFormData,
): Promise<UnlockMethodInput> {
  const meta: UnlockMethodMeta = {
    title: formData.title,
    description: formData.description,
  }

  if (formData.type === "password") {
    return createPasswordUnlockMethod(formData.password, meta)
  }

  if (formData.type === "passkey") {
    return createPasskeyUnlockMethod(meta)
  }

  throw new Error(`Unsupported unlock method type: ${formData.type}`)
}
