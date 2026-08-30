# Authoring Developer Documentation

The developer documentation preserves current knowledge shared across the Highstate workspace.
Git retains its history.

## What Belongs Here

Add content only when it:

- Applies across packages or subsystems, or has no clearer source-owned location
- Preserves a constraint that is not explained by one source-owned location
- Preserves a current constraint or repeatable procedure whose omission creates a plausible risk
- Can be maintained when the documented behavior changes

Keep package-specific setup, commands, and contribution instructions with that package.
Keep public product documentation with the documentation application.

Do not add decision logs, plans, meeting records, retrospectives, task summaries, generated references,
generic advice, or prose that restates source code.
Use issues, pull requests, and Git history for discussions and superseded decisions.

Architecture content may synthesize a constraint spread across packages or subsystems.
Explain the boundary and its consequences, then identify the source that owns its exact behavior.
Do not restate a local implementation that readers can understand from one source file.

Each fact has exactly one owning developer document.
Other documents may link to that owner and identify the topic of the link, but they do not restate, summarize,
or independently maintain the fact.
When related facts belong in different documents, keep each fact with the document whose scope it directly
serves and connect the documents with links.

## Authority

Code, configuration, schemas, package metadata, and executable tests own exact behavior.
Public product documentation owns user-facing terminology, supported workflows, and compatibility promises.
The developer documentation owns durable system boundaries, dependency direction, and compatibility
constraints.
Package instructions own package-specific development procedures.

Generated files are not primary authority when their generator inputs exist.
Future designs and unsupported implementations do not belong in current architecture documentation.
When authorities disagree, verify the implementation, determine whether the behavior or documentation is
wrong, and update every affected source in the same change.

## Organization

Use these top-level sections:

- `architecture/` for current system-wide boundaries, dependency direction, and compatibility rules
- `engineering/` for development practices shared across the Highstate workspace
- `authoring/` for rules governing this documentation

Do not create empty, miscellaneous, or `meta` sections.
Use a section `README.md` for orientation and links; keep the root `README.md` limited to this documentation's
purpose, primary audience guides, and this authoring guide.
Make every page reachable by following links from the root `README.md`, normally through its section
`README.md`.

Organize architecture documents around boundaries and lifecycles rather than source directories or classes.
Do not maintain package graphs, service catalogues, RPC tables, schema fields, version numbers, or copies of
test cases in architecture documents.

## File Names

Use lowercase kebab-case for ordinary Markdown files, such as `repository-boundaries.md`.
Keep conventional or tool-defined entry points uppercase, including `README.md`, `AGENTS.md`, and
`SKILL.md`.
Do not number files unless order is meaningful; use noun phrases for architecture documents.

## Writing

All documents are human-oriented by default, without an explicit audience declaration.
Human-facing documents are descriptive by default.
They explain behavior, boundaries, and consequences without directing the reader.
A human-facing document may use direct instructions only when providing those instructions is its explicit
purpose, as in a style guide, setup guide, or operational procedure.

Human procedures assume that readers understand and accept responsibility for the commands they choose to
run.
They describe prerequisites, effects, costs, security properties, and recovery behavior as facts, then provide
the commands required to complete the procedure.
They do not add consent gates, credential-policing reminders, defensive cleanup checks, or similar safeguards
whose purpose is to constrain an automated actor.
Requirements enforced by the tool or necessary for the procedure to work remain part of the human procedure.

When a document contains new, non-repetitive directions useful for AI enforcement, place them in a final
`## For AI Agents` section.
That section is directive and may use terms such as "do," "do not," and "must."
Agent-only safeguards include approval before billable or destructive actions, restrictions on commands that
may expose credentials, rules for handling secrets, and verification that automated cleanup succeeded.
Do not repeat human-facing content merely to produce agent instructions.

Pure AI documents are limited to `AGENTS.md` files and installable skills.

Write direct, authoritative technical prose:

- Describe the current system, not the process of writing the document.
- Explain non-obvious constraints and their practical consequences.
- Use the shortest natural wording that preserves necessary context and meaning.
- Remove filler, repetition, obvious conclusions, and detail readers can infer from source or commands.
- Keep paragraphs short and connected; do not turn explanations into disconnected lists of facts.
- Prefer specific examples over generic recommendations.
- Address the reader directly when giving instructions.
- Use active voice and present tense for current behavior.
- Avoid marketing language, filler, and commentary about AI assistance.
- Put one sentence on each line and keep lines under 120 characters where practical.

Write non-authoring sections for their users, not documentation maintainers.
Keep section scope, placement, organization, and writing instructions in `authoring/`.
Keep pure agent instructions in `AGENTS.md` files or installable skills.

Use headings to make documents searchable, but do not split a short explanation into many shallow
sections.
Use lists for genuinely parallel items rather than converting all prose into bullets.
Use Mermaid for diagrams and graphs.
Use text code blocks only for literal text, commands, configuration, or directory layouts.

## Checks

Enter `devenv shell`, then run `bunx --bun nx run dev-docs:check` and
`bunx --bun nx run dev-docs:links`.
Use `bunx --bun nx run dev-docs:format` to format Markdown.

## Maintenance

Update or remove affected content when its constraint or workflow changes.
Replace stale text instead of appending corrections.

Before finishing a change:

- Confirm that the content belongs in the developer documentation rather than with one package or source file.
- Confirm that every fact is stated only in its owning document and replace duplicates with links.
- Remove obsolete statements.
- Compare architecture claims with current source and executable tests, not only existing prose.
- Check whether changed constraints affect public compatibility promises.
- Link to generator inputs or stable source entry points instead of generated output.
- Run the configured checks and verify links.
- Read the result as standalone documentation without relying on task or conversation context.
