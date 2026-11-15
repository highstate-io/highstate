# Agent Guide

Some simple rules to follow:

- Before engineering tasks, read `dev-docs/engineering/README.md` and the related guides it links.
- Follow the permission-aware interface requirements in `dev-docs/engineering/designer-development.md` for every Designer access rejection.
- Use source code and executable tests as the authority for implemented behavior.
- Use `packages/platform/docs` as the authority for public terminology, supported workflows, and user-facing
  compatibility promises.
- Use `dev-docs/architecture/` for system boundaries and compatibility
  constraints, but not for exact APIs, schemas, configuration, or package dependencies.
- Before changing a documented system boundary, read the relevant architecture guide and update it in the same
  change.
- When source, public docs, and architecture guidance disagree, verify the implementation and update every
  stale or incorrect authority in the same change.
- If user say that something is not working, assume he did correctly compile/rerun the code and information is up to date.
- Don't use subagents unless explicitly asked to do so.
- Do not preserve backward compatibility with intermediate designs introduced within the same pull request.
  Remove superseded schemas, fallbacks, and migration paths; retain compatibility only for behavior that
  existed before the pull request, unless the user explicitly requests otherwise.
- Do not embed executable helper programs in strings or launch them with `eval`, `-e`, or equivalent flags.
  Put subprocess and worker logic in dedicated source files so it is formatted, type-checked, and testable.
  Pass runtime data through structured messages or standard input, never generated source code.
- Keep root `AGENTS.md` workspace-wide. Put area-specific guidance in `AGENTS.md` files within the owning
  directories, and consolidate related rules instead of accumulating one-off instructions.
- After creating or updating a pull request, monitor its checks until all required checks succeed. Fix and push
  failures, then continue monitoring the new checks.
- After pushing changes to a pull request, run local smoke tests in parallel with GitHub CI monitoring.

Some additional notes:

- Always run development tools directly first. Only if a tool is unavailable, retry it through
  `devenv shell -q -- <command>`.
- Try to use LSP tools to check your code first. Using `bun run build` in most cases will not perform type checking. You can also use `bun run typecheck` where possible. In some cases, LSP tool may provide outdated diagnostics, so you can fall back to `bun run typecheck` if you suspect that.
- Use `bun run test` in desired package to run tests, not LSP tools.
