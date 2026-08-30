# Making Changes

This guide defines the procedure for scoping, verifying, committing, and presenting repository changes.

Keep each change coherent, verifiable, and consistent with every source of truth it affects.

## Authority

The handbook's [authority rules](../authoring/README.md#authority) apply throughout this procedure.

Read the relevant architecture guide before changing a documented system boundary.

## Scope

Keep a change focused on one behavior or purpose.
Include the tests, documentation, configuration, and generated artifacts required to leave that behavior
consistent.
Do not mix unrelated cleanup or refactoring into the same change.

Preserve concurrent changes you did not make.
If another change overlaps your work, incorporate the current state rather than restoring an older
version.

## Verification

Use the repository's documented commands and configured tools.
Run type checking, tests, linting, formatting checks, and builds that exercise the changed behavior.
Do not assume a successful build includes type checking.

Determine affected packages explicitly and verify each one before reporting completion.
Prefer focused checks while iterating, then run the repository's required full checks.
Review generated output before committing it.

## Commits

Scope commits by functionality and, when useful, by package.
Split unrelated changes into separate commits.

Use Conventional Commits with one of these types:

- `fix`
- `feat`
- `refactor`
- `style`
- `docs`
- `chore`

Omit the scope or use the full lowercase npm package name, such as `@highstate/library`.
Write the subject in imperative mood, begin it with a lowercase letter, and keep conventional
abbreviations such as `api`, `ci`, and `dns` lowercase.
Use one sentence without a commit body.

## Pull Requests

Write the pull request title in the same lowercase, imperative style as a commit subject.
Include a Conventional Commit prefix when one accurately describes the pull request, such as `feat:` or
`fix(@highstate/library):`.

Write the body as a bulleted summary without headings or other sections.
Use lowercase sentence fragments without terminal punctuation.
Describe the useful behavioral and implementation changes as precisely as possible with as few words as
possible.
Do not blindly repeat commit messages; combine and reframe their details to explain the pull request as a
coherent change.
