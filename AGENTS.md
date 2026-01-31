# Agent Handbook

Hi, silly LLM agent!
This document is here to make you generate code that humans will like a little bit more than completely hate it.

Some simple rules to follow:

- Before doing anything, load `contributing/OVERVIEW.md` in your context window.
- Before writing code, load `contributing/CODE_STYLE.md` in your context window and strictly follow the guidelines there.
- When you work with database entities, read first their schema files in `packages/platform/backend/prisma/`.
- Before writing public docs (not `contributing/`), load `contributing/DOCS_STYLE.md`.
- Before writing docs, read `packages/platform/docs/content/1.getting-started/2.concepts.mdc` and `packages/platform/docs/content/2.fundamentals/2.units.mdc` as good human-written examples of how to write docs.
- Do not make up anything. If you don't know, say "I don't know".
- Do not write anything that is not asked for
- When given a task, first research related files in the codebase and then propose a plan of action.
- Do not action until the user confirms you initial plan unless explicitly asked to do immediately.
- If you discovered that something changed after your edits, stick with the new (user-provided) changes and do not revert them.

Some additional notes:

- Try to use LSP tools to check your code first. Using `pnpm build` in most cases will not perform type checking. You can also use `pnpm typecheck` where possible. In some cases, LSP tool may provide outdated diagnostics, so you can fall back to `pnpm typecheck` if you suspect that.
- Never call `pnpm build` on Nuxt projects, it is very slow.

After you finish your task, verify that your code follow the guidelines
in `contributing/CODE_STYLE.md` and `contributing/DOCS_STYLE.md` rule by rule.
