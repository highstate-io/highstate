---
"@highstate/backend": patch
---

Keep local library watching scoped to its workspace, avoiding access to unrelated parent-directory contents during startup. Detect workspace replacement through root metadata polling while retaining native file-change notifications inside the workspace.
