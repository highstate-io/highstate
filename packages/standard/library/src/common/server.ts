import { $outputs, $secrets, defineEntity, defineUnit, z } from "@highstate/contract"
import * as dns from "../dns"
import { l3EndpointEntity } from "../network"
import * as ssh from "../ssh"
import { arrayPatchModeSchema } from "../utils"

/**
 * The server entity represents a server with its hostname, endpoints, and optional SSH configuration.
 *
 * The OS of the server is not specified (but in most cases it will one of the Linux distributions).
 *
 * In fact, anything that have hostname (which can be any string) and L3 endpoints can be represented by this entity.
 */
export const serverEntity = defineEntity({
  type: "common.server.v1",

  schema: z.object({
    hostname: z.string(),
    endpoints: l3EndpointEntity.schema.array(),
    ssh: ssh.connectionSchema.optional(),
  }),

  meta: {
    color: "#009688",
  },
})

/**
 * The common outputs for units which create or modify a server.
 */
export const serverOutputs = $outputs({
  /**
   * The server entity representing the server.
   */
  server: serverEntity,

  /**
   * The L3 endpoints of the server.
   */
  endpoints: {
    entity: l3EndpointEntity,
    multiple: true,
  },
})

export const vmSshArgs = ssh.argsSchema.omit({ user: true }).prefault({})

export const vmSecrets = $secrets({
  /**
   * The root password for the virtual machine.
   *
   * If not specified, will be generated automatically.
   */
  rootPassword: z.string().optional(),

  /**
   * The SSH private for the `root` user of the virtual machine in PEM format.
   *
   * If not specified or provided via `keyPair`, will be generated automatically.
   */
  sshPrivateKey: ssh.secrets.sshPrivateKey,
})

/**
 * The existing server created outside of the Highstate.
 */
export const existingServer = defineUnit({
  type: "common.existing-server.v1",

  args: {
    /**
     * The endpoint of the server.
     *
     * Takes precedence over the `endpoint` input.
     */
    endpoint: z.string().optional(),

    /**
     * The SSH confuguration for the server.
     */
    ssh: ssh.argsSchema.prefault({}),
  },

  secrets: {
    ...ssh.secrets,
  },

  inputs: {
    endpoint: {
      entity: l3EndpointEntity,
      required: false,
    },

    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "Existing Server",
    icon: "mdi:server",
    defaultNamePrefix: "server",
    category: "Infrastructure",
  },

  source: {
    package: "@highstate/common",
    path: "units/existing-server",
  },
})

/**
 * Patches some properties of the server and outputs the updated server.
 */
export const serverPatch = defineUnit({
  type: "common.server-patch.v1",

  args: {
    /**
     * The endpoints of the server.
     *
     * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
     *
     * The same server may also be represented by multiple entries (e.g. a node with private and public IP).
     */
    endpoints: z.string().array().default([]),

    /**
     * The mode to use for patching the endpoints.
     *
     * - `prepend`: prepend the new endpoints to the existing ones (default);
     * - `replace`: replace the existing endpoints with the new ones.
     */
    endpointsPatchMode: arrayPatchModeSchema.default("prepend"),
  },

  inputs: {
    server: serverEntity,
    endpoints: {
      entity: l3EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: {
    ...serverOutputs,
  },

  meta: {
    title: "Server Patch",
    icon: "mdi:server",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Infrastructure",
  },

  source: {
    package: "@highstate/common",
    path: "units/server-patch",
  },
})

/**
 * Creates a DNS record for the server and updates the endpoints.
 *
 * The DNS record will be created with the provided FQDN and the endpoints will be updated with the DNS record.
 */
export const serverDns = defineUnit({
  type: "common.server-dns.v1",

  args: dns.createArgs(),

  inputs: {
    server: serverEntity,
    ...dns.inputs,
  },

  outputs: {
    server: serverEntity,
    endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Server DNS",
    icon: "mdi:server",
    secondaryIcon: "mdi:dns",
    category: "Infrastructure",
  },

  source: {
    package: "@highstate/common",
    path: "units/server-dns",
  },
})

/**
 * Runs a shell script on the server.
 */
export const script = defineUnit({
  type: "common.script.v1",

  args: {
    script: z.string().meta({ language: "shell" }),
    updateScript: z.string().optional().meta({ language: "shell" }),
    deleteScript: z.string().optional().meta({ language: "shell" }),
  },

  inputs: {
    server: serverEntity,
  },

  outputs: {
    server: serverEntity,
  },

  meta: {
    title: "Shell Script",
    icon: "mdi:bash",
    category: "Infrastructure",
  },

  source: {
    package: "@highstate/common",
    path: "units/script",
  },
})

export type Server = z.infer<typeof serverEntity.schema>
