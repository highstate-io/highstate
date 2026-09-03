# Compatibility

Highstate compatibility spans package releases, runtime versions, wire contracts, extension artifacts, and
persistent state.
A dependency resolver accepting two versions does not prove that their runtime protocols are compatible.

## Release Groups

Platform packages form one fixed release group and standard-library packages form another.
Packages within a group move together, while changes across groups require explicit compatibility review.
`nx.json` owns release group membership and package manifests own exact versions.
Release automation derives public package membership from Nx project metadata and publishes each versioned group
on its anchor package: `@highstate/contract` for the platform and `@highstate/library` for the standard library.
The CLI resolves groups from those npm manifests rather than embedding repository package lists, so an installed
CLI can update to groups introduced by newer releases.

Current version numbers remain in package metadata and the lockfile rather than developer documentation.

## Runtime Alignment

Bun is used for package builds, control-plane execution, worker images, and Pulumi programs.
Pulumi Automation API in the backend and Pulumi SDKs in unit packages also share a runtime protocol.
Bun and Pulumi upgrades are therefore system-wide changes, not isolated dependency refreshes.

The root package manager declaration, lockfile, package manifests, CI setup, and Docker build definitions own exact
pins.
Nx produces cacheable worker bundles, while Bake assembles and publishes their multi-platform runtime images.
Extension packages align with the supported toolchain used to produce and execute their artifacts.

## Contract Compatibility

Protobuf source and Buf configuration govern remote API compatibility.
Versioned API namespaces preserve explicit wire boundaries.
[Contracts and Extensions](contracts-and-extensions.md#contract-surfaces) identifies the source authority for
generated declarations.

Component and entity type names include a numbered variant such as `namespace.type.v1`.
A new incompatible public shape requires a new variant rather than silently changing the meaning of an
existing one.
The domain contract owns exact naming and schema validation.

## Extension Compatibility

The [library artifact protocol](contracts-and-extensions.md#library-artifact-protocol), source hashes, and runtime
alignment form separate parts of extension compatibility.
Component definition and unit implementation hashes influence deployment change detection.
Manual source-hash versions are behavioral controls: changing one can force deployment, while failing to
change one can suppress an intended update.

The source-hash calculator and operation hash resolver own exact hash behavior.

## Persistence Compatibility

Persistence upgrades move forward through registered migrations.
Current public policy does not promise downgrade migrations, so opening state with a newer version can make it
unusable by an older release.
Backups and upgrade procedures remain public operational documentation rather than architecture content.

A persistence compatibility change covers migration code, the public compatibility promise, and this
constraint together.
