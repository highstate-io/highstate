# Infrastructure Management

Use this reference to research or update an active Highstate project through the CLI.

## Establish Access

Use `highstate agent status` to refresh current access status before project work. If it reports missing
authorization, ask the user to configure or provide an API key. If it names a locked project, ask the user to
unlock that project. Do not attempt to extract, rotate, create, or bypass credentials unless the user explicitly
requested credential administration and the available interface supports it.

Normal output goes to stdout and diagnostics go to stderr. Use `--output json` for data you need to inspect or
transform reliably.

## Research With Few Calls

Start with compact collections and retrieve complete objects only when needed:

```bash
highstate library list --output json
highstate component get <component-type> --output json
highstate component schema <component-type> --output json
highstate instance list --output json
highstate state list --output json
highstate operation list --output json
```

Use `--all` only when the complete paginated collection is required. Fetch a specific instance with
`instance get`; add `--with-state` only when deployed state matters. Use `model get --include-virtual
--include-ghost` when investigating composite expansion or resources retained after desired graph changes.

Inspect component schemas before constructing or changing arguments. Prefer existing project instances and
nearby repository models as examples, but validate them against the currently loaded library.

## Change Desired State

Use `instance args patch` for targeted argument changes instead of replacing an entire instance. `--set` parses a
YAML value, `--set-string` preserves text, `--set-file` reads structured input, and `--unset` removes a value. Use
`--dry-run` before saving a nontrivial patch.

Use `instance create`, `instance update`, or `model create` with JSON or YAML for structural changes. Read complex
documents from a file or stdin rather than constructing fragile shell quoting. Preserve unrelated fields and
connections.

Deleting an instance removes desired state; it does not destroy deployed infrastructure. Plan and complete the
required destroy operation before deleting the model object when resources must be removed.

## Plan And Execute Operations

Research and model edits are not infrastructure deployment approval. Before a billable, destructive, or externally
visible operation, explain the intended targets and effects and obtain the user's approval unless they already
gave explicit approval for that exact action.

Prefer the reviewable two-step workflow:

```bash
highstate operation plan <update|preview|destroy|recreate|refresh> <instance-id...> --output json > plan.json
highstate operation launch --plan plan.json --title "<clear title>"
```

Use `operation run` only when an interactive combined plan/review/launch flow is appropriate. Non-interactive runs
require `--yes`; do not add it merely to bypass review.

Observe launched work with:

```bash
highstate operation get <operation-id> --output json
highstate operation logs <operation-id> --follow
highstate operation wait <operation-id> --timeout <seconds>
```

Cancellation can leave partial infrastructure changes because an operation is not a transaction across all units.
Cancellation is graceful unless `--force` is explicit. Repeating a graceful request does not escalate; the CLI
suggests `--force` when graceful cancellation is already in progress. A forced cancellation can interrupt cleanup.
Use `operation cancel <operation-id> --yes` for the whole operation or `operation cancel-instance <operation-id>
<instance-id> --yes` for one instance, and add `--force` only when a hard abort is required.
Treat retry and cleanup as reconciliation from the resulting state, not as rollback from an untouched state.

## Verify The Result

After a model-only change, fetch the affected instance or model and confirm the saved shape. After an operation,
wait for completion, inspect failures and logs, then retrieve the affected instance state. Report partial success,
retained resources, or required follow-up explicitly.

Do not claim success from a launch response alone. A launched operation must reach its expected terminal state and
its resulting Highstate state must match the requested outcome.
