import { z } from "zod"

export const objectMetaSchema = z.object({
  /**
   * Human-readable name of the object.
   *
   * Used in UI components for better user experience.
   */
  title: z.string().optional(),

  /**
   * The title used globally for the object.
   *
   * For example, the title of an instance secret is "Password" which is okay
   * to display in the instance secret list, but when the secret is displayed in a
   * global secret list the name should be more descriptive, like "Proxmox Password".
   */
  globalTitle: z.string().optional(),

  /**
   * Description of the object.
   *
   * Provides additional context for users and developers.
   */
  description: z.string().optional(),

  /**
   * The color of the object.
   *
   * Used in UI components to visually distinguish objects.
   */
  color: z.string().optional(),

  /**
   * Primary icon identifier.
   *
   * Should reference a iconify icon name, like "mdi:server" or "gg:remote".
   */
  icon: z.string().optional(),

  /**
   * The color of the primary icon.
   */
  iconColor: z.string().optional(),

  /**
   * The URL of the custom image that should be used as the icon or avatar.
   */
  avatarUrl: z.string().optional(),

  /**
   * The secondary icon identifier.
   *
   * Used to provide additional context or actions related to the object.
   *
   * Should reference a iconify icon name, like "mdi:edit" or "mdi:delete".
   */
  secondaryIcon: z.string().optional(),

  /**
   * The color of the secondary icon.
   */
  secondaryIconColor: z.string().optional(),
})

/**
 * The schema for object metadata used in more than a half of the Highstate objects.
 *
 * Consists of `title`, `description`, `icon`, and `iconColor` fields where the `title` is required.
 */
export const commonObjectMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
    icon: true,
    iconColor: true,
  })
  .required({
    title: true,
  })

export const globalCommonObjectMetaSchema = objectMetaSchema
  .pick({
    title: true,
    globalTitle: true,
    description: true,
    icon: true,
    iconColor: true,
  })
  .required({
    title: true,
  })

export const serviceAccountMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
    avatarUrl: true,
    icon: true,
    iconColor: true,
  })
  .required({ title: true })

export const timestampsSchema = z.object({
  /**
   * The timestamp when the object was created.
   */
  createdAt: z.date(),

  /**
   * The timestamp when the object was last updated.
   */
  updatedAt: z.date(),
})

/**
 * The schema for strings that represent names in Highstate.
 *
 * The name:
 * - must be alphanumeric;
 * - can include dashes (`-`) as word separators and dots (`.`) as namespace separators;
 * - must begin with a letter;
 * - must be lowercase;
 * - must include from 2 to 64 characters.
 */
export const genericNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-.]+$/,
    "Name must start with a letter and can only contain lowercase letters, numbers, dashes (-) and dots (.)",
  )
  .min(2)
  .max(64)

export const versionedNameSchema = z.union([
  z.templateLiteral([genericNameSchema, z.literal("."), z.literal("v"), z.number().int().min(1)]),

  // to prevent TypeScript matching "proxmox.virtual-machine.v2" as
  // 1. "proxmox.v"
  // 2. "irtual-machine.v2" and thinking it should be a number
  z.templateLiteral([
    genericNameSchema,
    z.literal("."),
    genericNameSchema,
    z.literal("."),
    z.literal("v"),
    z.number().int().min(1),
  ]),
  z.templateLiteral([
    genericNameSchema,
    z.literal("."),
    genericNameSchema,
    z.literal("."),
    genericNameSchema,
    z.literal("."),
    z.literal("v"),
    z.number().int().min(1),
  ]),
])

/**
 * Parses a versioned name into its base name and version.
 *
 * @param name The versioned name to parse.
 * @returns A tuple containing the base name and version number.
 * @throws If the name is not in the correct format or if the version is invalid.
 */
export function parseVersionedName(name: string): [name: string, version: number] {
  const lastDotVIndex = name.lastIndexOf(".v")
  if (lastDotVIndex === -1) {
    throw new Error(`Invalid versioned name: ${name}`)
  }

  const baseName = name.substring(0, lastDotVIndex)
  const versionPart = name.substring(lastDotVIndex + 2) // +2 to skip ".v"

  const version = parseInt(versionPart, 10)
  if (Number.isNaN(version) || version < 0) {
    throw new Error(`Invalid version in versioned name: ${name}`)
  }

  return [baseName, version]
}

/**
 * The schema for field names in Highstate.
 *
 * The field name:
 * - must be alphanumeric;
 * - must be in camelCase;
 * - must begin with a letter;
 * - must include from 2 to 64 characters.
 */
export const fieldNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]+$/, "Field name must start with a letter and be in camelCase format")
  .min(2)
  .max(64)

export type ObjectMeta = z.infer<typeof objectMetaSchema>
export type CommonObjectMeta = z.infer<typeof commonObjectMetaSchema>
export type GlobalCommonObjectMeta = z.infer<typeof globalCommonObjectMetaSchema>
export type ServiceAccountMeta = z.infer<typeof serviceAccountMetaSchema>
export type GenericName = z.infer<typeof genericNameSchema>
export type VersionedName = z.infer<typeof versionedNameSchema>
export type FieldName = z.infer<typeof fieldNameSchema>
