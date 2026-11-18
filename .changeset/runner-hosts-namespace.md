---
"@highstate/backend": patch
---

Run units without sidecars on hosts that deny private hosts-file mounts. Report the missing capability when a unit requests a sidecar instead of failing every update before Pulumi starts.
