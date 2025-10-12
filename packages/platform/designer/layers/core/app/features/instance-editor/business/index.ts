import {
  camelCaseToHumanReadable,
  yamlValueSchema,
  z,
  type ComponentArgument,
} from "@highstate/contract"

export function populateDefaultValues(
  values: Record<string, unknown>,
  args: Record<string, ComponentArgument>,
) {
  const result = { ...values }

  for (const key in args) {
    const arg = args[key]
    if (arg.schema.default && result[key] === undefined) {
      result[key] = arg.schema.default
    }
  }

  return result
}

function shouldBeRemoved(value: unknown, schema: z.core.JSONSchema.BaseSchema) {
  // 0. remove empty yaml values
  const yamlValueResult = yamlValueSchema.safeParse(value)
  if (yamlValueResult.success) {
    return yamlValueResult.data.value.trim() === ""
  }

  // 1. always remove default values
  if (schema.default) {
    if (value === undefined || value === null) {
      return true
    }

    const stringifiedDefault = JSON.stringify(schema.default)
    const stringifiedValue = JSON.stringify(value)

    if (stringifiedDefault === stringifiedValue) {
      return true
    }
  }

  // 2. remove empty values (except for boolean)
  if (schema.type === "boolean") {
    return false
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  if (typeof value === "object") {
    return value === null || Object.keys(value).length === 0
  }

  if (typeof value === "string") {
    return value.trim() === ""
  }

  if (typeof value === "number") {
    return isNaN(value) || value === 0
  }

  if (typeof value === "undefined") {
    return true
  }

  return false
}

export function removeDefaultValues(
  values: Record<string, unknown>,
  args: Record<string, ComponentArgument>,
) {
  const result: Record<string, unknown> = {}

  for (const key in values) {
    if (!shouldBeRemoved(values[key], args[key].schema)) {
      result[key] = values[key]
    }
  }

  return result
}

export type EditorArgumentBase = {
  name: string
  title: string
  description: string | undefined
  default: unknown
}

export type PlainEditorArgument = EditorArgumentBase &
  (
    | {
        kind: "input" | "combobox"
        type: "string" | "number" | "integer"
      }
    | {
        kind: "select"
        type: "string" | "number" | "integer"
        multiple: boolean
        enum: unknown[]
      }
    | {
        kind: "checkbox"
      }
  )

export type GroupEditorArgument = EditorArgumentBase & {
  kind: "group"

  /**
   * The discriminator field for the group.
   */
  discriminator: PlainEditorArgument | undefined

  /**
   * The fields in the group.
   * The key is the value of the discriminator field, the value is the list of fields in the group.
   * If the discriminator field is not set, the only key is the empty string.
   */
  fields: Record<string, PlainEditorArgument[]>
}

export type CodeEditorArgument = EditorArgumentBase &
  (
    | {
        kind: "structured"
      }
    | {
        kind: "code"
        language?: string
      }
  )

export type ExpandableEditorArgument = CodeEditorArgument | GroupEditorArgument

export type EditorArguments = {
  plainArguments: PlainEditorArgument[]
  expandableArguments: ExpandableEditorArgument[]
}

function tryCreatePlainArgument(
  name: string,
  title: string,
  description: string | undefined,
  schema: z.core.JSONSchema.BaseSchema,
  parentDefault?: unknown,
): PlainEditorArgument | null {
  if (schema.type === "boolean") {
    return {
      name,
      title,
      description,
      kind: "checkbox",
      default: parentDefault ?? schema.default ?? false,
    }
  }

  if (schema.type === "array") {
    if (typeof schema.items !== "object" || Array.isArray(schema.items)) {
      return null
    }

    if (
      schema.items?.type === "string" ||
      schema.items?.type === "number" ||
      schema.items?.type === "integer"
    ) {
      if (schema.items.enum) {
        return {
          name,
          title,
          description,
          kind: "select",
          type: schema.items.type,
          enum: schema.items.enum,
          multiple: true,
          default: parentDefault ?? schema.default,
        }
      }

      return {
        name,
        title,
        description,
        kind: "combobox",
        type: schema.items.type,
        default: parentDefault ?? schema.default,
      }
    }
  }

  if (schema.type !== "string" && schema.type !== "number" && schema.type !== "integer") {
    return null
  }

  if (schema.enum) {
    return {
      name,
      title,
      description,
      kind: "select",
      type: schema.type,
      enum: schema.enum,
      multiple: false,
      default: parentDefault ?? schema.default,
    }
  }

  return {
    name,
    title,
    description,
    kind: "input",
    type: schema.type,
    default: parentDefault ?? schema.default,
  }
}

function isRecordSchema(schema: z.core.JSONSchema.BaseSchema) {
  return (
    schema.type === "object" &&
    schema.additionalProperties &&
    Object.keys(schema.additionalProperties).length === 0 &&
    schema.propertyNames
  )
}

function findDiscriminatorField(
  schemas: z.core.JSONSchema.BaseSchema[],
): PlainEditorArgument | null {
  const fieldCounter = new Map<string, number>()

  for (const schema of schemas) {
    if (schema.type !== "object" || !schema.properties) {
      continue
    }

    for (const [fName, fSchema] of Object.entries(schema.properties)) {
      if (typeof fSchema !== "object" || !fSchema.const) {
        continue
      }

      // add "+1" for each field name which can be used as a discriminator
      const count = fieldCounter.get(fName) ?? 0
      fieldCounter.set(fName, count + 1)
    }
  }

  // get the first field name that has ocurrences in all schemas
  for (const [fName, count] of fieldCounter.entries()) {
    if (!count || count < schemas.length) {
      continue
    }

    const fSchema = schemas[0].properties?.[fName]
    if (fSchema && typeof fSchema === "object" && fSchema.const) {
      // create a plain argument for the discriminator field
      return tryCreatePlainArgument(
        fName,
        fSchema.title ?? camelCaseToHumanReadable(fName),
        fSchema.description,
        fSchema,
      )
    }
  }

  return null
}

export function createEditorArguments(
  componentType: string,
  args: Record<string, ComponentArgument>,
): EditorArguments {
  const plainArguments: PlainEditorArgument[] = []
  const expandableArguments: ExpandableEditorArgument[] = []

  for (const [name, arg] of Object.entries(args)) {
    // 0. handle possible discriminated union
    if (arg.schema.anyOf) {
      const discriminatorField = findDiscriminatorField(arg.schema.anyOf)
      if (discriminatorField) {
        const fields: Record<string, PlainEditorArgument[]> = {}

        for (const schema of arg.schema.anyOf) {
          if (typeof schema !== "object" || !schema.properties) {
            continue
          }

          const discriminatorValue = schema.properties[
            discriminatorField.name
          ] as z.core.JSONSchema.BaseSchema

          const fieldName = discriminatorValue.const?.toString()
          if (fieldName === undefined) {
            continue
          }

          const fieldsList: PlainEditorArgument[] = []
          for (const [fName, fSchema] of Object.entries(schema.properties)) {
            if (typeof fSchema !== "object") {
              continue
            }

            // skip discriminator field
            if (fName === discriminatorField.name) {
              continue
            }

            const plainArg = tryCreatePlainArgument(
              fName,
              fSchema.title ?? camelCaseToHumanReadable(fName),
              fSchema.description,
              fSchema,
              (schema.default as any)?.[fName], // use default value from the parent schema if available
            )

            if (plainArg) {
              fieldsList.push(plainArg)
            }
          }

          fields[fieldName] = fieldsList
        }

        if (Object.keys(fields).length > 0) {
          expandableArguments.push({
            name,
            title: arg.meta.title,
            description: arg.meta.description,
            kind: "group",
            discriminator: discriminatorField,
            fields,
            default: arg.schema.default,
          })
        }
        continue
      }
    }

    // 1. object args are either plain arg groups or code editor args
    if (arg.schema.type === "object") {
      if (arg.schema.complex || isRecordSchema(arg.schema)) {
        updateComponentSchema(componentType, name, arg.schema)

        expandableArguments.push({
          name,
          title: arg.meta.title,
          description: arg.meta.description,
          kind: "structured",
          default: arg.schema.default,
        })
      } else {
        const fields: PlainEditorArgument[] = []

        for (const [fName, fSchema] of Object.entries(arg.schema.properties ?? {})) {
          if (typeof fSchema !== "object") {
            continue
          }

          const plainArg = tryCreatePlainArgument(
            fName,
            fSchema.title ?? camelCaseToHumanReadable(fName),
            fSchema.description,
            fSchema,
            (arg.schema.default as any)?.[fName], // use default value from the parent schema if available
          )

          if (plainArg) {
            fields.push(plainArg)
          }

          // ignore all fields that are not plain arguments
          // TODO: warn about unsupported fields
        }

        // ignore empty groups
        if (fields.length > 0) {
          expandableArguments.push({
            name,
            title: arg.meta.title,
            description: arg.meta.description,
            kind: "group",
            discriminator: undefined,
            fields: { "": fields },
            default: arg.schema.default,
          })
        }
      }

      continue
    }

    // 2. string args can be code editor args
    if (arg.schema.type === "string" && (arg.schema.language || arg.schema.multiline)) {
      expandableArguments.push({
        name,
        title: arg.meta.title,
        description: arg.meta.description,
        kind: "code",
        language: z.string().optional().safeParse(arg.schema.language).data,
        default: arg.schema.default,
      })

      continue
    }

    // 3. then try to create a plain argument
    const plainArg = tryCreatePlainArgument(name, arg.meta.title, arg.meta.description, arg.schema)
    if (plainArg) {
      plainArguments.push(plainArg)
      continue
    }

    // 4. all other arguments are structured arguments
    updateComponentSchema(componentType, name, arg.schema)

    expandableArguments.push({
      name,
      title: arg.meta.title,
      description: arg.meta.description,
      kind: "structured",
      default: arg.schema.default,
    })
  }

  return {
    plainArguments,
    expandableArguments,
  }
}
