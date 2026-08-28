# Agent Handbook

Some simple rules to follow:

- Before doing anything, load `contributing/OVERVIEW.md` in your context window.
- Before writing code, load `contributing/CODE_STYLE.md` in your context window and strictly follow the guidelines there.
- Before writing Pulumi units, load `contributing/PULUMI.md` in your context window and strictly follow the guidelines
  there.
- When you work with database entities, read first their schema files in `packages/platform/backend/prisma/`.
- Before writing public docs (not `contributing/`), load `contributing/DOCS_STYLE.md`.
- Before writing docs, read `packages/platform/docs/content/1.getting-started/2.concepts.mdc` and `packages/platform/docs/content/3.platform/2.units.mdc` as good human-written examples of how to write docs.
- If you discovered that something changed after your edits, stick with the new (user-provided) changes and do not revert them.
- If user say that something is not working, assume he did correctly compile/rerun the code and information is up to date.
- Don't use subagents unless explicitly asked to do so.

Some additional notes:

- Try to use LSP tools to check your code first. Using `bun run build` in most cases will not perform type checking. You can also use `bun run typecheck` where possible. In some cases, LSP tool may provide outdated diagnostics, so you can fall back to `bun run typecheck` if you suspect that.
- Generate documentation thumbnails only with `bun run update-thumbnails -- --filter ... --force` from the docs package.
- Use `bun run test` in desired package to run tests, not LSP tools.
- Before reporting completion, rebuild all packages affected by your changes and report any build failures.
  Determine the required packages from the changes and specify them explicitly in the build command; do not use
  `nx affected`.

Database migration requirements:

- Always create migrations through the scripts in `packages/platform/backend`. Generated SQL may be edited afterward
  when required; never create migration directories manually.
- Project: run `bun run migration:reset:project`, then
  `bun run migration:create:project -- --name <migration-name>`.
- Backend SQLite: run `bun run migration:reset:backend`, then
  `bun run migration:create:backend -- --name <migration-name>`.
- Review generated SQL and register the migration in the corresponding `migrationPacks` entry in
  `packages/platform/backend/src/database/migration.ts`.
- Do not create PostgreSQL migrations until a PostgreSQL migration pack is implemented.

Commit requirements:

- Scope commits by functionality and preferably by package when applicable.
- Split unrelated changes into separate commits instead of bundling them into one broad commit.
- Use conventional commits with only these types: `fix`, `feat`, `refactor`, `style`, `docs`, `chore`.
- Use scopes only for npm packages or omit them entirely.
- When used, scopes must be full package names, such as `@highstate/library`.
- Scopes must be lowercase.
- Commit messages must start with a lowercase letter and be in the imperative mood.
- Prefer lowercase words in commit messages, including abbreviations and names that are conventionally acceptable in lowercase, such as `api`, `ci`, `dns`, `bun`, and `vitest`. Use uppercase letters only when required by the specific official name.
- Commit messages must be a single sentence without an extra body.

After you finish your task, verify that your code follow the guidelines
in `contributing/CODE_STYLE.md` and `contributing/DOCS_STYLE.md` rule by rule.
