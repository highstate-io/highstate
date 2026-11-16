# Platform Agent Guide

- Generate entity IDs with CUIDv2 or `cuidv2d`; do not use user-chosen strings. Identify well-known entities
  through `systemName`, following roles and secrets. Exception: singleton tables have one identity field,
  `id`, always equal to `"default"`; do not give them generated IDs or a separate `systemName`.
  Preserve preexisting exceptions: project IDs, component instance IDs, provider resource handles,
  content-addressed hashes, timestamp-ordered ULID logs, and existing fixed CUID defaults.
  Do not introduce new exceptions.
