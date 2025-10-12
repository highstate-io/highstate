# Evaluation Engine

Evaluation turns composite components into virtual instances.
It consumes resolved inputs, executes composite code inside a worker, and saves the resulting models and statuses.

## Pipeline

1. **Input preparation**: [`ProjectModelService.resolveProject`][project-model-service].
   The method loads resident instances and hubs.
   It filters the graph against the library.
   It runs the `InputResolver` to produce `resolvedInputs` per instance.
2. **Worker execution**: [`LocalLibraryBackend.evaluateCompositeInstances`][library-backend-evaluate].
   It spawns `@highstate/backend/library-worker` inside a Node `Worker`.
   The worker calls [`evaluateProject`][worker-evaluator].
   It evaluates instances recursively and captures outputs through `registerInstance`.
3. **Persistence**: [`ProjectEvaluationSubsystem`][project-evaluation-subsystem].
   It stores virtual instance models and evaluation statuses in the project database.
   It publishes updates for user interfaces and ghost detection.

## Virtual instances

- Registration: `registerInstance` (see [component.ts][component-register] and [evaluation.ts][contract-evaluation]).
  It attaches `resolvedInputs` and `resolvedOutputs` to every composite child.
  Later resolver passes reuse the wiring data.
- Storage: virtual instances use `source = "virtual"` in `instance_state`.
  [`ProjectEvaluationSubsystem.setInstanceEvaluationStates`][evaluation-set-states] enforces that flag.
- Ghost detection: [`ProjectModelService.getGhostInstances`][project-model-ghosts].
  It flags deployed instances that lost evaluation state.
  Operations can retire those instances safely.

## Triggers

Evaluation runs after any change that might affect composite output.

- Model edits: [`ProjectService`][project-service] calls `evaluateProject` after a model change.
  The trigger covers renaming, updating, creating, and deleting instances and hubs.
- Unlock events: [`ProjectEvaluationSubsystem`][project-evaluation-subsystem] schedules evaluation.
  The trigger fires when a project unlock task runs.
- Library rebuilds: `watchLibrary` in [local.ts][library-local-watch] reports composite code changes.
  The subsystem re-evaluates affected projects.

## Error handling

- Name conflicts: `InstanceNameConflictError` stops the evaluation cycle.
  The behaviour prevents inconsistent graphs ([worker evaluator][worker-evaluator]).
- Runtime errors: composite failures mark the affected instance branch with `status = "error"`.
  Other branches continue and the worker reports the errors via `topLevelErrors`.
- System failures: worker crashes, timeouts, or library load issues mark every composite instance as errored.
  The subsystem emits a single message for that failure.
  The message originates from `evaluateProject` in [evaluation.ts][project-evaluation-subsystem].
  The message comes from `evaluateProject` in [evaluation.ts][project-evaluation-subsystem].

## Interaction with operations

- Context merge: evaluation publishes virtual and ghost instances.
  [`OperationContext`][operation-context] merges both sets before planning deployments.
- Resolver reuse: the `InputResolver` reuses `resolvedInputs` from virtual instances.
  Operations need one evaluation run per change, so no circular dependency exists.

[project-model-service]: ../packages/platform/backend/src/business/project-model.ts
[library-backend-evaluate]: ../packages/platform/backend/src/library/local.ts
[worker-evaluator]: ../packages/platform/backend/src/library/worker/evaluator.ts
[project-evaluation-subsystem]: ../packages/platform/backend/src/business/evaluation.ts
[component-register]: ../packages/platform/contract/src/component.ts
[contract-evaluation]: ../packages/platform/contract/src/evaluation.ts
[evaluation-set-states]: ../packages/platform/backend/src/business/evaluation.ts
[project-model-ghosts]: ../packages/platform/backend/src/business/project-model.ts
[project-service]: ../packages/platform/backend/src/business/project.ts
[library-local-watch]: ../packages/platform/backend/src/library/local.ts
[operation-context]: ../packages/platform/backend/src/orchestrator/operation-context.ts
