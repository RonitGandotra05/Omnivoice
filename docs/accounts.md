# Google account sign-in

Customers use **Continue with Google** to create an account or sign in. Manual email/password, Apple and GitHub login are disabled at the API as well as in the UI. The separate operator login remains available only for database-assigned administrators.

## Configure Google

Set these server-side in `frontend/.env.local` and the hosting environment:

| Variable | Purpose |
| :--- | :--- |
| `GOOGLE_CLIENT_ID` | Google OAuth web application client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `NEXTAUTH_SECRET` | Independent random session secret of at least 32 characters. Keep it stable. |
| `NEXTAUTH_URL` | Exact application origin. |
| `PUBLIC_APP_URL` | The same origin, HTTPS in production. |
| `DATABASE_URL` / `NEON_DB_CONNECTION_STRING` | Neon database connection. |
| `JWT_SECRET`, `STUDIO_SESSION_SECRET` | Existing private signing/protection secrets. |

Register `https://YOUR_DOMAIN/api/auth/callback/google` as an authorized Google redirect URI. For local development, register `http://127.0.0.1:3000/api/auth/callback/google` separately. Never expose any secret with `NEXT_PUBLIC_`. An unconfigured provider remains unavailable rather than starting a broken sign-in.

Follow the [Google provider setup](https://next-auth.js.org/providers/google) and [Google token verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Identity and privacy

NextAuth verifies the Google OpenID Connect response with state and PKCE protections. The app requests only `openid email profile`. Account creation takes the name and email from the validated Google profile and keys the identity by Google's immutable subject (`sub`). It stores no Google password, profile photo, access token or refresh token.

The Google email must be verified. Without our own email verification service, the app accepts Gmail addresses or Google Workspace accounts carrying Google's `hd` claim. Google accounts using external mailboxes without that claim are rejected, because Google is not authoritative for their current mailbox ownership.

Existing identity records are reused by subject. A matching email is never automatically merged with a different identity. Legacy password/other-provider accounts and sessions cannot sign in through the disabled methods; their records are preserved for deliberate database migration. This change does not assign administrator roles.

## Demo and security

Only verified, authenticated Google accounts can access demos. The allowance remains up to ten minutes per rolling 24 hours, shared across account, network and browser. Time is reserved at conversation start; repeat agent sessions cannot mint another allowance.

Account settings include display name, appearance, authenticator 2FA and session revocation. Google handles its own password and recovery. Application authenticator 2FA uses a QR code and recovery codes and does not require SMTP. Optional SMTP security notices can be configured separately; email delivery is not needed for Google signup.

See [authentication security](authentication-security.md) for protection limits, encryption and database-only role management. Local tests use disposable Neon schemas and mocked Google/provider responses. Live Google consent requires the configured OAuth application; a successful build does not prove those credentials are registered correctly.
