import type { Plugin } from "esbuild"
import { readFile } from "node:fs/promises"
import MagicString from "magic-string"
import {
  type CallExpression,
  type Comment,
  type MemberExpression,
  type ObjectProperty,
  parseAsync,
} from "oxc-parser"
import { type Node, walk } from "oxc-walker"

export const schemaTransformerPlugin: Plugin = {
  name: "schema-transformer",
  setup(build) {
    build.onLoad({ filter: /src\/.*\.ts$/ }, async args => {
      const content = await readFile(args.path, "utf-8")

      return {
        contents: await applySchemaTransformations(content),
        loader: "ts",
      }
    })
  },
}

export async function applySchemaTransformations(content: string): Promise<string> {
  // first pass: apply zod meta transformations
  let result = await applyZodMetaTransformations(content)

  // second pass: apply helper function transformations
  result = await applyHelperFunctionTransformations(result)

  // third pass: apply define function meta transformations
  result = await applyDefineFunctionMetaTransformations(result)

  return result
}

async function applyZodMetaTransformations(content: string): Promise<string> {
  const { program, comments } = await parseAsync("file.ts", content)
  const parentStack: Node[] = []
  let hasTransformations = false
  const result = new MagicString(content)

  walk(program, {
    enter(node) {
      parentStack.push(node)

      // handle zod object patterns
      if (isZodObjectProperty(node, parentStack)) {
        const jsdoc = findLeadingComment(content, node, comments)
        if (!jsdoc) {
          return
        }

        const description = cleanJsdoc(jsdoc.value)
        const fieldName =
          "name" in node.key && typeof node.key.name === "string" ? node.key.name : "unknown"

        // Getter properties (get foo() { return ... }) need special handling:
        // we inject `.meta(...)` into the returned schema expression.
        if (isGetterProperty(node)) {
          const returnArgument = findFirstReturnArgument(node)
          if (!returnArgument) {
            return
          }

          const originalReturnValue = content.substring(returnArgument.start, returnArgument.end)
          if (originalReturnValue.includes(".meta(")) {
            return
          }

          const newReturnValue = `${originalReturnValue}.meta({ title: __camelCaseToHumanReadable("${fieldName}"), description: \`${description}\` })`
          result.update(returnArgument.start, returnArgument.end, newReturnValue)
          hasTransformations = true
          return
        }

        // Standard properties (foo: z.string())
        if (!hasValue(node) || !hasSourceRange(node.value)) {
          return
        }

        const originalValue = content.substring(node.value.start, node.value.end)

        if (!originalValue.includes(".meta(")) {
          const newValue = `${originalValue}.meta({ title: __camelCaseToHumanReadable("${fieldName}"), description: \`${description}\` })`
          result.update(node.value.start, node.value.end, newValue)
          hasTransformations = true
        }
      }
    },
    leave() {
      parentStack.pop()
    },
  })

  let finalResult = result.toString()

  // add import at the beginning if needed
  if (hasTransformations && !content.includes("__camelCaseToHumanReadable")) {
    finalResult =
      'import { camelCaseToHumanReadable as __camelCaseToHumanReadable } from "@highstate/contract"\n' +
      finalResult
  }

  return finalResult
}

async function applyHelperFunctionTransformations(content: string): Promise<string> {
  const { program, comments } = await parseAsync("file.ts", content)
  const parentStack: Node[] = []
  let hasTransformations = false
  const result = new MagicString(content)

  walk(program, {
    enter(node) {
      parentStack.push(node)

      // handle properties in args, inputs, outputs, secrets objects
      if (node.type === "Property" && "key" in node && node.key?.type === "Identifier") {
        const propertyNode = node
        const helperFunction = getHelperFunctionForProperty(parentStack)

        if (helperFunction) {
          const jsdoc = findLeadingComment(content, node, comments)

          if (jsdoc) {
            const description = cleanJsdoc(jsdoc.value)
            // Getter properties (get foo() { return ... }) need special handling:
            // inject the helper call into the returned expression.
            if (isGetterProperty(propertyNode)) {
              const returnArgument = findFirstReturnArgument(propertyNode)
              if (!returnArgument) {
                return
              }

              const originalReturnValue = content.substring(
                returnArgument.start,
                returnArgument.end,
              )
              if (originalReturnValue.trimStart().startsWith(`${helperFunction}(`)) {
                return
              }

              const newReturnValue = `${helperFunction}(${originalReturnValue}, \`${description}\`)`
              result.update(returnArgument.start, returnArgument.end, newReturnValue)
              hasTransformations = true
              return
            }

            if (!hasValue(propertyNode) || !hasSourceRange(propertyNode.value)) {
              return
            }

            const originalValue = content.substring(
              propertyNode.value.start,
              propertyNode.value.end,
            )
            const newValue = `${helperFunction}(${originalValue}, \`${description}\`)`
            result.update(propertyNode.value.start, propertyNode.value.end, newValue)
            hasTransformations = true
          }
        }
      }
    },
    leave() {
      parentStack.pop()
    },
  })

  let finalResult = result.toString()

  // add import at the beginning if needed
  if (hasTransformations && !content.includes("$addArgumentDescription")) {
    finalResult =
      'import { $addArgumentDescription, $addInputDescription } from "@highstate/contract"\n' +
      finalResult
  }

  return finalResult
}

async function applyDefineFunctionMetaTransformations(content: string): Promise<string> {
  const { program, comments } = await parseAsync("file.ts", content)
  const parentStack: Node[] = []
  const result = new MagicString(content)

  walk(program, {
    enter(node) {
      parentStack.push(node)

      // handle defineUnit, defineEntity, defineComponent function calls
      if (node.type === "CallExpression" && "callee" in node && node.callee.type === "Identifier") {
        const callNode = node
        const callee = callNode.callee
        const functionName =
          "name" in callee && typeof callee.name === "string" ? callee.name : undefined

        if (
          functionName &&
          ["defineUnit", "defineEntity", "defineComponent"].includes(functionName)
        ) {
          // look for JSDoc comment on the parent declaration/export, not the function call itself
          const jsdoc = findJsdocForDefineFunction(content, parentStack, comments)

          if (jsdoc && callNode.arguments && callNode.arguments.length > 0) {
            const description = cleanJsdoc(jsdoc.value)
            const firstArg = callNode.arguments[0]

            // find meta property in the object expression
            if (firstArg.type === "ObjectExpression" && "properties" in firstArg) {
              const properties = firstArg.properties
              const metaProperty = properties?.find(
                prop =>
                  prop.type === "Property" &&
                  "key" in prop &&
                  prop.key?.type === "Identifier" &&
                  prop.key?.name === "meta",
              ) as ObjectProperty | undefined

              if (metaProperty && "value" in metaProperty) {
                // inject description into existing meta object
                const originalMetaValue = content.substring(
                  metaProperty.value.start,
                  metaProperty.value.end,
                )
                const newMetaValue = injectDescriptionIntoMetaObject(originalMetaValue, description)
                result.update(metaProperty.value.start, metaProperty.value.end, newMetaValue)
              } else if (properties && properties.length > 0) {
                // add meta property with description
                const lastProperty = properties[properties.length - 1] as ObjectProperty
                if (lastProperty && "end" in lastProperty) {
                  const insertPos = lastProperty.end
                  const newMetaProperty = `,

  meta: {
    description: \`${description}\`,
  }`
                  result.appendLeft(insertPos, newMetaProperty)
                }
              }
            }
          }
        }
      }
    },
    leave() {
      parentStack.pop()
    },
  })

  return result.toString()
}

function findJsdocForDefineFunction(
  content: string,
  parentStack: Node[],
  comments: Comment[],
): Comment | null {
  // look for the variable declaration or export declaration that contains the function call
  for (let i = parentStack.length - 1; i >= 0; i--) {
    const node = parentStack[i]

    // check for variable declaration (const x = defineUnit(...))
    if (node.type === "VariableDeclarator" && "id" in node && node.id?.type === "Identifier") {
      const jsdoc = findLeadingComment(content, node, comments)
      if (jsdoc) return jsdoc
    }

    // check for export variable declaration (export const x = defineUnit(...))
    if (node.type === "VariableDeclaration") {
      const jsdoc = findLeadingComment(content, node, comments)
      if (jsdoc) return jsdoc
    }

    // check for export declaration (export const x = ...)
    if (node.type === "ExportNamedDeclaration" && "declaration" in node && node.declaration) {
      const jsdoc = findLeadingComment(content, node, comments)
      if (jsdoc) return jsdoc
    }
  }

  return null
}

function isZodObjectProperty(node: Node, parentStack: Node[]): node is ObjectProperty {
  return (
    node.type === "Property" &&
    "key" in node &&
    node.key?.type === "Identifier" &&
    isInsideZodObject(parentStack)
  )
}

type GetterObjectProperty = ObjectProperty & {
  kind: "get"
  value: Node & { type: "FunctionExpression" }
}

function isGetterProperty(node: Node): node is GetterObjectProperty {
  if (node.type !== "Property") {
    return false
  }

  if (!hasValue(node)) {
    return false
  }

  return "kind" in node && node.kind === "get" && node.value.type === "FunctionExpression"
}

function findFirstReturnArgument(node: ObjectProperty): Node | null {
  if (!hasValue(node) || node.value.type !== "FunctionExpression") {
    return null
  }

  const body = node.value.body
  if (!body || body.type !== "BlockStatement") {
    return null
  }

  for (const statement of body.body) {
    if (statement.type !== "ReturnStatement") {
      continue
    }

    const returnArgument = "argument" in statement ? statement.argument : null
    if (returnArgument && hasSourceRange(returnArgument)) {
      return returnArgument
    }
  }

  return null
}

function hasValue(node: Node): node is Node & { value: Node } {
  return "value" in node && !!node.value
}

function hasSourceRange(node: Node): node is Node & { start: number; end: number } {
  return (
    "start" in node &&
    typeof node.start === "number" &&
    "end" in node &&
    typeof node.end === "number"
  )
}

function findLeadingComment(content: string, node: Node, comments: Comment[]): Comment | null {
  return comments.find(comment => isLeadingComment(content, node, comment)) ?? null
}

function isLeadingComment(content: string, node: Node, comment: Comment) {
  if (comment.end > node.start) {
    return false
  }

  const contentRange = content.substring(comment.end, node.start)

  return contentRange.trim().length === 0
}

function cleanJsdoc(str: string) {
  return (
    str
      // remove leading asterisks
      .replace(/^\s*\*/gm, "")

      // escape backticks and dollar signs
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\${/g, "\\${")
      .trim()
  )
}

function injectDescriptionIntoMetaObject(objectString: string, description: string): string {
  const trimmed = objectString.trim()

  // Check if description already exists
  const hasDescription = /description\s*:/.test(trimmed)

  if (hasDescription) {
    // Replace existing description
    return trimmed.replace(/description\s*:\s*`[^`]*`/, `description: \`${description}\``)
  } else {
    // Add description field at the beginning of the object
    const openBraceIndex = trimmed.indexOf("{")
    if (openBraceIndex === -1) {
      return trimmed
    }

    const beforeBrace = trimmed.substring(0, openBraceIndex + 1)
    const afterBrace = trimmed.substring(openBraceIndex + 1)

    return `${beforeBrace}
    description: \`${description}\`,${afterBrace}`
  }
}

function isInsideZodObject(parentStack: Node[]): boolean {
  // look for z.object() call expression in the parent stack
  for (let i = parentStack.length - 1; i >= 0; i--) {
    const node = parentStack[i]
    if (
      node.type === "CallExpression" &&
      "callee" in node &&
      node.callee.type === "MemberExpression" &&
      isZodObjectCall(node.callee)
    ) {
      return true
    }
  }
  return false
}

function getHelperFunctionForProperty(
  parentStack: Node[],
): "$addInputDescription" | "$addArgumentDescription" | null {
  if (parentStack.length < 3) {
    return null
  }

  const objectExpression = parentStack[parentStack.length - 2]
  if (!objectExpression || objectExpression.type !== "ObjectExpression") {
    return null
  }

  const containerParent = parentStack[parentStack.length - 3]
  if (!containerParent) {
    return null
  }

  if (
    containerParent.type === "Property" &&
    "value" in containerParent &&
    containerParent.value === objectExpression &&
    containerParent.key?.type === "Identifier"
  ) {
    const keyName = containerParent.key.name
    if (keyName === "inputs" || keyName === "outputs") {
      return "$addInputDescription"
    }
    if (keyName === "args" || keyName === "secrets") {
      return "$addArgumentDescription"
    }

    return null
  }

  if (
    containerParent.type === "CallExpression" &&
    containerParent.callee.type === "Identifier" &&
    containerParent.arguments.length > 0 &&
    containerParent.arguments[0] === objectExpression
  ) {
    const calleeName = containerParent.callee.name
    if (calleeName === "$inputs" || calleeName === "$outputs") {
      return "$addInputDescription"
    }
    if (calleeName === "$args" || calleeName === "$secrets") {
      return "$addArgumentDescription"
    }
  }

  return null
}

function isZodObjectCall(memberExpression: Node): boolean {
  if (
    memberExpression.type !== "MemberExpression" ||
    !("object" in memberExpression) ||
    !("property" in memberExpression)
  ) {
    return false
  }

  const member = memberExpression as MemberExpression

  // handle direct z.object() calls
  if (
    member.object.type === "Identifier" &&
    "name" in member.object &&
    member.object.name === "z" &&
    member.property.type === "Identifier" &&
    member.property.name === "object"
  ) {
    return true
  }

  // handle chained calls like z.discriminatedUnion().default().object()
  // or any other chained Zod methods that end with .object()
  if (
    member.property.type === "Identifier" &&
    member.property.name === "object" &&
    member.object.type === "CallExpression" &&
    "callee" in member.object &&
    member.object.callee.type === "MemberExpression"
  ) {
    // recursively check if this is part of a z.* chain
    return startsWithZodCall(member.object)
  }

  return false
}

function startsWithZodCall(callExpression: CallExpression): boolean {
  if (!callExpression || callExpression.type !== "CallExpression") {
    return false
  }

  if (callExpression.callee.type === "MemberExpression") {
    const callee = callExpression.callee

    // check if this is a direct z.* call
    if (
      callee.object.type === "Identifier" &&
      "name" in callee.object &&
      callee.object.name === "z"
    ) {
      return true
    }

    // recursively check nested calls
    if (callee.object.type === "CallExpression") {
      return startsWithZodCall(callee.object)
    }
  }

  return false
}
