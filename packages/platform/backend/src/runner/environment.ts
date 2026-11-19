import { homedir } from "node:os"
import { resolve } from "node:path"

/**
 * Preserves explicitly isolated runtime paths without inheriting unrelated credentials.
 */
export function getPulumiEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  return {
    HOME: home,
    PULUMI_HOME: env.PULUMI_HOME ?? resolve(home, ".pulumi"),
  }
}
