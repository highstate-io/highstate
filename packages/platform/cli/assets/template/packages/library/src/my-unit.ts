import { defineUnit, z } from "@highstate/contract"
import { common } from "@highstate/library"

export const myUnit = defineUnit({
  type: "{{projectName}}.my-unit.v0",

  args: {
    message: z.string().default("Hello from my-unit!"),
  },

  inputs: {
    server: common.serverEntity,
  },

  outputs: {
    server: common.serverEntity,
  },

  source: {
    package: "@{{projectName}}/units",
    path: "my-unit",
  },
})
