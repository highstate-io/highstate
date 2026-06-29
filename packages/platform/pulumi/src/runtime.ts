import {
  type RuntimeConfigGetOutput,
  type RuntimeResultSubmitInput,
  type RuntimeResultSubmitOutput,
  type RuntimeSidecarStartInput,
  type RuntimeSidecarStartOutput,
  runtimeConfigGetOutputSchema,
  runtimeResultSubmitOutputSchema,
  runtimeSidecarStartOutputSchema,
} from "@highstate/contract"
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client"

export const highstateRuntimeEndpointEnvVar = "HIGHSTATE_RUNTIME_ENDPOINT"
export const highstateRuntimeTokenEnvVar = "HIGHSTATE_RUNTIME_TOKEN"

const highstateRuntimeEndpoint = process.env[highstateRuntimeEndpointEnvVar]
const highstateRuntimeToken = process.env[highstateRuntimeTokenEnvVar]

export const isHighstateRuntimeAvaiable = !!highstateRuntimeEndpoint && !!highstateRuntimeToken

export type HighstateRuntime = {
  config: {
    get(): Promise<RuntimeConfigGetOutput>
  }

  result: {
    submit(input: RuntimeResultSubmitInput): Promise<RuntimeResultSubmitOutput>
  }

  sidecar: {
    start(input: RuntimeSidecarStartInput): Promise<RuntimeSidecarStartOutput>
  }
}

let highstateRuntime: HighstateRuntime | undefined

export function getHighstateRuntime(): HighstateRuntime {
  if (highstateRuntime) {
    return highstateRuntime
  }

  if (!highstateRuntimeEndpoint || !highstateRuntimeToken) {
    throw new Error(
      `Highstate runtime requires "${highstateRuntimeEndpointEnvVar}" and "${highstateRuntimeTokenEnvVar}".`,
    )
  }

  const client = createTRPCUntypedClient({
    links: [
      httpBatchLink({
        url: highstateRuntimeEndpoint,
        headers: {
          authorization: `Bearer ${highstateRuntimeToken}`,
        },
      }),
    ],
  })

  highstateRuntime = {
    config: {
      get: async () => {
        const config = await client.query("config.get")
        return runtimeConfigGetOutputSchema.parse(config)
      },
    },

    result: {
      submit: async input => {
        const output = await client.mutation("result.submit", input)
        return runtimeResultSubmitOutputSchema.parse(output)
      },
    },

    sidecar: {
      start: async input => {
        const output = await client.mutation("sidecar.start", input)
        return runtimeSidecarStartOutputSchema.parse(output)
      },
    },
  }

  return highstateRuntime
}
