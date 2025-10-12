import { z } from "@highstate/contract"

export const pulumiBackendSpecSchema = z.discriminatedUnion("type", [
  z.object({
    /**
     * Use the Pulumi backend configured on the host where Highstate backend is running.
     *
     * The backend is expected to be configured with the `pulumi login` command by the user.
     */
    type: z.literal("host"),
  }),
])

export type PulumiBackendSpec = z.infer<typeof pulumiBackendSpecSchema>
