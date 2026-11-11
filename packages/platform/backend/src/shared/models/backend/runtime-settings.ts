import { commonObjectMetaSchema, z } from "@highstate/contract"

export const runtimeSettingsKindSchema = z.enum([
  "container-runtime",
  "pulumi-state-backend",
  "npm-registry-credential",
  "container-registry-credential",
])
export type RuntimeSettingsKind = z.infer<typeof runtimeSettingsKindSchema>

const secretSchema = z.string().min(1).nullable().optional()
const urlSchema = z
  .url()
  .refine(
    value => !new URL(value).username && !new URL(value).password,
    "URL must not contain credentials",
  )
const httpUrlSchema = urlSchema.refine(
  value => ["http:", "https:"].includes(new URL(value).protocol),
  "Expected HTTP or HTTPS URL",
)
const runtimeCommon = {
  runtimeApiUrl: urlSchema.refine(
    value => new URL(value).protocol === "https:",
    "Expected an HTTPS runtime API URL",
  ),
  runtimeApiCaBundle: z.string().min(1).optional(),
  imageRepository: z.string().min(1).optional(),
}
export const containerRuntimeInputSpecSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...runtimeCommon,
        type: z.literal("docker"),
        engineEndpoint: urlSchema,
        local: z.boolean(),
        tls: z
          .object({
            caBundle: secretSchema,
            clientCertificate: secretSchema,
            clientKey: secretSchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
    z
      .object({
        ...runtimeCommon,
        type: z.literal("kubernetes"),
        kubeconfig: secretSchema,
        context: z.string().min(1).optional(),
        namespace: z.string().min(1),
        serviceAccount: z.string().min(1),
        buildkitImage: z.string().min(1),
      })
      .strict(),
  ])
  .superRefine((spec, context) => {
    if ((spec.type === "kubernetes" || !spec.local) && !spec.imageRepository) {
      context.addIssue({
        code: "custom",
        path: ["imageRepository"],
        message: "Remote runtimes require an OCI image repository",
      })
    }
  })
export type ContainerRuntimeInputSpec = z.infer<typeof containerRuntimeInputSpecSchema>

const baseInput = {
  meta: commonObjectMetaSchema.extend({ title: z.string().trim().min(1) }),
  revision: z.number().int().nonnegative(),
}
export const containerRuntimeInputSchema = z
  .object({
    ...baseInput,
    spec: containerRuntimeInputSpecSchema,
    npmRegistryCredentialIds: z.array(z.string().min(1)).default([]),
    containerRegistryCredentialIds: z.array(z.string().min(1)).default([]),
  })
  .strict()
export const pulumiStateBackendInputSchema = z
  .object({
    ...baseInput,
    spec: z.object({ url: urlSchema, credentials: secretSchema }).strict(),
  })
  .strict()
export const npmRegistryCredentialInputSchema = z
  .object({
    ...baseInput,
    scope: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?$/),
    registryUrl: httpUrlSchema,
    credentials: z
      .object({ token: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()
export const containerRegistryCredentialInputSchema = z
  .object({
    ...baseInput,
    registryUrl: z
      .string()
      .min(1)
      .refine(value => !/[\s/@]/.test(value), "Expected a registry host with optional port"),
    credentials: z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()
export type ContainerRuntimeInput = z.input<typeof containerRuntimeInputSchema>
export type PulumiStateBackendInput = z.input<typeof pulumiStateBackendInputSchema>
export type NpmRegistryCredentialInput = z.input<typeof npmRegistryCredentialInputSchema>
export type ContainerRegistryCredentialInput = z.input<
  typeof containerRegistryCredentialInputSchema
>
export type RuntimeSettingsInputs = {
  "container-runtime": ContainerRuntimeInput
  "pulumi-state-backend": PulumiStateBackendInput
  "npm-registry-credential": NpmRegistryCredentialInput
  "container-registry-credential": ContainerRegistryCredentialInput
}

const outputBase = {
  id: z.string(),
  meta: commonObjectMetaSchema,
  revision: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
}
export const containerRuntimeOutputSchema = z.object({
  ...outputBase,
  spec: z.discriminatedUnion("type", [
    z.object({
      ...runtimeCommon,
      type: z.literal("docker"),
      engineEndpoint: urlSchema,
      local: z.boolean(),
      tls: z.object({
        caBundleConfigured: z.boolean(),
        clientCertificateConfigured: z.boolean(),
        clientKeyConfigured: z.boolean(),
      }),
    }),
    z.object({
      ...runtimeCommon,
      type: z.literal("kubernetes"),
      context: z.string().optional(),
      namespace: z.string(),
      serviceAccount: z.string(),
      buildkitImage: z.string(),
      kubeconfigConfigured: z.boolean(),
    }),
  ]),
  npmRegistryCredentialIds: z.array(z.string()),
  containerRegistryCredentialIds: z.array(z.string()),
})
export const pulumiStateBackendOutputSchema = z.object({
  ...outputBase,
  spec: z.object({ url: urlSchema, credentialsConfigured: z.boolean() }),
})
export const npmRegistryCredentialOutputSchema = z.object({
  ...outputBase,
  scope: z.string(),
  registryUrl: z.string(),
  credentialsConfigured: z.boolean(),
})
export const containerRegistryCredentialOutputSchema = z.object({
  ...outputBase,
  registryUrl: z.string(),
  credentialsConfigured: z.boolean(),
})
export type ContainerRuntimeOutput = z.infer<typeof containerRuntimeOutputSchema>
export type PulumiStateBackendOutput = z.infer<typeof pulumiStateBackendOutputSchema>
export type NpmRegistryCredentialOutput = z.infer<typeof npmRegistryCredentialOutputSchema>
export type ContainerRegistryCredentialOutput = z.infer<
  typeof containerRegistryCredentialOutputSchema
>
export type RuntimeSettingsOutputs = {
  "container-runtime": ContainerRuntimeOutput
  "pulumi-state-backend": PulumiStateBackendOutput
  "npm-registry-credential": NpmRegistryCredentialOutput
  "container-registry-credential": ContainerRegistryCredentialOutput
}

export class RuntimeSettingsConflictError extends Error {
  constructor(kind: RuntimeSettingsKind, id: string) {
    super(`Revision conflict for ${kind} "${id}"`)
  }
}
export class RuntimeSettingsInUseError extends Error {
  constructor(kind: RuntimeSettingsKind, id: string) {
    super(`Cannot delete referenced ${kind} "${id}"`)
  }
}
