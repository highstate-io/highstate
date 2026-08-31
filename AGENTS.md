# Agent Guide

Some simple rules to follow:

- Before engineering tasks, read `dev-docs/engineering/README.md` and the related guides it links.
- Before writing docs, read `packages/platform/docs/content/1.getting-started/2.concepts.mdc` and `packages/platform/docs/content/3.platform/2.units.mdc` as good human-written examples of how to write docs.
- Before editing developer documentation, read `dev-docs/authoring/README.md` and apply its authority and
  maintenance rules to architecture content.
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

Some additional notes:

- Always run development tools directly first. Only if a tool is unavailable, retry it through
  `devenv shell -q -- <command>`.
- Try to use LSP tools to check your code first. Using `bun run build` in most cases will not perform type checking. You can also use `bun run typecheck` where possible. In some cases, LSP tool may provide outdated diagnostics, so you can fall back to `bun run typecheck` if you suspect that.
- Generate documentation thumbnails only with `bun run update-thumbnails -- --filter ... --force` from the docs package.
- Use `bun run test` in desired package to run tests, not LSP tools.
- Unless the user asks for another mode, launch Designer development servers from
  `packages/platform/designer` with `HIGHSTATE_ENCRYPTION_ENABLED=false bun run dev` so local development does not
  depend on an OS secret service.
- If the `orca-cli` skill is visible, use it to organize development terminals and expose services. If it is not
  visible, do not try to load, discover, or install it.
