# Pulumi Style Guide

This guide captures Highstate's naming convention for Pulumi resources.
It complements the TypeScript rules in `contributing/CODE_STYLE.md`.

## Resource Names

Use the parent component or unit name as the Pulumi resource name by default.
Do not add suffixes that repeat the Pulumi resource type, such as `-role`, `-policy`, `-secret-id`, `-cert`,
or `-mount`.

Different Pulumi types under the same parent may use the same resource name.
Pulumi URNs include the resource type, so type suffixes are not needed to make the resource unique.

Add a suffix only when sibling resources have the same Pulumi type and need different names.
Use the shortest domain-specific differentiator that explains the instance.

**GOOD:**

```typescript
return new pkisecret.SecretBackendRootCert(
  name,
  {
    backend: mount.path,
    type: "internal",
    commonName: args.commonName,
  },
  { parent: this },
)

const policy = new Policy(
  name,
  {
    connection: args.connection,
    policy: policyDocument,
  },
  { parent: this },
)

this.mount = new PkiMount(
  name,
  {
    connection: args.connection,
    path: args.path,
  },
  { parent: this },
)

this.intermediateMount = new PkiMount(
  `${name}-intermediate`,
  {
    connection: args.connection,
    path: args.intermediatePath,
  },
  { parent: this },
)
```

**BAD:**

```typescript
return new pkisecret.SecretBackendRootCert(
  `${name}-root-cert`,
  {
    backend: mount.path,
    type: "internal",
    commonName: args.commonName,
  },
  { parent: this },
)

const policy = new Policy(
  `${name}-policy`,
  {
    connection: args.connection,
    policy: policyDocument,
  },
  { parent: this },
)

this.mount = new PkiMount(
  `${name}-root-mount`,
  {
    connection: args.connection,
    path: args.path,
  },
  { parent: this },
)

this.intermediateMount = new PkiMount(
  `${name}-intermediate-mount`,
  {
    connection: args.connection,
    path: args.intermediatePath,
  },
  { parent: this },
)
```
