# Component Authoring

Use this reference when creating or changing Highstate entities, units, composites, or Pulumi implementations.

## Start With The Repository

Read the repository's `AGENTS.md` files, package manifests, TypeScript configuration, and nearby components before
editing code. Follow repository-local structure, naming, style, testing, and dependency conventions when they do
not conflict with Highstate's runtime contracts. Do not impose the examples in this document over established
local conventions.

Locate the library package that exports component definitions and the implementation package that exports unit
programs. Prefer an existing component with similar inputs, outputs, and provider behavior as the primary example.
Do not infer current APIs from memory when installed source or types are available.

## Design The Contract

Define reusable data with `defineEntity`. Define Pulumi-backed components with `defineUnit`, and composition-only
components with `defineComponent`.

- Give every public component and entity a stable type such as `acme.database.v1`. Introduce a new numbered
  variant for an incompatible public shape.
- Put ordinary configuration in `args` and credentials or sensitive generated values in `secrets`.
- Prefer useful defaults over optional arguments. Keep schemas usable in the Designer and avoid optional enums
  that users cannot reset cleanly.
- Model dependencies as typed entity inputs and results as typed entity outputs. Use `required: false` for an
  optional connection and `multiple: true` for a collection.
- Add concise metadata that helps users recognize and place the component: title, icon, category, description,
  and default name prefix where appropriate.
- Export every definition from the library package's public entry point.

Keep units focused on one independently managed lifecycle. Use a composite when a capability is better expressed
as multiple independently planned and deployed components.

## Implement A Composite

A composite's `create` function instantiates and connects other components. It does not contain Pulumi resources
and has no unit `source`.

- Always assign deterministic child names that are unique across the project. Reuse the parent name only when the
  child component types make the resulting instance IDs distinct; otherwise use stable suffixes.
- Pass parent inputs to children directly and return only the outputs promised by the composite contract.
- Use meaningful aliases such as `withCilium` or `withTls` when an entity passes through a chain of patch or
  enhancement components.
- Conditional children must depend only on component arguments and other values available during evaluation.
- Avoid hiding unrelated infrastructure in one composite merely for convenience.

Composite evaluation runs separately from Pulumi deployment. It constructs desired graph structure; it must not
perform provider calls, mutate external systems, or depend on deployed Pulumi outputs.

## Implement A Unit

Set the definition's `source.package` and `source.path` to an exported implementation entry point. Ensure the
implementation package's `package.json` exports that path and its build includes the corresponding source file.

Start the Pulumi entry point with `forUnit(definition)` and use the typed `name`, `stateId`, `args`, `inputs`,
`secrets`, `getSecret`, `invokedTriggers`, and `outputs` values it returns. Import the definition through its
public library package.

- Pass Pulumi inputs and outputs directly to resources whenever possible.
- Do not create resources after awaiting an output that can be unknown during preview. Do not create resources
  inside `apply` callbacks.
- Treat values unwrapped from secret outputs as plaintext. Preserve Pulumi secrecy when deriving or exporting
  sensitive values.
- Use `getSecret` for a value that may be supplied by the user or generated once and persisted by Highstate.
- Always call `outputs(...)` and default-export its result, including for units with no declared entity outputs.
  Highstate uses this result to capture generated secrets and runtime metadata.
- Use stable logical resource names derived from the unit name. Let Pulumi manage replacement and dependency
  ordering rather than implementing ad hoc existence checks.
- Configure providers explicitly when the input contract supplies connection or tenancy information.

Add `$statusFields`, `$pages`, `$terminals`, `$triggers`, or `$workers` only when they provide a concrete user-facing
capability. Keep secret material out of ordinary status and logs. Trigger implementations must remain safe when
the Pulumi program is run repeatedly.

## Verify The Change

Run the repository's formatter or linter, type checker, focused tests, and package build. Add tests for contract
helpers and deterministic transformation logic. For provider resources, verify both preview-safe construction and
the shape passed to `outputs`.

When the repository supports it, launch the Designer and confirm that:

- argument controls and defaults are usable;
- inputs and outputs connect to the intended entity types;
- metadata is recognizable;
- composites evaluate to stable child IDs; and
- the unit implementation resolves from its package export.

Do not run an infrastructure update merely to validate source code unless the user has approved the affected
resources, cost, and destructive risk.
