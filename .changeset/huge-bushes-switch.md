---
"@highstate/pulumi": patch
---

Restore Highstate secret metadata at Pulumi resource-input registration so nested wrapped values are redacted in previews and encrypted in state, without hiding public sibling fields or changing domain entity schemas. This also covers entities materialized asynchronously or reconstructed from JSON. Existing Pulumi secrecy and unknown values remain intact. Requires a Pulumi engine with resource-transform support. Previously captured logs and existing plaintext state are not retroactively sanitized.
