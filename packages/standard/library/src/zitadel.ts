import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  loginIdentitySchema,
  secretSchema,
  z,
} from "@highstate/contract"
import { providerEntity, providerSchema, registrationEntity } from "./oauth"

const meta = { title: "Zitadel", icon: "hugeicons:access", category: "Authentication" }

/**
 * An automation credential for the ZITADEL Management API, separate from login configuration.
 */
export const managementEntity = defineEntity({
  type: "zitadel.management.v1",
  schema: z.object({
    issuer: z.url(),
    token: secretSchema(z.string().min(1)),
  }),
  meta: { ...meta, title: "Zitadel Management" },
})

/**
 * Imports a service user's PAT with permission to manage applications in the target project.
 */
export const managementImport = defineUnit({
  type: "zitadel.management-import.v1",
  args: { issuer: z.url() },
  secrets: { token: z.string().min(1) },
  outputs: { management: managementEntity },
  meta: { ...meta, title: "Import Zitadel Management" },
  source: { package: "@highstate/k8s.apps", path: "zitadel/management-import" },
})

/**
 * Manages a confidential web OIDC client in an existing organization and project.
 */
export const oidcApplication = defineUnit({
  type: "zitadel.oidc-application.v1",
  args: {
    applicationName: z.string().min(1).max(200),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    /**
     * The application's public host, supplied independently of its deployment outputs.
     */
    fqdn: z.hostname(),
    callbackPath: z.string().startsWith("/"),
    scopes: providerSchema.shape.scopes.default(["openid", "profile", "email"]),
    groups: loginIdentitySchema.options[0].shape.groups,
  },
  inputs: { management: managementEntity },
  outputs: { provider: providerEntity, registration: registrationEntity },
  meta: { ...meta, title: "Zitadel OIDC Application" },
  source: { package: "@highstate/k8s.apps", path: "zitadel/registration" },
})

export type Management = EntityValue<typeof managementEntity>
export type ManagementInput = EntityInput<typeof managementEntity>
