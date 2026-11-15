---
"@highstate/backend": patch
---

Keep local library watching scoped to its workspace when filesystem notifications omit filenames, avoiding scans of unrelated directories and startup stalls.
