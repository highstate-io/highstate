import { defineUnit, z } from "@highstate/contract"
import { common, databases, k8s } from "@highstate/library"

export const blogApp = defineUnit({
  type: "acme.blog-app.v1",

  args: {
    domain: z.string(),
    replicas: z.number(),
  },

  // components can connect to each other via inputs and outputs
  inputs: {
    // this blog needs a Kubernetes cluster to deploy to
    cluster: k8s.clusterEntity,
    // and a database to store posts
    database: databases.mariadbEntity,
  },

  outputs: {
    // other components can connect to our blog's web interface
    webService: k8s.serviceEntity,
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
