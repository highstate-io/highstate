import type { k8s, oauth, postgresql } from "@highstate/library"
import { readFile } from "node:fs/promises"
import { MaterializedFile } from "@highstate/common"
import { loginProviderConfigSchema } from "@highstate/contract"
import { getPostgresqlConnectionUrl } from "../shared"

/** Uses the same verified TLS settings for node-postgres and libpq backup tools. */
export async function createPostgresqlConfig(
  connection: postgresql.Connection,
  cluster: k8s.Cluster,
) {
  const url = new URL(getPostgresqlConnectionUrl(connection, cluster))
  if (connection.ca && connection.insecure) {
    throw new Error("A PostgreSQL CA cannot be combined with an insecure connection")
  }
  if (!connection.insecure) {
    url.searchParams.set("sslmode", "verify-full")
    url.searchParams.set(
      "sslrootcert",
      connection.ca ? "/recovery/postgresql-ca.crt" : "/etc/ssl/certs/ca-certificates.crt",
    )
  }
  if (connection.ca) {
    await using ca = await MaterializedFile.open(connection.ca)
    return { url: url.toString(), ca: await readFile(ca.path, "utf8") }
  }
  // libpq and node-postgres need the same explicit public trust bundle.
  return { url: url.toString(), ca: undefined }
}

/** Converts infrastructure capabilities to the runtime contract without retaining entity metadata. */
export function createLoginConfig(providers: oauth.LoginProvider[]) {
  const configs = providers.map(provider =>
    loginProviderConfigSchema.parse({
      ...provider,
      clientId: provider.clientId.value,
      clientSecret: provider.clientSecret?.value,
    }),
  )
  if (configs.length === 0 || new Set(configs.map(config => config.id)).size !== configs.length) {
    throw new Error("Highstate requires login providers with unique IDs")
  }
  return JSON.stringify(configs)
}
