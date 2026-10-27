/**
 * Local syntax rules supplementing Biome; each rule has a stable suppression name.
 */
const rule = (description, create, fixable) => ({
  meta: {
    type: "suggestion",
    docs: { description },
    schema: [],
    messages: { style: "{{message}}" },
    ...(fixable ? { fixable: "code" } : {}),
  },
  create,
})

const report = (context, node, message, fix) =>
  context.report({ node, messageId: "style", data: { message }, ...(fix ? { fix } : {}) })

const behavior = member =>
  ["TSMethodSignature", "TSCallSignatureDeclaration", "TSConstructSignatureDeclaration"].includes(
    member.type,
  ) || member.typeAnnotation?.typeAnnotation.type === "TSFunctionType"

function standardError(context, node) {
  if (
    node.callee.type !== "Identifier" ||
    ![
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "URIError",
      "EvalError",
      "AggregateError",
    ].includes(node.callee.name)
  )
    return false

  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.callee.name)
    if (variable) return variable.defs.length === 0
  }

  return true
}

function caughtBinding(source, node) {
  for (let scope = source.getScope(node); scope; scope = scope.upper) {
    const caught = scope.variables.find(variable =>
      variable.defs.some(definition => definition.type === "CatchClause"),
    )
    if (caught) return caught
  }
}

function refersTo(_source, node, variable) {
  return node?.type === "Identifier" && variable?.references.some(ref => ref.identifier === node)
}

function messageParts(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return [node.value]

  if (node?.type === "TemplateLiteral")
    return node.quasis.map(part => part.value.cooked ?? part.value.raw)

  return []
}

function messageStyle(context, node, uppercase) {
  const source = context.sourceCode
  const parts = messageParts(node)
  if (!parts.length) return

  const first = parts[0]
  const last = parts.at(-1)
  const wrongCase = uppercase ? /^[a-z]/.test(first) : /^[A-Z][a-z]/.test(first)
  const punctuation = /[.!]$/.test(last)
  if (!wrongCase && !punctuation) return

  report(
    context,
    node,
    `Use ${uppercase ? "capitalized error" : "lowercase log"} messages without terminal punctuation`,
    fixer => {
      let text = source.getText(node)

      if (wrongCase) {
        text =
          text.slice(0, 1) +
          (uppercase ? text[1].toUpperCase() : text[1].toLowerCase()) +
          text.slice(2)
      }

      if (punctuation) text = text.slice(0, -2) + text.slice(-1)

      return fixer.replaceText(node, text)
    },
  )
}

const rules = {
  "no-redundant-alias": rule(
    "Use the original type name instead of adding a local synonym",
    context => ({
      TSTypeAliasDeclaration(node) {
        if (
          node.parent.type.startsWith("Export") ||
          node.parent.type === "TSModuleBlock" ||
          node.typeParameters ||
          node.typeAnnotation.type !== "TSTypeReference" ||
          node.typeAnnotation.typeArguments
        )
          return

        const variable = context.sourceCode.getDeclaredVariables(node)[0]
        if (
          !variable ||
          variable.references.some(
            reference => reference.identifier.parent.type === "ExportSpecifier",
          )
        )
          return

        report(context, node, "Use the existing type directly instead of adding a local alias")
      },
    }),
  ),
  "comment-format": rule(
    "Use lowercase unpunctuated fragments for short inline comments",
    context => ({
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== "Line") continue

          const text = comment.value.trim()
          if (
            !text ||
            text.length > 100 ||
            /(?:https?:|eslint|biome-|@ts-|TODO|FIXME|SPDX|Copyright|^#|^\/|^<)/.test(text)
          )
            continue

          // sentences and code examples are not short explanatory fragments
          if (/[.!?]/.test(text.slice(0, -1)) || /[{};=]/.test(text) || !/^[A-Z][a-z]/.test(text))
            continue

          report(
            context,
            comment,
            "Use a lowercase fragment without terminal punctuation for a short comment",
            fixer =>
              fixer.replaceText(
                comment,
                `// ${text[0].toLowerCase()}${text.slice(1).replace(/[.!]$/, "")}`,
              ),
          )
        }
      },
    }),
    true,
  ),
  "error-cause": rule(
    "Preserve caught errors when wrapping them in standard Error constructors",
    context => ({
      ThrowStatement(node) {
        const error = node.argument
        if (error?.type !== "NewExpression" || !standardError(context, error)) return

        // a nested function's failures belong to its own boundary
        let boundary = node.parent

        for (; boundary && boundary.type !== "CatchClause"; boundary = boundary.parent) {
          if (/Function/.test(boundary.type)) return
        }

        if (!boundary) return

        if (boundary.param?.type !== "Identifier") {
          report(context, error, "Bind the complete caught error and preserve it as cause")
          return
        }

        const source = context.sourceCode
        const caught = caughtBinding(source, node)
        if (!caught) return

        const optionsIndex = error.callee.name === "AggregateError" ? 2 : 1
        const options = error.arguments[optionsIndex]

        const cause =
          options?.type === "ObjectExpression" &&
          options.properties.find(property => property.key?.name === "cause")
        if (cause && refersTo(source, cause.value, caught)) return

        report(context, error, "Preserve the original caught error as cause", fixer => {
          if (cause || (options && options.type !== "ObjectExpression")) return null

          for (let scope = source.getScope(node); scope; scope = scope.upper) {
            const variable = scope.set.get(caught.name)
            if (variable && variable !== caught) return null

            if (variable === caught) break
          }

          if (options)
            return fixer.insertTextBefore(
              source.getLastToken(options),
              `${options.properties.length && source.getTokenBefore(source.getLastToken(options)).value !== "," ? "," : ""} cause: ${caught.name}`,
            )

          const last = error.arguments.at(-1)
          if (!last) return null

          return fixer.insertTextAfter(
            last,
            `${error.arguments.length < optionsIndex ? ", undefined" : ""}, { cause: ${caught.name} }`,
          )
        })
      },
    }),
    true,
  ),
  "type-definitions": rule(
    "Use types for records and interfaces for behavioral contracts",
    context => ({
      TSInterfaceDeclaration(node) {
        if (node.body.body.some(behavior) || !node.body.body.length) return

        // declaration merging is part of the contract, including module/global augmentation
        if (node.parent.type === "TSModuleBlock") return

        const variable = context.sourceCode.getDeclaredVariables(node)[0]
        if (variable?.defs.length > 1) return

        report(context, node, "Use a type for a data structure", fixer => {
          const source = context.sourceCode
          const parameters = node.typeParameters ? source.getText(node.typeParameters) : ""
          const parents = node.extends?.map(parent => source.getText(parent)) ?? []
          return fixer.replaceText(
            node,
            `type ${node.id.name}${parameters} = ${[...parents, source.getText(node.body)].join(" & ")}`,
          )
        })
      },
      TSTypeAliasDeclaration(node) {
        if (
          node.typeAnnotation.type !== "TSTypeLiteral" ||
          !node.typeAnnotation.members.some(behavior)
        )
          return

        report(context, node, "Use an interface for a behavioral contract", fixer => {
          const source = context.sourceCode
          const parameters = node.typeParameters ? source.getText(node.typeParameters) : ""
          return fixer.replaceText(
            node,
            `interface ${node.id.name}${parameters} ${source.getText(node.typeAnnotation)}`,
          )
        })
      },
    }),
    true,
  ),
  "no-type-extraction": rule(
    "Import named domain types rather than extracting service internals",
    context => ({
      TSIndexedAccessType(node) {
        let object = node.objectType
        if (object.type === "TSTypeReference" && object.typeName.name === "Awaited") {
          object = object.typeArguments?.params[0]
        }

        if (object?.type === "TSTypeReference" && object.typeName.name === "ReturnType") {
          report(
            context,
            node,
            "Import or declare the named domain type instead of indexing ReturnType",
          )
        }
      },
    }),
  ),
  "dependency-modifiers": rule(
    "Keep injected service dependencies private and readonly",
    context => ({
      TSParameterProperty(node) {
        const declaration = node.parent.parent
        const owner = declaration?.parent?.parent
        if (declaration?.kind !== "constructor" || !/.+Service$/.test(owner?.id?.name ?? "")) return

        if (node.accessibility === "private" && node.readonly) return

        // A public/protected dependency can be used by callers/subclasses; do not hide it automatically.
        report(context, node, "Injected service dependencies must be private readonly")
      },
    }),
  ),
  "member-spacing": rule(
    "Separate methods and CLI metadata from neighboring members",
    context => ({
      ClassBody(node) {
        const source = context.sourceCode

        for (let index = 1; index < node.body.length; index++) {
          const previous = node.body[index - 1]
          const current = node.body[index]

          const method = member =>
            ["MethodDefinition", "TSAbstractMethodDefinition"].includes(member.type)

          const metadata = member => member.static && ["paths", "usage"].includes(member.key?.name)
          if (!method(previous) && !method(current) && !metadata(previous) && !metadata(current))
            continue

          // overload signatures form one declaration and must stay together
          if (
            previous.value?.type === "TSEmptyBodyFunctionExpression" &&
            previous.key?.name === current.key?.name
          )
            continue

          const comments = source.getCommentsBefore(current)
          const start = comments[0] ?? current
          if (start.loc.start.line - previous.loc.end.line > 1) continue

          report(
            context,
            current,
            "Separate class methods and CLI metadata with a blank line",
            fixer => fixer.insertTextBefore(start, "\n"),
          )
        }
      },
    }),
    true,
  ),
  "statement-spacing": rule(
    "Separate guards, loops and multiline calls, keeping checked assignments adjacent",
    context => {
      const source = context.sourceCode

      const identifiers = node => {
        const names = new Set()

        const visit = child => {
          if (!child || typeof child !== "object") return

          if (child.type === "Identifier") names.add(child.name)

          for (const key of source.visitorKeys[child.type] ?? []) {
            const value = child[key]
            if (Array.isArray(value)) value.forEach(visit)
            else visit(value)
          }
        }

        visit(node)
        return names
      }

      const inspect = node => {
        const body = node.body.filter(statement => statement.type !== "EmptyStatement")

        const block = statement =>
          /^(If|For|ForIn|ForOf|While|DoWhile|Try|Switch)Statement$/.test(statement.type) ||
          (statement.loc.end.line > statement.loc.start.line &&
            (statement.type === "ExpressionStatement" || statement.type === "VariableDeclaration"))

        for (let index = 1; index < body.length; index++) {
          const previous = body[index - 1]
          const current = body[index]

          const checked =
            previous.type === "VariableDeclaration" &&
            previous.declarations.length === 1 &&
            previous.declarations[0].id.type === "Identifier" &&
            current.type === "IfStatement" &&
            identifiers(current.test).has(previous.declarations[0].id.name)

          const comments = source.getCommentsBefore(current)
          const start = comments[0] ?? current
          const gap = start.loc.start.line - previous.loc.end.line
          // Comments can explain either side of a guard; do not move them across statements.
          if (checked && !comments.length && gap > 1) {
            report(context, current, "Keep the assignment adjacent to its checking guard", fixer =>
              fixer.replaceTextRange(
                [previous.range[1], current.range[0]],
                `\n${" ".repeat(current.loc.start.column)}`,
              ),
            )
          } else if (!checked && (block(previous) || block(current)) && gap <= 1) {
            report(
              context,
              current,
              "Separate guards, loops and multiline calls with a blank line",
              fixer => fixer.insertTextBefore(start, "\n"),
            )
          }
        }
      }

      return { BlockStatement: inspect, StaticBlock: inspect }
    },
    true,
  ),
  "error-messages": rule(
    "Keep wrapper errors readable and preserve the caught error separately",
    context => ({
      NewExpression(node) {
        if (!standardError(context, node)) return

        const message = node.arguments[node.callee.name === "AggregateError" ? 1 : 0]
        if (!message) return

        messageStyle(context, message, true)
        const caught = caughtBinding(context.sourceCode, node)

        const check = expression => {
          if (
            expression?.type === "MemberExpression" &&
            expression.property.name === "message" &&
            refersTo(context.sourceCode, expression.object, caught)
          ) {
            report(context, node, "Keep the original error in cause, not in the wrapper message")
          }
        }

        if (message.type === "TemplateLiteral") message.expressions.forEach(check)
        else check(message)
      },
    }),
    true,
  ),
  "structured-logging": rule(
    "Use static structured messages and put caught errors under error",
    context => ({
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          !["trace", "debug", "info", "warn", "error", "fatal"].includes(node.callee.property.name)
        )
          return

        const source = context.sourceCode
        if (!/(?:^|\.)[\w$]*logger$/i.test(source.getText(node.callee.object))) return

        const [first, second] = node.arguments
        const message = first?.type === "ObjectExpression" ? second : first
        if (message) messageStyle(context, message, false)

        if (message?.type === "TemplateLiteral" && message.expressions.length) {
          report(
            context,
            message,
            "Pass log values as substitution arguments instead of interpolating the message",
            fixer => {
              if (messageParts(message).some(part => part.includes("%"))) return null

              const text = messageParts(message).join("%s")
              return fixer.replaceText(
                message,
                [
                  JSON.stringify(text),
                  ...message.expressions.map(expression => source.getText(expression)),
                ].join(", "),
              )
            },
          )
        }

        const caught = caughtBinding(source, node)
        if (refersTo(source, first, caught)) {
          report(context, first, 'Put the caught error under the "error" context key', fixer =>
            fixer.replaceText(first, `{ error: ${source.getText(first)} }`),
          )
        }

        if (first?.type === "ObjectExpression") {
          for (const property of first.properties) {
            if (
              property.type !== "Property" ||
              !refersTo(source, property.value, caught) ||
              property.key.name === "error"
            )
              continue

            if (first.properties.some(other => other.key?.name === "error")) {
              report(context, property, 'Put the caught error under the "error" context key')
            } else {
              report(
                context,
                property,
                'Put the caught error under the "error" context key',
                fixer => fixer.replaceText(property, `error: ${source.getText(property.value)}`),
              )
            }
          }
        }

        if (second?.type === "ObjectExpression" && message === first) {
          report(context, second, "Pass structured log context before the message")
        }
      },
    }),
    true,
  ),
  "suppression-explanation": rule(
    "Require specific reasons on lint and formatter suppressions",
    context => ({
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim()
          if (
            !/^(?:biome-ignore(?:-all|-start|-end)?|eslint-disable(?:-next-line|-line)?)\b/.test(
              text,
            )
          )
            continue

          if (/^biome-ignore-end\b/.test(text)) continue

          const reason = text.includes(" -- ")
            ? text.split(" -- ").slice(1).join(" -- ")
            : text.includes(":")
              ? text.slice(text.indexOf(":") + 1).trim()
              : ""
          if (
            !reason ||
            /^(?:todo|fixme|reason|explanation|ignore|legacy|because|needed|false positive)[.!]?$/i.test(
              reason,
            )
          ) {
            report(
              context,
              comment,
              "Explain the specific integration or constraint requiring this suppression",
            )
          }
        }
      },
    }),
  ),
}

// biome owns formatting, imports, optional chaining, any and console
export default { meta: { name: "highstate-style" }, rules }
