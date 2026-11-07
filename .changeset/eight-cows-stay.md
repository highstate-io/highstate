---
"@highstate/common": patch
---

Protect remote Command host inputs and SSH connections as Pulumi secrets so nested credentials are redacted from previews and encrypted in state. Highstate entity secret wrappers remain unchanged. Existing plaintext state and previously captured logs are not retroactively sanitized.
