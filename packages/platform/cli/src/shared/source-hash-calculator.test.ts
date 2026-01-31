import { describe, expect, test } from "vitest"
import { parseFileDependencies } from "./source-hash-calculator"

describe("parseFileDependencies", () => {
  test("parses relative imports", () => {
    const filePath = "/repo/src/main.ts"
    const content = "import { x } from './utils'\n"

    const deps = parseFileDependencies(filePath, content)

    expect(deps).toEqual([
      {
        type: "relative",
        id: "relative:/repo/src/utils",
        fullPath: "/repo/src/utils",
      },
    ])
  })

  test("parses npm imports", () => {
    const filePath = "/repo/src/main.ts"
    const content = "import { mapValues } from 'remeda'\n"

    const deps = parseFileDependencies(filePath, content)

    expect(deps).toEqual([
      {
        type: "npm",
        id: "npm:remeda",
        package: "remeda",
      },
    ])
  })

  test("ignores node: built-in imports", () => {
    const filePath = "/repo/src/main.ts"
    const content = "import { readFile } from 'node:fs/promises'\n"

    const deps = parseFileDependencies(filePath, content)

    expect(deps).toEqual([])
  })

  test("supports multi-line imports", () => {
    const filePath = "/repo/src/main.ts"
    const content = 'import {\n  a,\n  b,\n} from "pkg-types"\n'

    const deps = parseFileDependencies(filePath, content)

    expect(deps).toEqual([
      {
        type: "npm",
        id: "npm:pkg-types",
        package: "pkg-types",
      },
    ])
  })

  test("does not match identifiers like importBasePath or template strings containing from", () => {
    const filePath = "/repo/src/main.ts"
    const content = [
      "const x = {",
      "  importBasePath: '/some/path',",
      "}",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: false positive
      'throw new Error(`Cannot use output "foo" from "${input.input.instanceId}"`)\n',
    ].join("\n")

    const deps = parseFileDependencies(filePath, content)

    expect(deps).toEqual([])
  })
})
