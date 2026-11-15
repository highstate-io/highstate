# Designer Agent Guide

- Reuse existing layouts, tables, forms, and action components instead of introducing one-off UX.
- Follow the permission-aware interface requirements in `dev-docs/engineering/designer-development.md` for every access rejection.
- Keep table-row actions icon-only, with tooltips and accessible names.
- Consolidate resource editing in one edit form. Put deletion in a row action with a separate confirmation dialog
  identifying the resource, not in the edit form.
- Keep data live-synchronized, including after reconnecting; do not add manual refresh or reload controls.
- Unless another mode is requested, start development from the workspace root with
  `HIGHSTATE_ENCRYPTION_ENABLED=false bun run --bun --filter @highstate/designer dev` to use Bun without an
  OS secret-service dependency.
