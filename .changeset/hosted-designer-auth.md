---
"@highstate/backend": minor
"@highstate/designer": minor
"@highstate/backend-api": patch
---

Add hosted Designer OAuth/OIDC login, durable revocable browser sessions, and backend/project human role authorization while preserving the default local flow. Configured administrator grants are reapplied during backend and project authorization initialization.

Apply resource-aware authorization to Designer collections, runtime actions, and subscriptions. Filter restricted project events, enforce project ownership for runtime resources, and authorize every affected instance when planning, launching, or cancelling operations through Designer and the backend API.
