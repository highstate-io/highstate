---
"@highstate/backend": patch
---

Preserve configured HOME and PULUMI_HOME paths when running Pulumi operations so isolated runtimes do not use the caller's plugin directory.
