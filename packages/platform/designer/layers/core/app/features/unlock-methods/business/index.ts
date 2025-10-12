import type {
  UnlockMethodInput,
  UnlockMethodMeta,
  UnlockMethodType,
} from "@highstate/backend/shared"
import { armor, Encrypter, generateIdentity, identityToRecipient, webauthn } from "age-encryption"

async function createUnlockMethod(
  type: UnlockMethodType,
  meta: UnlockMethodMeta,
  encrypter: Encrypter,
): Promise<UnlockMethodInput> {
  const identity = await generateIdentity()

  const encryptedIdentity = await encrypter.encrypt(identity)
  const armoredIdentity = armor.encode(encryptedIdentity)

  const recipient = await identityToRecipient(identity)

  return {
    meta,
    type,
    encryptedIdentity: armoredIdentity,
    recipient,
  }
}

export function createPasswordUnlockMethod(
  password: string,
  meta: UnlockMethodMeta,
): Promise<UnlockMethodInput> {
  const encrypter = new Encrypter()
  encrypter.setPassphrase(password)

  return createUnlockMethod("password", meta, encrypter)
}

export function createPasskeyUnlockMethod(meta: UnlockMethodMeta): Promise<UnlockMethodInput> {
  if (!meta.title) {
    throw new Error("Display name is required for passkey unlock method")
  }

  const encrypter = new Encrypter()
  encrypter.addRecipient(new webauthn.WebAuthnRecipient())

  return createUnlockMethod("passkey", meta, encrypter)
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
