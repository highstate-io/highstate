---
"@highstate/backend": patch
---

Fix Kubernetes operation DNS startup by using a supported CoreDNS reload interval and jitter.
Ensure workload intent hashes always produce valid Kubernetes labels.
Honor HTTP registry configuration during Kubernetes image publication and allow anonymous Docker image pushes.
Provide a writable runtime directory for rootless Kubernetes BuildKit jobs.
