import fs from "node:fs"
import ts from "typescript"

const configPath = Bun.argv[2]

if (!configPath) {
  throw new Error(`Expected tsconfig path argument`)
}

const source = fs.readFileSync(configPath, "utf8")
const parsed = ts.parseConfigFileTextToJson(configPath, source)

if (parsed.error) {
  throw new Error(String(parsed.error.messageText))
}

parsed.config.compilerOptions ??= {}
parsed.config.compilerOptions.noCheck = true

fs.writeFileSync(`${configPath}.tmp`, `${JSON.stringify(parsed.config, null, 2)}\n`)
