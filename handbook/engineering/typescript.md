# TypeScript

Write TypeScript that makes domain intent, control flow, and failures explicit.
Use the owning package's formatter and linter as the authority for mechanical formatting.

## Types

Use `type` for data structures and `interface` for behavioral contracts.
Prefer explicit domain types over utility-composed expressions such as
`Awaited<ReturnType<typeof createServices>>["prisma"]`.
Import or declare a named domain type instead.
Do not add aliases that merely rename an existing type.

Constrain generic parameters and avoid `any`.
When an exceptional integration requires `any`, add the configured lint suppression with a specific
explanation.

## Imports

Import public APIs from package or directory barrels rather than implementation or generated modules.
Add a missing export to the appropriate barrel instead of bypassing it at the call site.
Merge imports from the same module path.

## Dependencies

Inject class dependencies through the constructor and mark them `private readonly`:

```typescript
class ArtifactService {
  constructor(
    private readonly artifactBackend: ArtifactBackend,
    private readonly logger: Logger,
  ) {}
}
```

## Values And Control Flow

Use `??` for defaults when valid values may be falsy, and use optional chaining for optional access.
Prefer `async` and `await` over promise chains.
Await a promise even when returning it directly so errors remain in the current function's control flow.

Use guard clauses and early returns to keep the main path at the base indentation level:

```typescript
const artifact = artifacts[artifactId]
if (!artifact) {
  logger.warn({ artifactId }, `artifact "%s" not found`, artifactId)
  return
}

await updateArtifact(artifact)
```

## Documentation And Comments

Document public methods with multiline JSDoc when their contract is not already defined by a framework
or interface.
Write complete sentences, put one sentence on each line, and separate the description from tags with a
blank line.
Write complete `@param` descriptions without a separating hyphen.
Do not add JSDoc to gRPC handlers or service implementations.
Private methods usually do not need JSDoc.

Use inline comments only to explain non-obvious reasoning.
Use lowercase fragments without punctuation for short comments.
Use complete sentences when a complex algorithm needs a longer explanation.

## Formatting

Break long fluent chains after each call.
When the configured formatter keeps a long call on one line, use its supported formatter-forcing pattern
to preserve a readable break.

Separate guards, loops, multiline calls, and distinct logical blocks with blank lines.
Keep a single assignment directly beside the `if` guard that checks it:

```typescript
const state = stateMap.get(instanceKey)
if (!state) {
  return
}
```

Do not add blank lines inside compact object literals or other tightly related structures.

## Errors

Catch and rethrow errors with operation-specific context while preserving the original error as `cause`:

```typescript
try {
  return await processOperation()
} catch (error) {
  throw new Error(`Failed to process operation "${operationId}"`, { cause: error })
}
```

Capitalize error messages, omit terminal punctuation, and surround identifiers with double quotes.
Do not interpolate an original error's message into the wrapper message.

## Logging

Use the owning package's structured logger rather than console output.
Write lowercase log messages without terminal punctuation.
Pass relevant structured context first, and pass values as substitution parameters instead of
interpolating them into messages.
Put caught errors under the `error` key.
Use a domain-scoped logger, such as a project logger, instead of repeatedly attaching the same identifier.

```typescript
logger.error({ error, operationId }, `failed to process operation "%s"`, operationId)
```
