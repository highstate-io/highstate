# @highstate/sops

A Highstate package that implements SOPS (Secrets OPerationS) encryption for secrets management, using SSH host keys from servers as age recipients.

## Overview

This package provides a `secrets` unit that encrypts sensitive data using SOPS with age encryption. It automatically derives age recipients from the SSH host keys of the provided servers, allowing for secure secrets distribution across your infrastructure.

## Features

- **SSH Host Key Integration**: Automatically uses SSH host keys from servers as encryption keys
- **Age Encryption**: Leverages age encryption (modern alternative to PGP) via SOPS
- **SOPS Compatible**: Generates files compatible with standard SOPS tools
- **Embedded File Output**: Produces encrypted content as an embedded file entity

## Usage

```typescript
import { sops } from "@highstate/library"

// Define your servers with SSH host keys
const servers = [
  // Your server instances with SSH configurations
]

// Encrypt secrets using SOPS
const encryptedSecrets = sops.secrets({
  name: "my-secrets",
  secrets: {
    data: {
      databasePassword: "super-secret-password",
      apiKey: "my-api-key-12345",
      certificateData: "-----BEGIN CERTIFICATE-----\n...",
    },
  },
  inputs: {
    servers: servers,
  },
})

// Access the encrypted file
const secretsFile = encryptedSecrets.file
```

## How It Works

1. **SSH Key Extraction**: The unit extracts SSH host keys from the provided servers
2. **Age Conversion**: SSH keys are converted to age recipients format (currently simulated)
3. **SOPS Encryption**: Secrets are encrypted using SOPS with the derived age recipients
4. **File Generation**: An encrypted SOPS file is generated and embedded

## Current Implementation Status

This is a demonstration implementation that:

- ✅ Correctly extracts SSH host keys from servers
- ✅ Generates SOPS-compatible encrypted file structure
- ⚠️ Uses mock encryption (not real SOPS encryption)
- ⚠️ Simulates SSH-to-age key conversion

## Production Deployment

For production use, this implementation would need:

1. **Real SSH-to-Age Conversion**: Integration with tools like [ssh-to-age](https://github.com/Mic92/ssh-to-age)
2. **Actual SOPS Binary**: Installation and usage of the real SOPS binary
3. **Proper Key Management**: Secure handling of converted age keys

Example production command that would be used:

```bash
sops encrypt --age "age1..." secrets.yaml
```

## Dependencies

- `@highstate/pulumi` - For Pulumi integration
- `@highstate/library` - For unit definitions
- `@highstate/common` - For Command execution
- `remeda` - For utility functions

## File Structure

```
packages/sops/
├── package.json
├── src/
│   ├── index.ts          # Package exports
│   └── secrets/
│       └── index.ts      # Main secrets unit implementation
└── README.md            # This file
```

## Configuration

The unit expects servers with SSH configurations:

```typescript
{
  ssh: {
    hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI..."
    // ... other SSH configuration
  }
}
```

Supported SSH key types:

- `ssh-ed25519` (recommended)
- `ssh-rsa` (legacy support)

## Security Considerations

- SSH host keys should be verified and trusted
- In production, proper SOPS encryption ensures secrets are protected
- Age encryption provides forward secrecy and quantum resistance
- Always verify the integrity of encrypted files before deployment

## Related Tools

- [SOPS](https://getsops.io/) - The underlying encryption tool
- [age](https://age-encryption.org/) - Modern encryption tool
- [ssh-to-age](https://github.com/Mic92/ssh-to-age) - SSH to age key converter
