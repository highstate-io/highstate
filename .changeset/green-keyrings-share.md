---
"@highstate/backend": minor
"@highstate/designer": minor
---

Add system-keyring project unlock methods with optional per-method startup unlocking and reuse of an existing discoverable Highstate passkey across projects without a backend identity registry or source-project selection. Each new passkey method protects its own AGE identity using WebAuthn PRF, with automatic enrollment fallback in the same Create action. Store encrypted AGE unlock identity envelopes consistently for passwords, passkeys, and system keyrings, with a shared keyring wrapping identity kept on the backend host. Keep project unlock metadata self-contained, preserve existing passkeys, and explain method-specific recovery and transfer risks during setup and when adding methods. Add an authorized Lock project action beside Reset Layout that revokes idle-project access, closes cached database connections, and updates connected clients.
