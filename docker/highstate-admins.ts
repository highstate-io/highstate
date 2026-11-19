const field = process.argv[2]
if (field !== "userIds" && field !== "groupIds") {
  throw new Error("Expected userIds or groupIds")
}
const path = process.env.HIGHSTATE_AUTH_INITIAL_ADMINS_PATH
if (!path) throw new Error("Missing initial administrator configuration path")
const config = await Bun.file(path).json()
const values = config[field]
if (!Array.isArray(values) || !values.every(value => typeof value === "string")) {
  throw new Error(`Missing ${field} or invalid administrator identifiers`)
}
console.log(JSON.stringify(values))

export {}
