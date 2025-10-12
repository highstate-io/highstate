# Resolution Engine

The resolution subsystem builds deterministic dependency graphs for validation, hashing, and operation planning.
It relies on the generic `GraphResolver` base class plus specialized resolvers.

## GraphResolver contract

- Base class: [graph-resolver.ts][graph-resolver].
  Each resolver exposes `getNodeDependencies`.
  Each resolver exposes `processNode`.
  The base class handles traversal, caching, and invalidation.
- Traversal: the workset drives a depth-first walk.
  Dependencies finish before their dependents and outputs remain cached.
- Dependency maps: `dependencyMap` and `dependentMap` record edges so invalidation touches only affected nodes.

## Resolver implementations

### InputResolver

- Source: [input.ts][input-resolver].
  Combines direct connections, hub fan-out, and injection wiring when resolving inputs.
- Virtual reuse: virtual instances expose `resolvedInputs` and `resolvedOutputs`.
  The resolver can reuse that evaluation data instead of recomputing links.
- Output: the resolver produces `ResolvedInstanceInput` records for each input.
  It also records matched injection metadata for downstream tooling.

### ValidationResolver

- Source: [validation.ts][validation-resolver].
  Validates arguments and required inputs against component schemas.
- Propagation: dependency failures bubble upward so invalid upstream instances produce consistent error chains.
- Secret checks: required secrets for unit components are compared with persisted state.
  Missing data surfaces before deployment.

### InputHashResolver

- Source: [input-hash.ts][input-hash-resolver].
  Hashes component definition hashes, arguments, resolved inputs, unit source hashes, and secret nonces with CRC32.
- Outputs: returns an `inputHash` for change detection.
  Returns a `dependencyOutputHash` that summarises upstream output hashes.

## Invalidation behaviour

- Recursive invalidation: `GraphResolver.invalidate` removes cached output for a node.
  It then walks `dependentMap` to invalidate downstream nodes.
- Targeted invalidation: `GraphResolver.invalidateSingle` touches only one node.
  The operation context uses it to recalculate a single input hash after a state update.
- Output observers: `outputHandler` and `dependentSetHandler` let consumers watch resolver output.
  The designer worker uses both to synchronise UI state.

[graph-resolver]: ../packages/platform/backend/src/shared/resolvers/graph-resolver.ts
[input-resolver]: ../packages/platform/backend/src/shared/resolvers/input.ts
[validation-resolver]: ../packages/platform/backend/src/shared/resolvers/validation.ts
[input-hash-resolver]: ../packages/platform/backend/src/shared/resolvers/input-hash.ts
[state-resolver]: ../packages/platform/backend/src/shared/resolvers/state.ts
[project-model-service]: ../packages/platform/backend/src/business/project-model.ts
[operation-context]: ../packages/platform/backend/src/orchestrator/operation-context.ts
[designer-graph-worker]: ../packages/platform/designer/layers/core/app/workers/graph-resolver.ts
