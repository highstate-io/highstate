import { defineComponent } from "@highstate/contract"
import { common } from "@highstate/library"

export const testComponent = defineComponent({
  type: "example.test-component.v1",

  create() {
    common.existingServer({
      name: "server-ttt56789044",
    })
  },
})
