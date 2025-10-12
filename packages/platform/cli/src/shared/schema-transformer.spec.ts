import { describe, expect, it } from "vitest"
import { applySchemaTransformations } from "./schema-transformer"

describe("applySchemaTransformations", () => {
  it("should transform simple values using helper functions", async () => {
    const input = `
const spec = {
  inputs: {
    /**
     * The Kubernetes cluster to deploy on.
     */
    cluster: clusterEntity,
  },
  args: {
    /**
     * The port number to use.
     */
    port: Type.Number(),
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      "$addInputDescription(clusterEntity, `The Kubernetes cluster to deploy on.`)",
    )
    expect(result).toContain("$addArgumentDescription(Type.Number(), `The port number to use.`)")
    expect(result).toContain(
      'import { $addArgumentDescription, $addInputDescription } from "@highstate/contract"',
    )
  })

  it("should wrap existing structured objects with helper functions", async () => {
    const input = `
const spec = {
  args: {
    /**
     * The API token for authentication.
     */
    token: {
      schema: Type.String(),
      meta: {
        displayName: "API Token",
        sensitive: true,
      },
    },
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("$addArgumentDescription({")
    expect(result).toContain('displayName: "API Token"')
    expect(result).toContain("sensitive: true")
    expect(result).toContain("}, `The API token for authentication.`)")
  })

  it("should wrap structured objects with helper functions", async () => {
    const input = `
const spec = {
  inputs: {
    /**
     * The target endpoint.
     */
    endpoint: {
      entity: endpointEntity,
      required: false,
    },
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("$addInputDescription({")
    expect(result).toContain("entity: endpointEntity")
    expect(result).toContain("required: false")
    expect(result).toContain("}, `The target endpoint.`)")
  })

  it("should handle $args marker function", async () => {
    const input = `
const spec = {
  args: $args({
    /**
     * The configuration file path.
     */
    configPath: Type.String(),
  }),
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      "$addArgumentDescription(Type.String(), `The configuration file path.`)",
    )
  })

  it("should handle $inputs marker function", async () => {
    const input = `
const spec = {
  inputs: $inputs({
    /**
     * The source data.
     */
    source: dataEntity,
  }),
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("$addInputDescription(dataEntity, `The source data.`)")
  })

  it("should handle $outputs marker function", async () => {
    const input = `
const spec = {
  outputs: $outputs({
    /**
     * The processed result.
     */
    result: resultEntity,
  }),
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("$addInputDescription(resultEntity, `The processed result.`)")
  })

  it("should handle $secrets marker function", async () => {
    const input = `
const spec = {
  secrets: $secrets({
    /**
     * The database password.
     */
    dbPassword: Type.String(),
  }),
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("$addArgumentDescription(Type.String(), `The database password.`)")
  })

  it("should ignore properties without JSDoc comments", async () => {
    const input = `
const spec = {
  inputs: {
    cluster: clusterEntity,
    /**
     * Only this one has a comment.
     */
    endpoint: endpointEntity,
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("cluster: clusterEntity") // unchanged
    expect(result).toContain("$addInputDescription(endpointEntity, `Only this one has a comment.`)") // transformed
  })

  it("should ignore properties not in target objects", async () => {
    const input = `
const config = {
  /**
   * This should not be transformed.
   */
  someProperty: "value",
}

const spec = {
  inputs: {
    /**
     * This should be transformed.
     */
    cluster: clusterEntity,
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain('someProperty: "value"') // unchanged
    expect(result).toContain("$addInputDescription(clusterEntity, `This should be transformed.`)") // transformed
  })

  it("should clean JSDoc comments properly", async () => {
    const input = `
const spec = {
  args: {
    /**
     * This is a description with \`backticks\` and \${template} literals.
     * It also has multiple lines.
     */
    value: Type.String(),
  },
}`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: it is example code
      "$addArgumentDescription(Type.String(), `This is a description with \\`backticks\\` and \\${template} literals.",
    )
    expect(result).toContain("It also has multiple lines.`)")
  })

  it("should add .meta() to z.object fields with JSDoc comments", async () => {
    const input = `
const userSchema = z.object({
  /**
   * The user's unique identifier.
   */
  id: z.string(),
  /**
   * The user's email address.
   */
  email: z.string().email(),
  name: z.string(), // no comment, should not be transformed
})`

    const result = await applySchemaTransformations(input)

    // Should add import at the top
    expect(result).toContain(
      'import { camelCaseToHumanReadable as __camelCaseToHumanReadable } from "@highstate/contract"',
    )

    // Should add .meta() with both title and description
    expect(result).toContain(
      'id: z.string().meta({ title: __camelCaseToHumanReadable("id"), description: `The user\'s unique identifier.` })',
    )
    expect(result).toContain(
      'email: z.string().email().meta({ title: __camelCaseToHumanReadable("email"), description: `The user\'s email address.` })',
    )
    expect(result).toContain("name: z.string(), // no comment") // unchanged
  })

  it("should not add .meta() if already present in z.object fields", async () => {
    const input = `
const userSchema = z.object({
  /**
   * The user's identifier.
   */
  id: z.string().meta({ displayName: "ID" }),
})`

    const result = await applySchemaTransformations(input)

    // Should not modify the field that already has .meta()
    expect(result).toContain('id: z.string().meta({ displayName: "ID" })')
    expect(result).not.toContain("description:")
  })

  it("should handle nested z.object patterns", async () => {
    const input = `
const schema = z.object({
  user: z.object({
    /**
     * The user's name.
     */
    name: z.string(),
    profile: z.object({
      /**
       * The user's age.
       */
      age: z.number(),
    }),
  }),
})`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      'name: z.string().meta({ title: __camelCaseToHumanReadable("name"), description: `The user\'s name.` })',
    )
    expect(result).toContain(
      'age: z.number().meta({ title: __camelCaseToHumanReadable("age"), description: `The user\'s age.` })',
    )
  })

  it("should handle multiple JSDoc-commented fields in the same z.object without conflicts", async () => {
    const input = `
const networkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dhcp"),
  }),
  z.object({
    type: z.literal("static"),

    /**
     * The IPv4 address to assign to the virtual machine.
     */
    address: z.string().optional(),

    /**
     * The CIDR prefix for the IPv4 address.
     *
     * By default, this is set to 24.
     */
    prefix: z.number().default(24),

    /**
     * The IPv4 gateway for the virtual machine.
     *
     * If not specified, will be set to the first address in the subnet.
     */
    gateway: z.string().optional(),
  }),
]).default({ type: "dhcp" })`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      'address: z.string().optional().meta({ title: __camelCaseToHumanReadable("address"), description: `The IPv4 address to assign to the virtual machine.` })',
    )
    expect(result).toContain(
      'prefix: z.number().default(24).meta({ title: __camelCaseToHumanReadable("prefix"), description: `The CIDR prefix for the IPv4 address.',
    )
    expect(result).toContain("By default, this is set to 24.` })")
    expect(result).toContain(
      'gateway: z.string().optional().meta({ title: __camelCaseToHumanReadable("gateway"), description: `The IPv4 gateway for the virtual machine.',
    )
    expect(result).toContain(
      "If not specified, will be set to the first address in the subnet.` })",
    )
    expect(result).toContain('type: z.literal("static"),') // unchanged, no comment
  })

  it("should handle z.object fields inside z.discriminatedUnion", async () => {
    const input = `
const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dhcp"),
  }),
  z.object({
    type: z.literal("static"),
    /**
     * The IPv4 address to assign to the virtual machine.
     */
    address: z.string().optional(),
    /**
     * The CIDR prefix for the IPv4 address.
     */
    prefix: z.number().default(24),
  }),
]).default({ type: "dhcp" })`

    const result = await applySchemaTransformations(input)

    expect(result).toContain(
      'address: z.string().optional().meta({ title: __camelCaseToHumanReadable("address"), description: `The IPv4 address to assign to the virtual machine.` })',
    )
    expect(result).toContain(
      'prefix: z.number().default(24).meta({ title: __camelCaseToHumanReadable("prefix"), description: `The CIDR prefix for the IPv4 address.` })',
    )
    expect(result).toContain('type: z.literal("dhcp"),') // unchanged, no comment
    expect(result).toContain('type: z.literal("static"),') // unchanged, no comment
  })

  it("should handle the full defineUnit case with discriminated union and mixed transformations", async () => {
    const input = `
var virtualMachine = defineUnit({
  type: "proxmox.virtual-machine",
  args: {
    nodeName: z.string().optional(),
    cpuType: z.string().default("host"),
    cores: z.number().default(1),
    sockets: z.number().default(1),
    memory: z.number().default(512),
    /**
     * The IPv4 address configuration for the virtual machine.
     */
    ipv4: {
      schema: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("dhcp")
        }),
        z.object({
          type: z.literal("static"),
          /**
           * The IPv4 address to assign to the virtual machine.
           */
          address: z.string().optional(),
          /**
           * The CIDR prefix for the IPv4 address.
           *
           * By default, this is set to 24.
           */
          prefix: z.number().default(24),
          /**
           * The IPv4 gateway for the virtual machine.
           *
           * If not specified, will be set to the first address in the subnet.
           */
          gateway: z.string().optional()
        })
      ]).default({ type: "dhcp" })
    },
    dns: z.string().array().optional(),
    datastoreId: z.string().optional(),
    diskSize: z.number().default(8),
    bridge: z.string().default("vmbr0"),
    sshPort: z.number().default(22),
    sshUser: z.string().default("root"),
    waitForAgent: z.boolean().default(true),
    vendorData: z.string().optional()
  },
  secrets: {
    sshPassword: z.string().optional()
  },
  inputs: {
    proxmoxCluster: clusterEntity,
    image: imageEntity,
    sshKeyPair: {
      entity: keyPairEntity,
      required: false
    },
    /**
     * The cloud-init vendor data to use for the virtual machine.
     *
     * You can provide a cloud-config from the distribution component.
     */
    vendorData: {
      entity: fileEntity,
      required: false,
    }
  },
  outputs: serverOutputs,
  meta: {
    title: "Proxmox Virtual Machine",
    description: "The virtual machine on a Proxmox cluster.",
    category: "Proxmox",
    icon: "simple-icons:proxmox",
    iconColor: "#e56901",
    secondaryIcon: "codicon:vm"
  },
  source: {
    package: "@highstate/proxmox",
    path: "virtual-machine"
  }
});`

    const result = await applySchemaTransformations(input)

    // Should transform args.ipv4 using $addArgumentDescription helper
    expect(result).toContain("ipv4: $addArgumentDescription({")
    expect(result).toContain("schema: z.discriminatedUnion")
    expect(result).toContain("}, `The IPv4 address configuration for the virtual machine.`)")

    // Should add .meta() to z.object fields with JSDoc comments inside the discriminated union
    expect(result).toContain(
      'address: z.string().optional().meta({ title: __camelCaseToHumanReadable("address"), description: `The IPv4 address to assign to the virtual machine.` })',
    )
    expect(result).toContain(
      'prefix: z.number().default(24).meta({ title: __camelCaseToHumanReadable("prefix"), description: `The CIDR prefix for the IPv4 address.',
    )
    expect(result).toContain("By default, this is set to 24.` })")
    expect(result).toContain(
      'gateway: z.string().optional().meta({ title: __camelCaseToHumanReadable("gateway"), description: `The IPv4 gateway for the virtual machine.',
    )
    expect(result).toContain(
      "If not specified, will be set to the first address in the subnet.` })",
    )

    // Should NOT transform fields without JSDoc comments
    expect(result).toContain("nodeName: z.string().optional(),") // unchanged
    expect(result).toContain('cpuType: z.string().default("host"),') // unchanged
    expect(result).toContain("cores: z.number().default(1),") // unchanged
    expect(result).toContain("dns: z.string().array().optional(),") // unchanged
    expect(result).toContain('type: z.literal("dhcp")') // unchanged
    expect(result).toContain('type: z.literal("static"),') // unchanged

    // Should properly handle inputs.vendorData using $addInputDescription helper
    expect(result).toContain("vendorData: $addInputDescription({")
    expect(result).toContain("entity: fileEntity,")
    expect(result).toContain("required: false,")
    expect(result).toContain("}, `The cloud-init vendor data to use for the virtual machine.")
    expect(result).toContain("You can provide a cloud-config from the distribution component.`)")

    // Should NOT transform other inputs without JSDoc
    expect(result).toContain("proxmoxCluster: clusterEntity,") // unchanged
    expect(result).toContain("image: imageEntity,") // unchanged
  })

  it("should add description to defineUnit function with JSDoc", async () => {
    const input = `
/**
 * Installs the Gateway API CRDs to the cluster.
 */
export const gatewayApi = defineUnit({
  type: "k8s.gateway-api",
  inputs: {
    k8sCluster: clusterEntity,
  },
  outputs: {
    k8sCluster: clusterEntity,
  },
  meta: {
    title: "Gateway API",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:api",
    secondaryIconColor: "#4CAF50",
    category: "Kubernetes",
  },
  source: {
    package: "@highstate/k8s",
    path: "units/gateway-api",
  },
})`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("description: `Installs the Gateway API CRDs to the cluster.`")
    expect(result).toContain('title: "Gateway API"')
    expect(result).toContain('icon: "devicon:kubernetes"')
  })

  it("should add meta field to defineEntity without existing meta", async () => {
    const input = `
/**
 * Represents a Kubernetes cluster.
 */
export const clusterEntity = defineEntity({
  type: "k8s.cluster",
  schema: z.object({
    name: z.string(),
    endpoint: z.string(),
  }),
})`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("meta: {")
    expect(result).toContain("description: `Represents a Kubernetes cluster.`")
    expect(result).toContain("schema: z.object({")
  })

  it("should add description to defineComponent function", async () => {
    const input = `
/**
 * A reusable database component.
 */
export const database = defineComponent({
  type: "database",
  components: {
    server: serverUnit,
    storage: storageUnit,
  },
  meta: {
    category: "Database",
  },
})`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("description: `A reusable database component.`")
    expect(result).toContain('category: "Database"')
  })

  it("should not transform define functions without JSDoc", async () => {
    const input = `
export const simpleUnit = defineUnit({
  type: "simple",
  meta: {
    title: "Simple Unit",
  },
})`

    const result = await applySchemaTransformations(input)

    expect(result).not.toContain("description:")
    expect(result).toContain('title: "Simple Unit"')
  })

  it("should not create nested meta.meta.description structure", async () => {
    const input = `
/**
 * Traefik Gateway unit definition for Kubernetes.
 */
var traefikGateway = defineUnit({
  type: "k8s.apps.traefik-gateway.v1",
  meta: {
    title: "Traefik Gateway",
    icon: "simple-icons:traefikproxy",
    category: "Network",
  },
})`

    const result = await applySchemaTransformations(input)

    // Should have description at the correct level
    expect(result).toContain("meta: {")
    expect(result).toContain("description: `Traefik Gateway unit definition for Kubernetes.`")
    expect(result).toContain('title: "Traefik Gateway"')
    expect(result).toContain('icon: "simple-icons:traefikproxy"')
    expect(result).toContain('category: "Network"')

    // Should NOT have nested meta.meta structure
    expect(result).not.toContain("meta: {\\s*meta: {")

    // Verify the structure more precisely - should only have one meta object
    const metaMatches = (result.match(/meta\s*:\s*\{/g) || []).length
    expect(metaMatches).toBe(1)
  })

  it("should replace existing description in defineUnit meta object", async () => {
    const input = `
/**
 * Updated description for the unit.
 */
export const testUnit = defineUnit({
  type: "test",
  meta: {
    title: "Test Unit",
    description: \`Old description.\`,
    category: "Test",
  },
})`

    const result = await applySchemaTransformations(input)

    expect(result).toContain("description: `Updated description for the unit.`")
    expect(result).not.toContain("Old description")
    expect(result).toContain('title: "Test Unit"')
    expect(result).toContain('category: "Test"')

    // Should still only have one meta object
    const metaMatches = (result.match(/meta\s*:\s*\{/g) || []).length
    expect(metaMatches).toBe(1)
  })
})
