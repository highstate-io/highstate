---
"@highstate/api": minor
"@highstate/backend": minor
"@highstate/backend-api": minor
"@highstate/cli": minor
"@highstate/designer": minor
"@highstate/worker-sdk": minor
---

Add project-selected Docker and Kubernetes runtime settings, separate Pulumi state backend settings, encrypted registry credentials, and runtime-aware workload coordination.
Manage these settings and project placement through the Designer and CLI with revision-checked updates and write-only secrets.
Runtime checks verify access to the configured runner base image and an authenticated disposable workload connection, with cleanup after completion or failure.

Replace backend-wide library assignments with exact project npm package selections, immutable dependency snapshots, execution image builds and retries, package-source filtering, and deployed package provenance.
Operations wait for required images, retain historical snapshot execution for refresh and destroy, and validate backend-issued reviewed-plan tokens.
Local development overlays remain limited to the well-known local runtime and retain local execution.
Project unlock collects unreferenced snapshots and package versions while preserving retained deployment, evaluation, operation, runtime action, and build history.

Existing database upgrades preserve deployment and operation history without inventing historical package versions.
Retain the legacy executable environment for deployments with unknown provenance, configure Pulumi state placement separately from workload placement, and regenerate saved operation plans.
Runtime-launched worker images require a runtime-aware worker SDK; legacy SDK connection support does not make older worker images compatible with the new launch options.
