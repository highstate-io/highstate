import type { common } from "@highstate/library"
import { readFile } from "node:fs/promises"
import { MaterializedFile, parseEndpoints } from "../../shared"

export type GatewayPatchArgs = {
  endpoints: string[]
  clientAuthDnsNames: string[]
}

export type GatewayPatchInputs = {
  clientAuthCa: common.File[]
}

export async function patchGateway(
  gateway: common.Gateway,
  args: GatewayPatchArgs,
  inputs: GatewayPatchInputs,
): Promise<common.Gateway> {
  const endpoints = parseEndpoints(args.endpoints, 3)
  const ca = await readClientAuthCa(inputs.clientAuthCa)

  return {
    ...gateway,
    endpoints: endpoints.length > 0 ? endpoints : gateway.endpoints,
    clientAuth:
      ca.length > 0
        ? {
            ca,
            dnsNames: args.clientAuthDnsNames,
          }
        : gateway.clientAuth,
  }
}

async function readClientAuthCa(files: common.File[]): Promise<string[]> {
  return await Promise.all(
    files.map(async (file, index) => {
      const materializedFile = await MaterializedFile.open(
        file,
        undefined,
        `gateway-client-auth-${index}`,
      )

      return await readFile(materializedFile.path, "utf8")
    }),
  )
}
