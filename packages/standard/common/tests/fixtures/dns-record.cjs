const { mkdirSync, readFileSync, rmdirSync, writeFileSync } = require("node:fs")
const [, , statePath, operation, type, value] = process.argv
const lock = `${statePath}.lock`
while (true) {
  try {
    mkdirSync(lock)
    break
  } catch (error) {
    if (error.code !== "EEXIST") throw error
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
}

try {
  const records = JSON.parse(readFileSync(statePath, "utf8"))
  if (operation === "create") {
    const existing = Object.values(records)
    if (existing.some(record => record.type === "CNAME") || (type === "CNAME" && existing.length > 0)) {
      throw new Error("CNAME cannot coexist with address records")
    }
    records[value] = { type, value }
  } else {
    delete records[value]
  }
  writeFileSync(statePath, JSON.stringify(records))
} finally {
  rmdirSync(lock)
}
