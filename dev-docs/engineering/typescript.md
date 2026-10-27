# TypeScript

Write TypeScript that makes domain intent, control flow, and failures explicit.
The workspace's Biome configuration and local ESLint rules own mechanical style.
Run `bun run lint:fix` from the workspace root to apply fixes, then `bun run lint` to check the result.
The fix command reports requirements that need an intentional code change.
Generated code, vendored code, and project templates are excluded from these checks.

## Domain Design

Prefer named domain types over expressions that extract implementation details from factories.
Use meaningful generic constraints when an implementation depends on properties of its type parameters.
Do not add vacuous constraints just to constrain a generic.

Import public APIs through the owning package or module barrel.
Add missing public exports to that barrel rather than coupling consumers to implementation or generated modules.
Internal imports within the owning module can reference its implementation files.
Keep intentional public type aliases and declaration augmentations when they define an integration contract.

Inject service dependencies through constructors.
Use a domain-scoped logger instead of repeatedly attaching the same identifier.

## Control Flow And Failures

Use nullish defaults when valid values may be falsy.
Prefer async functions and `await` to promise chains, while preserving intentional concurrency and cleanup.
Use guard clauses to keep the main path at the base indentation level.
Separate distinct logical blocks when doing so clarifies their relationship.
Let the formatter choose line breaks instead of adding formatter-forcing syntax.

Wrap failures at meaningful operation boundaries with operation-specific context.
Preserve the original failure as the cause, including when using a domain error constructor.
Surround identifiers in error messages with double quotes.
Log relevant structured context before the message and keep caught errors under the `error` key.
Use the owning package's logger; terminal output remains appropriate for CLI results and explicit output forwarding.

## Documentation

Document public method contracts when they are not already defined by an interface or framework.
Describe behavior, inputs, and failure conditions rather than restating the method name.
Do not add redundant JSDoc to gRPC handlers or service implementations.
Private methods usually do not need JSDoc.

Write complete sentences in JSDoc, with one sentence per line.
Use inline comments to explain non-obvious reasoning.
Longer algorithm explanations can use complete sentences rather than short fragments.

## Exceptions

Suppress an individual rule only when an integration or contract requires an exception.
Include the specific constraint in the suppression reason.
Biome suppressions use `biome-ignore`; supplemental rules use `eslint-disable-next-line` with a `--` explanation.
Keep suppressions local to the code requiring them.
