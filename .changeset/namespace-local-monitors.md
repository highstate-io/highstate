---
"@highstate/k8s": patch
---

Create namespace-local monitor Roles and bindings instead of requiring ClusterRole creation. Give each application's monitor a distinct service-account name so applications can share an existing namespace.
