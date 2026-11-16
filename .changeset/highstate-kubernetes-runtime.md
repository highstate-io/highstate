---
"@highstate/library": minor
"@highstate/k8s.apps": minor
---

Add a single-owner Highstate Kubernetes unit with digest-pinned runtime images, isolated Docker execution, and coordinated offline Restic backup and recovery.

Replace the fixed-name runtime Secret in delete-before-create order so login provider changes do not conflict with its previous server-side apply owner.
