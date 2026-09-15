# Changesets

Changeset files are the unreleased notes used to calculate package versions and build package changelogs.

Run `bun run changeset` and commit the generated Markdown file with a pull request that changes a published
package.
The release workflow consumes these files when it versions the affected release groups.
