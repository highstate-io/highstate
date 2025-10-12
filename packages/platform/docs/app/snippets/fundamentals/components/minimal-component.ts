import { defineUnit } from "@highstate/contract"

export const blogApp = defineUnit({
  // 1. unique component type identifier
  type: "acme.blog-app.v1",

  // 2. implementation reference
  source: {
    package: "@acme/units",
    path: "blog-app",
  },
})
