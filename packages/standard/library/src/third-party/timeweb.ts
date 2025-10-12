import { defineEntity, defineUnit, z } from "@highstate/contract"
import { serverOutputs, vmSecrets, vmSshArgs } from "../common"
import * as ssh from "../ssh"

export const connectionEntity = defineEntity({
  type: "timeweb.connection.v1",

  schema: z.object({
    name: z.string(),
    apiToken: z.string(),
  }),
})

/**
 * The Timeweb connection for a single account.
 */
export const connection = defineUnit({
  type: "timeweb.connection.v1",

  secrets: {
    /**
     * The API token for the Timeweb account.
     *
     * Can be obtained from the Timeweb control panel.
     */
    apiToken: z.string(),
  },

  outputs: {
    connection: connectionEntity,
  },

  meta: {
    title: "Timeweb Connection",
    icon: "material-symbols:cloud",
    category: "Timeweb",
  },

  source: {
    package: "@highstate/timeweb",
    path: "connection",
  },
})

export const virtualMachine = defineUnit({
  type: "timeweb.virtual-machine.v1",

  args: {
    /**
     * The ID of the preset to use for the virtual machine.
     *
     * Can be obtained from the Timeweb control panel when creating a new virtual machine.
     */
    presetId: z.number().optional(),

    /**
     * The ID of the operating system to use for the virtual machine.
     *
     * Can be obtained from the Timeweb control panel when creating a new virtual machine.
     */
    osId: z.number().optional(),

    /**
     * The ID of the connection to use for the virtual machine.
     *
     * Can be obtained from the Timeweb control panel when creating a new virtual machine.
     */
    availabilityZone: z.string(),

    /**
     * The SSH arguments to use for the virtual machine.
     */
    ssh: vmSshArgs,
  },

  inputs: {
    connection: connectionEntity,
    ...ssh.inputs,
  },

  secrets: vmSecrets,

  outputs: {
    ...serverOutputs,
  },

  meta: {
    title: "Timeweb Virtual Machine",
    description: "Creates a new Timeweb virtual machine.",
    icon: "material-symbols:cloud",
    secondaryIcon: "codicon:vm",
    category: "Timeweb",
  },

  source: {
    package: "@highstate/timeweb",
    path: "virtual-machine",
  },
})
