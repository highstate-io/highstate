import { blogApp } from "./component-with-args"

blogApp({
  name: "my-blog",
  args: {
    domain: "myblog.example.com",
    replicas: 3,
    enableComments: true,
    theme: "dark",
    features: ["analytics", "seo"],
    limits: {
      cpu: "500m",
      memory: "512Mi",
    },
  },
})
