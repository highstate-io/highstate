---
"@highstate/backend": minor
"@highstate/designer": minor
---

Add system-keyring project unlock methods with optional per-method startup unlocking and reuse of an existing discoverable Highstate passkey across projects without a backend identity registry or source-project selection. Each new passkey method protects its own AGE identity using WebAuthn PRF; first-time credential enrollment is separate from adding methods. Store encrypted AGE unlock identity envelopes consistently for passwords, passkeys, and system keyrings, with a shared keyring wrapping identity kept on the backend host. Keep project unlock metadata self-contained, preserve existing passkeys, and explain method-specific recovery and transfer risks during setup and when adding methods.
