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
  _project: { id: string; name: string },
): Promise<UnlockMethodInput> {
  if (!meta.title) {
    throw new Error("Display name is required for passkey unlock method")
  }

  const encryptIdentity = async (credential?: string) => {
    const encrypter = new Encrypter()

    encrypter.addRecipient(
      new webauthn.WebAuthnRecipient(credential ? { identity: credential } : undefined),
    )

    return await createUnlockMethod(meta, encrypter)
  }

  let unlockMethod: Awaited<ReturnType<typeof createUnlockMethod>>

  try {
    unlockMethod = await encryptIdentity()
  } catch (error) {
    // webAuthn uses NotAllowedError for missing credentials, cancellation, and timeout
    // Enrollment is attempted only once; unsupported PRF and other failures must not create credentials.
    if (!(error instanceof Error) || error.name !== "NotAllowedError") {
      throw error
    }

    const credential = await webauthn.createCredential({ keyName: "Highstate" })
    unlockMethod = await encryptIdentity(credential)
  }

  return {
    type: "passkey",
    ...unlockMethod,
  }
}

export type UnlockMethodFormData = {
  type: UnlockMethodType
  title: string
  description: string
  password: string
  confirmPassword: string
  autoUnlock?: boolean
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
    return createPasskeyUnlockMethod(meta, project)
  }

  if (formData.type === "keyring") {
    return Promise.resolve({
      type: "keyring",
      meta: { ...meta, autoUnlock: formData.autoUnlock ?? false },
    })
  }

  throw new Error(`Unsupported unlock method type: ${formData.type}`)
}
