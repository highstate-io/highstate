---
"@highstate/k8s.apps": patch
---

Allow Highstate and PostgreSQL workloads to start before delayed-binding PVCs become bound, without requiring cluster-scoped StorageClass reads.
