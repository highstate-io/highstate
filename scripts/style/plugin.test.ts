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

    if (input.includes("code: 1")) expect(result.output).toContain("code: 1")
  })
})
