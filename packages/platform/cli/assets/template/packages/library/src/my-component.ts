import { defineComponent } from "@highstate/contract"
import { common } from "@highstate/library"

export const myComponent = defineComponent({
  type: "{{projectName}}.my-component.v0",

  inputs: {
    server: common.serverEntity,
  },

  outputs: {
    server: common.serverEntity,
  },

  create({ name, inputs }) {
    const { server } = common.script({
      name,
      inputs,

      args: {
        script: "echo 'Hello, Highstate!'",
      },
    })

    return { server }
  },
})
