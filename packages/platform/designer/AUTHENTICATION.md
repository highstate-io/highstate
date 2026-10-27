# Hosted Designer authentication

Designer defaults to local authentication using the operating-system user.
Hosted mode uses OAuth/OIDC login, PostgreSQL-backed opaque sessions, and human role grants.
It requires HTTPS and never falls back to local authentication when a session or provider fails.

## Configuration

| Environment variable | Value |
| --- | --- |
| `HIGHSTATE_AUTH_MODE` | `local` (default) or `hosted` |
| `HIGHSTATE_PUBLIC_URL` | Required hosted HTTPS origin, for example `https://designer.example.com` |
| `HIGHSTATE_AUTH_PROVIDERS` | JSON array of `LoginProviderConfig` objects |
| `HIGHSTATE_AUTH_PROVIDERS_FILE` | File containing that JSON array; mutually exclusive with `HIGHSTATE_AUTH_PROVIDERS` |
| `HIGHSTATE_AUTH_ADMIN_USER_IDS` | JSON array of deterministic Highstate user IDs; default `[]` |
| `HIGHSTATE_AUTH_ADMIN_GROUP_IDS` | JSON array of deterministic Highstate group IDs; default `[]` |
| `HIGHSTATE_AUTH_SESSION_LIFETIME_SECONDS` | Integer from 60 through 604800; default 28800 |
| `HIGHSTATE_BACKEND_DATABASE_TYPE` | Must be `postgresql` in hosted mode |

The backend database adapter owns PostgreSQL connection configuration.
See [`../backend/src/database/POSTGRESQL.md`](../backend/src/database/POSTGRESQL.md).

The provider schema is exported by `@highstate/contract` as `loginProviderConfigSchema` and `LoginProviderConfig`.
Designer validates configuration at startup and requires at least one provider with a unique ID.
Provider endpoints must use HTTPS.
The public configuration endpoint exposes only provider IDs and titles.

```typescript
type LoginProviderConfig = {
  id: string
  title: string
  clientId: string
  clientSecret?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  clientAuthMethod: "client_secret_basic" | "client_secret_post" | "none"
  scopes: string[]
  identity:
    | { protocol: "oidc"; issuer: string; groups?: string }
    | {
        protocol: "oauth2"
        authority: string
        userInfoUrl: string
        mapping: {
          subject: string
          name?: string
          username?: string
          email?: string
          avatar?: string
          groups?: string
        }
      }
}
```

`clientAuthMethod` defaults to `client_secret_basic`; `scopes` defaults to `[]`.
Secret-based authentication requires `clientSecret`.
OIDC discovers metadata from `issuer`; its authorization and token endpoints can be overridden explicitly.
OAuth2 requires explicit authorization and token endpoints and fetches the authenticated profile from `userInfoUrl`.
Register `${HIGHSTATE_PUBLIC_URL}/api/auth/callback` as the provider's redirect URI, without a double slash.
OIDC automatically includes the `openid` scope.

Mappings are dot-separated own-property paths, such as `profile.id` or `groups`.
Prototype traversal and executable expressions are rejected.
OAuth subjects accept nonempty strings or finite numbers converted to strings.
Other profile fields must be strings; group claims must be simple arrays of nonempty strings.
OIDC takes identity and display claims from the verified ID token, with optional mapped groups.
Email and username never establish identity or administrator status.

## Roles and administrator initialization

Compute explicit user and group IDs with the backend exports:

- `getOidcUserId(issuer, subject)` and `getOidcUserGroupId(issuer, group)`
- `getOAuthUserId(authority, subject)` and `getOAuthUserGroupId(authority, group)`

OIDC identity derivation remains compatible with existing users.
OAuth identities use a separate protocol namespace and the configured stable authority.
Changing an authority changes the resulting identities.

Configured administrator IDs receive the existing administrator role in the backend realm at every startup.
Project authorization initialization reapplies those grants before resolving hosted project permissions.
Deleting a configured administrator binding is temporary: the next initialization restores it.
To revoke a configured grant permanently, remove its ID from deployment configuration, restart Designer,
and delete the existing binding in each affected realm.
Removing an ID from configuration does not delete persisted bindings automatically.
There is no first-login administrator rule.

Other users receive only roles explicitly bound to their user ID or asserted group IDs in the applicable realm.
Designer provides `backendRoleSettings.setHumanBinding` and `projectRoleSettings.setHumanBinding` tRPC mutations:
`{ roleId, subject: { type: "user" | "group", id }, granted }`, with `projectId` for the project mutation.
These require permission to update the role and, when granting permissions beyond the caller's own, escalation permission.
Subjects must already be known to the backend; project binding copies their display records into the project.
Existing role editing and service-account/API-key authorization retain their own contracts.

Raw collection and event paths require an unrestricted grant for the relevant permission because their payloads
are not resource-filtered.
Context-aware business services continue to enforce their resource restrictions.

## Browser and panel access

`/login` lists configured providers and has a POST sign-out form.
The Designer Account link opens this page.
Login uses authorization code flow, S256 PKCE, browser-bound one-use state, and an OIDC nonce.
The maintained `openid-client` library validates responses, issuer, audience, timestamps, and ID-token signatures.

Sessions use host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookies.
The database stores token hashes rather than browser credentials.
Logout durably revokes the session; idle terminal, event, and panel WebSockets check revocation every five seconds.
Streaming subscriptions also revalidate credentials while idle and before emitting data.
Provider group membership is captured at login; a subsequent login updates all active sessions for that user.
Provider-side membership changes are otherwise observed only after session expiration and a new login.
Highstate role bindings are resolved on requests and stream authorization checks.
Unsafe Designer requests and WebSocket upgrades require the configured public Origin.

Panel hosts use `<panel-id>.panels.<public-hostname>`.
Route wildcard DNS and TLS for those hosts to Designer, including nested hosts when a panel requires them.
Panel launch tickets are one-use, expire after 30 seconds, and carry the issuing session's authorization.
Every panel proxy request checks the underlying human session and project panel permission.
Hosted panels require their own panel cookie; origin-based active-session fallback is disabled.

## Database deployment

Apply backend migrations for `DesignerSession` and `DesignerLoginTransaction`,
and the backend `UserType.oauth` value before starting hosted Designer.
The project client must support `UserType.oauth`; SQLite stores user types as text and needs no schema migration for it.
Regenerate both backend clients and the project client after schema changes.
Keep authorization-code transaction records private: they contain short-lived PKCE verifiers.
