---
"@highstate/backend": patch
---

Restore signal forwarding for isolated Pulumi commands by default so cancellation and force kill work in supported environments. Set `HIGHSTATE_RUNNER_BACKEND_LOCAL_UNSHARE_FORWARD_SIGNALS=false` when using an `unshare` version without `--forward-signals` support.
