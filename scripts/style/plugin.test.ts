import { execFileSync } from "node:child_process"
import { Linter } from "eslint"
import { parser } from "typescript-eslint"
import { describe, expect, it } from "vitest"
import plugin from "./plugin.mjs"

function check(name: string, code: string, fix = false) {
  const linter = new Linter()

  const config = {
    languageOptions: { parser },
    plugins: { highstate: plugin },
    rules: { [`highstate/${name}`]: "error" as const },
  }

  return fix
    ? linter.verifyAndFix(code, config, { allowInlineConfig: false })
    : { messages: linter.verify(code, config, { allowInlineConfig: false }), output: code }
}

describe("style diagnostics", () => {
  it("preserves trailing comments when removing space before a single-line guard", () => {
    const input = `const value = lookup() // retain this explanation

if (!value) {
  return
}`

    expect(check("statement-spacing", input, true).output).toBe(input.replace("\n\nif", "\nif"))
  })

  it("keeps a trailing comment attached when spacing the following multiline declaration", () => {
    const input = `const priority = (100000 - containerPort) % 100 // each next interface gets lower priority
const namespace = Namespace.createOrPatch(appName, {
  cluster,
})`

    const expected = input.replace("\nconst namespace", "\n\nconst namespace")
    expect(check("statement-spacing", input, true).output).toBe(expected)
    expect(check("statement-spacing", expected).messages).toEqual([])
  })

  it("keeps a trailing class-member comment attached when spacing methods", () => {
    const input = `class Store {
  value = 1 // initial value
  get() { return this.value }
}`

    const expected = input.replace("\n  get()", "\n\n  get()")
    expect(check("member-spacing", input, true).output).toBe(expected)
    expect(check("member-spacing", expected).messages).toEqual([])
  })

  it("separates a single const from a multiline guard condition", () => {
    const input = `const previousPage = pages.value[pageIndex - 1]
if (
  pageIndex > 0 &&
  !previousPage?.nextPageToken
) {
  return
}`

    const expected = input.replace("\nif (", "\n\nif (")
    expect(check("statement-spacing", input).messages).toHaveLength(1)
    expect(check("statement-spacing", input, true).output).toBe(expected)
    expect(check("statement-spacing", expected).messages).toEqual([])
  })

  it("keeps a single const line adjacent to its guard regardless of referenced values", () => {
    const input = `const pageIndex = page.value - 1

if (!force && pages.value[pageIndex]) {
  updateData()
  return
}

const previousPage = pages.value[pageIndex - 1]

if (pageIndex > 0 && !previousPage?.nextPageToken) {
  page.value = Math.max(1, pages.value.length)
  updateData()
  return
}`

    const expected = input.replaceAll("\n\nif (", "\nif (")
    expect(check("statement-spacing", input).messages).toHaveLength(2)
    expect(check("statement-spacing", input, true).output).toBe(expected)
    expect(check("statement-spacing", expected).messages).toEqual([])
  })

  it("separates a compound guard involving multiple assigned values", () => {
    const input = `const providedIpv4 = primaryAddresses.filter(address => address.type === "ipv4")
const providedIpv6 = primaryAddresses.filter(address => address.type === "ipv6")

if (providedIpv4.length > 1 || providedIpv6.length > 1) {
  throw new Error("At most one Primary IP address of each family can be attached")
}`

    expect(check("statement-spacing", input).messages).toEqual([])
    expect(check("statement-spacing", input, true).output).toBe(input)
    const adjacent = input.replace("\n\nif (", "\nif (")
    expect(check("statement-spacing", adjacent, true).output).toBe(input)
  })

  it("rejects static imports after code, including hoisted mock declarations", () => {
    const result = check(
      "imports-first",
      `import { vi } from "vitest";
const mocks = vi.hoisted(() => ({}));
import { Service } from "./service";`,
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.line).toBe(3)
  })

  it("allows directives and grouped imports before code", () => {
    const result = check(
      "imports-first",
      `"use strict";
import type { Options } from "./options";
import { Service } from "./service";
const service = new Service();`,
    )

    expect(result.messages).toEqual([])
  })

  it.each(["\n", "\n\n"])("separates multiline awaited calls from guards (%j)", gap => {
    const declaration = `async function find(database, apiKeyId) {
  const apiKey = await database.apiKey.findUnique({
    where: { id: apiKeyId },
    include: ProjectApiKeySettingsService.include(),
  })`

    const guard = `  if (!apiKey) {
    return null
  }
}`

    const result = check("statement-spacing", declaration + gap + guard, true)

    const formatted = execFileSync(
      "./node_modules/.bin/biome",
      ["format", "--stdin-file-path=fixture.ts"],
      { input: result.output, encoding: "utf8" },
    )

    expect(result.messages).toEqual([])
    expect(formatted).toBe(`${declaration}\n\n${guard}\n`)
    expect(check("statement-spacing", formatted).messages).toEqual([])
  })

  it.each([false, true])("converts mapping guards to a switch (braces: %s)", braces => {
    const branch = (value: string) => (braces ? `{ return "${value}" }` : `return "${value}"`)

    const input = `function map(value) {
      if (value === "update") ${branch("update")}
      if (value === "preview") ${branch("preview")}
      throw new Error("Unknown operation")
    }`

    const result = check("switch-mappers", input, true)

    expect(result.messages).toEqual([])
    expect(result.output).toContain("switch (value)")
    expect(result.output).toContain('case "update":')
    expect(result.output).toContain('case "preview":')

    const original = new Function(`${input}; return map`)()
    const converted = new Function(`${result.output}; return map`)()

    for (const value of ["update", "preview"]) {
      expect(converted(value)).toBe(original(value))
    }

    expect(() => converted("unknown")).toThrow("Unknown operation")

    const formatted = execFileSync(
      "./node_modules/.bin/biome",
      ["format", "--stdin-file-path=fixture.ts"],
      { input: result.output, encoding: "utf8" },
    )

    expect(check("switch-mappers", formatted).messages).toEqual([])
  })

  it("separates top-level guards and try blocks while keeping the checked assignment adjacent", () => {
    const input = `const mode = process.env.HIGHSTATE_E2E_MODE ?? "development"
if (mode !== "development" && mode !== "production") {
  throw new Error("HIGHSTATE_E2E_MODE must be development or production")
}
const designer = await startDesigner({ mode })
try {
  await inspectDesigner(designer)
} finally {
  await designer.stop()
}`

    expect(check("statement-spacing", input).messages).toHaveLength(2)
    const fixed = check("statement-spacing", input, true)
    expect(fixed.messages).toEqual([])

    expect(fixed.output).toBe(
      input
        .replace("}\nconst designer", "}\n\nconst designer")
        .replace("({ mode })\ntry", "({ mode })\n\ntry"),
    )

    expect(check("statement-spacing", fixed.output).messages).toEqual([])
  })

  it("does not separate an ASI safety semicolon from the following expression", () => {
    const input = `export type Output = {
  value: string
}

;(self as Worker).onmessage = () => {
  receive()
}`

    expect(check("statement-spacing", input).messages).toEqual([])
  })

  it.each(["\n", "\n\n"])("separates multiline declarations from their guards (%j)", gap => {
    const declaration = `function validate(operation) {
  const requiresValue =
    operation.operation === InstanceArgumentPatchOperation_Operation.ADD ||
    operation.operation === InstanceArgumentPatchOperation_Operation.REPLACE ||
    operation.operation === InstanceArgumentPatchOperation_Operation.TEST`

    const guard = `  if (requiresValue && operation.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "Value is required" })
  }
}`

    const input = declaration + gap + guard
    const expected = `${declaration}\n\n${guard}`
    const result = check("statement-spacing", input, true)

    expect(result.messages).toEqual([])

    const formatted = execFileSync(
      "./node_modules/.bin/biome",
      ["format", "--stdin-file-path=fixture.ts"],
      { input: result.output, encoding: "utf8" },
    )

    expect(formatted).toBe(`${expected}\n`)
    expect(check("statement-spacing", formatted).messages).toEqual([])
  })

  it.each([
    ["type-definitions", "interface Record { id: string }", "type Record = { id: string }"],
    ["type-definitions", "type Store = { get(): string }", "interface Store { get(): string }"],
    [
      "type-definitions",
      "interface Record<T> extends Parent<T> { id: T }",
      "type Record<T> = Parent<T> & { id: T }",
    ],
    ["member-spacing", "class Store { id = 1;\nget() {} }", "class Store { id = 1;\n\nget() {} }"],
    [
      "member-spacing",
      "class Command { static paths = [];\nstatic usage = {}; }",
      "class Command { static paths = [];\n\nstatic usage = {}; }",
    ],
    [
      "statement-spacing",
      "function get() { const x = find();\n\nif (!x) return;\nuse(x) }",
      "function get() { const x = find();\nif (!x) return;\n\nuse(x) }",
    ],
    [
      "statement-spacing",
      "function get() { for (const x of xs) use(x);\nfinish() }",
      "function get() { for (const x of xs) use(x);\n\nfinish() }",
    ],
    ["error-messages", 'throw new Error("failed.")', 'throw new Error("Failed")'],
    [
      "statement-spacing",
      "async function load() {\n;({ value } = await fetch(\n  first,\n  second,\n))\n}",
      "async function load() {\n;({ value } = await fetch(\n  first,\n  second,\n))\n}",
    ],
    [
      "error-cause",
      'try {} catch (error) { throw new Error("Failed") }',
      'try {} catch (error) { throw new Error("Failed", { cause: error }) }',
    ],
    ["comment-format", "// Explain the lookup.\nlookup()", "// explain the lookup\nlookup()"],
    ["error-messages", "throw new Error(`failed ${id}.`)", "throw new Error(`Failed ${id}`)"],
    [
      "structured-logging",
      "logger.error(`Failed for ${id}.`)",
      'logger.error("failed for %s", id)',
    ],
    [
      "structured-logging",
      'try {} catch (err) { logger.error({ err }, "failed") }',
      'try {} catch (err) { logger.error({ error: err }, "failed") }',
    ],
    [
      "structured-logging",
      'try {} catch (err) { logger.error(err, "failed") }',
      'try {} catch (err) { logger.error({ error: err }, "failed") }',
    ],
  ])("fixes %s and converges", (name, input, output) => {
    const result = check(name, input, true)

    expect(result.messages).toEqual([])
    expect(result.output).toBe(output)
    expect(check(name, result.output, true).output).toBe(output)

    const formatted = execFileSync(
      "./node_modules/.bin/biome",
      ["format", "--stdin-file-path=fixture.ts"],
      { input: result.output, encoding: "utf8" },
    )

    expect(check(name, formatted).messages).toEqual([])
  })

  it.each([
    ["type-definitions", "interface Store { get(): string }"],
    ["switch-mappers", 'function map(value) { if (value === "a") return 1; return 2 }'],
    ["switch-mappers", 'function map(a, b) { if (a === "a") return 1; if (b === "b") return 2 }'],
    ["switch-mappers", "function map(value) { if (value > 1) return 1; if (value > 2) return 2 }"],
    [
      "switch-mappers",
      'function map(value) { if (value === "a") log(); if (value === "b") log() }',
    ],
    [
      "switch-mappers",
      'function map() { if (read() === "a") return 1; if (read() === "b") return 2 }',
    ],
    ["no-redundant-alias", "export type PublicName = InternalName"],
    ["no-redundant-alias", "declare global { namespace PrismaJson { type Meta = Contract.Meta } }"],
    ["error-cause", 'try {} catch (error) { throw new DomainError("Failed", error) }'],
    ["error-cause", 'function f(Error) { try {} catch (error) { throw new Error("custom-key") } }'],
    ["error-messages", 'function f(Error) { throw new Error("custom-key") }'],
    ["error-cause", 'try {} catch (error) { throw new Error("Failed", { cause: error }) }'],
    ["error-cause", 'try {} catch (error) { function inner() { throw new Error("Unrelated") } }'],
    ["comment-format", "// HTTP headers preserve upstream casing\nlookup()"],
    ["comment-format", "// This is a long explanation. It has two sentences.\nlookup()"],
    ["type-definitions", "interface Store { get: () => string }"],
    ["type-definitions", "interface Merged { a: string }; interface Merged { b: string }"],
    ["type-definitions", 'declare module "external" { interface Options { enabled: boolean } }'],
    ["no-type-extraction", "type Result = ReturnType<typeof calculate>"],
    [
      "dependency-modifiers",
      "class ArtifactService { constructor(private readonly logger: Logger) {} }",
    ],
    ["dependency-modifiers", "class Value { constructor(public value: string) {} }"],
    ["member-spacing", "class Store { get(id: string): string;\nget(id: unknown) { return '' } }"],
    ["statement-spacing", "function get() { const x = 1;\nconst y = 2;\nreturn x + y }"],
    ["error-messages", 'try {} catch (error) { throw new Error("Failed", { cause: error }) }'],
    ["error-messages", 'throw new InvalidCredentialError("backend-api-key")'],
    [
      "error-messages",
      "try {} catch (error) { function inner(error) { return new Error(error.message) } }",
    ],
    ["structured-logging", 'logger.info({ id }, "created artifact %s", id)'],
    ["structured-logging", "translator.info(`Hello ${name}.`)"],
    [
      "structured-logging",
      'try {} catch (err) { function inner(err) { logger.info({ err }, "received") } }',
    ],
    [
      "suppression-explanation",
      "// biome-ignore lint/suspicious/noExplicitAny: third-party callback has no published type\nconst value: any = external",
    ],
    [
      "suppression-explanation",
      "// eslint-disable-next-line highstate/error-messages -- upstream matches this exact message\nthrow new Error('lowercase')",
    ],
  ])("accepts %s exceptions", (name, input) => {
    expect(check(name, input).messages).toEqual([])
  })

  it.each([
    ["no-type-extraction", 'type Prisma = Awaited<ReturnType<typeof createServices>>["prisma"]'],
    [
      "switch-mappers",
      'function map(value) { if (value === "a") { /* preserve context */ return 1 } if (value === "b") return 2 }',
    ],
    ["no-redundant-alias", "type Alias = Original; const value: Alias = input"],
    ["error-cause", 'try {} catch { throw new Error("Failed") }'],
    ["error-cause", 'try {} catch ({ message }) { throw new Error("Failed") }'],
    ["error-cause", 'try {} catch (error) { { const error = other; throw new Error("Failed") } }'],
    ["dependency-modifiers", "class ArtifactService { constructor(public logger: Logger) {} }"],
    [
      "error-messages",
      "try {} catch (error) { throw new Error(`Failed: ${error.message}`, { cause: error }) }",
    ],
    ["structured-logging", 'logger.info("created", { id })'],
    [
      "suppression-explanation",
      "// biome-ignore lint/suspicious/noExplicitAny: TODO\nconst value: any = external",
    ],
    ["suppression-explanation", "// eslint-disable-next-line\nexternal()"],
  ])("reports %s without inventing a fix", (name, input) => {
    const result = check(name, input)

    expect(result.messages.some(message => message.ruleId === `highstate/${name}`)).toBe(true)
    expect(result.messages.every(message => !message.fix)).toBe(true)
  })

  it.each([
    'try {} catch (error) { throw new Error("Failed", {}) }',
    'try {} catch (error) { throw new Error("Failed", { code: 1, }) }',
    'try {} catch (error) { throw new AggregateError([], "Failed") }',
  ])("adds a cause without losing existing error options", input => {
    const result = check("error-cause", input, true)

    expect(result.messages).toEqual([])
    expect(result.output).toContain("cause: error")

    if (input.includes("code: 1")) {
      expect(result.output).toContain("code: 1")
    }
  })
})
