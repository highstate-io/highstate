---
"@highstate/api": minor
"@highstate/backend-api": minor
"@highstate/cli": minor
"@highstate/backend": minor
---

Add authorized secret metadata listing, explicit value retrieval, and instance-secret reads and updates through the API and CLI. Secret updates accept JSON or YAML files and stdin without echoing values.

Use the default page size when a collection request specifies zero, including omitted protobuf page sizes.

Replace individual unit-owned secrets by stable ID through UpdateSecretContent and secret update, retaining component-owned metadata and invalidating unit inputs without echoing values.
