---
"@highstate/library": minor
"@highstate/common": minor
"@highstate/k8s": minor
"@highstate/k8s.apps": minor
---

Add an ExetRouter Kubernetes unit with persistent state, an HTTPS API, restricted SSH management, and optional encrypted restic backups with consistent SQLite snapshots and automatic restoration.

Support ACME DNS01 CNAME delegation through application `dnsChallengeAlias` arguments and certificate `dnsChallengeAliases` maps. Validate existing challenge CNAME records before issuance and select a compatible issuer using the delegated TXT record locations.
