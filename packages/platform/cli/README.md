# Highstate CLI

## Secrets

Secret commands use the selected backend context and project (`--project <project-id>`).
The project must be unlocked and the API key must grant the requested secret permissions.

```sh
highstate secret list --state-id <state-id> --output json
highstate secret get <secret-id> --output json
highstate secret get <secret-id> --reveal --output json
highstate secret update <secret-id> --file value.yaml
highstate instance secrets get <state-id> --output json
highstate instance secrets update <state-id> --file secrets.yaml
highstate instance secrets update <state-id> --file -
```

`secret list` and `secret get` return metadata without secret values.
Listing supports `--search`, `--service-account-id`, `--page-size`, and `--page-token`.
Use the returned `next_page_token` to retrieve another page.
`--reveal` and `instance secrets get` print sensitive values to stdout.
Metadata and value access are authorized independently.

Updates read a JSON or YAML object keyed by the unit component's declared secret names.
`--file -` reads stdin, avoiding secret values in command arguments or shell history.
Supplied names replace their stored values; omitted names are preserved.
Updates invalidate the unit's input hash but do not launch a deployment or echo secret values.

`secret update` replaces a single existing unit-owned secret by its stable ID.
Its input document is the value itself, which can be any JSON value, including `null`.
System-managed and service-account-only secrets are not editable through this command.
