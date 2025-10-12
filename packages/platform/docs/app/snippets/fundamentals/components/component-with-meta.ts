import { defineUnit } from "@highstate/contract"

export const blogApp = defineUnit({
  type: "acme.blog-app.v1",

  // visual metadata for the designer
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
