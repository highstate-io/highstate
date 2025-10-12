import { blogApp } from "./component-with-connections"

// demo usage - null! is used to silence type checker for missing components
blogApp({
  name: "my-blog",
  args: {
    domain: "myblog.com",
    replicas: 2,
  },
  inputs: {
    cluster: null!,
    database: null!,
  },
})
