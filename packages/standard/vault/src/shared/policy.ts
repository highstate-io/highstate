import type { vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type DeepInput,
  type Input,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { Policy as NativePolicy } from "@pulumi/vault"
import { getProvider } from "./provider"

export type PolicyCapability =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "list"
  | "patch"
  | "sudo"
  | "deny"

export type PolicyRule = {
  /**
   * The Vault path pattern for the rule.
   */
  path: string

  /**
   * The Vault capabilities granted for the path.
   */
  capabilities: PolicyCapability[]

  /**
   * The optional description rendered as a comment before the rule.
   */
  description?: string

  /**
   * The allowed parameter values for this path.
   */
  allowedParameters?: Record<string, string[]>

  /**
   * The denied parameter values for this path.
   */
  deniedParameters?: Record<string, string[]>

  /**
   * The required parameters for this path.
   */
  requiredParameters?: string[]

  /**
   * The minimum response wrapping TTL for this path.
   */
  minWrappingTtl?: string

  /**
   * The maximum response wrapping TTL for this path.
   */
  maxWrappingTtl?: string
}

export type PolicyArgs = {
  /**
   * The connection to the Vault instance.
   */
  connection: Input<vault.Connection>

  /**
   * The name of the policy.
   */
  name?: Input<string>

  /**
   * The policy document in Vault HCL format.
   */
  policy?: Input<string>

  /**
   * The typed policy rules rendered to Vault HCL.
   */
  rules?: Input<DeepInput<PolicyRule>[]>
}

function renderString(value: string): string {
  return JSON.stringify(value)
}

type PolicyRuleFieldValue = string | number | boolean | string[] | Record<string, string[]>

function renderFieldValue(value: PolicyRuleFieldValue): string {
  if (typeof value === "string") {
    return renderString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => renderString(item)).join(", ")}]`
  }

  const fields = Object.entries(value).map(([key, values]) => {
    return `${renderString(key)} = ${renderFieldValue(values)}`
  })

  return `{ ${fields.join(", ")} }`
}

function renderDescription(description: string | undefined): string[] {
  if (!description) {
    return []
  }

  return description.split("\n").map(line => `# ${line}`)
}

function renderRule(rule: PolicyRule): string {
  const fields: Record<string, PolicyRuleFieldValue | undefined> = {
    allowed_parameters: rule.allowedParameters,
    denied_parameters: rule.deniedParameters,
    required_parameters: rule.requiredParameters,
    min_wrapping_ttl: rule.minWrappingTtl,
    max_wrapping_ttl: rule.maxWrappingTtl,
  }

  const lines = [
    ...renderDescription(rule.description),
    `path ${renderString(rule.path)} {`,
    `  capabilities = ${renderFieldValue(rule.capabilities)}`,
  ]

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue
    }

    lines.push(`  ${key} = ${renderFieldValue(value)}`)
  }

  lines.push("}")

  return lines.join("\n")
}

function renderPolicy(policy: string | undefined, rules: PolicyRule[] | undefined): string {
  const parts = [policy?.trim(), ...(rules ?? []).map(rule => renderRule(rule))]

  return parts.filter(part => part && part.length > 0).join("\n\n")
}

export class Policy extends ComponentResource {
  /**
   * The connection associated with the policy.
   */
  readonly connection: Output<vault.Connection>

  /**
   * The underlying Vault policy resource.
   */
  readonly policy: Output<NativePolicy>

  constructor(name: string, args: PolicyArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:Policy", name, args, opts)

    this.connection = output(args.connection)

    this.policy = output({
      connection: this.connection,
      policy: args.policy,
      rules: args.rules,
    }).apply(async ({ connection, policy, rules }) => {
      const provider = await getProvider(connection)

      return new NativePolicy(
        name,
        {
          name: args.name ?? name,
          policy: renderPolicy(policy, rules),
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })
  }
}
