---
"@highstate/library": patch
"@highstate/k8s.apps": patch
---

Support explicitly selected ReadWriteOnce storage for Highstate with an exclusive filesystem lock shared by the runtime and offline backups. ReadWriteOncePod remains the default.
