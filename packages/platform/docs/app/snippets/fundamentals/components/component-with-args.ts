import { defineUnit, z } from "@highstate/contract"

export const blogApp = defineUnit({
  type: "acme.blog-app.v1",

  // configurable arguments
  args: {
    // text input
    domain: z.string(),

    // number input
    replicas: z.number(),

    // checkbox
    enableComments: z.boolean(),

    // dropdown select
    theme: z.enum(["light", "dark", "auto"]),

    // multi-select dropdown
    features: z.enum(["analytics", "seo", "cache"]).array(),

    // group of inputs
    limits: z.object({
      cpu: z.string(),
      memory: z.string(),
    }),
  },

  meta: {
    title: "Blog Application",
    description: "A simple blog with posts and comments",
    icon: "mdi:post",
    category: "Applications",
  },

  source: {
    package: "@acme/units",
    path: "blog-app",
  },
})
