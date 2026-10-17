# Accounts · Your space, your voice

The account page supports email/password registration and Google, Apple and GitHub OAuth. `/account/settings` manages the display name, appearance, password (for password accounts), verification and sign-out on all devices. No profile photo is requested, stored or shown.

## Configuration

Keep credentials in `frontend/.env.local` for development and your hosting secret manager in production. `.env.example` contains empty placeholders only. Existing private voice/database credentials are unchanged.

| Setting | Purpose |
| :--- | :--- |
| `DATABASE_URL` or `NEON_DB_CONNECTION_STRING` | Neon PostgreSQL with verified TLS. |
| `JWT_SECRET`, `STUDIO_SESSION_SECRET` | Existing independent random secrets, at least 32 characters each. |
| `NEXTAUTH_SECRET` | Independent random secret of at least 32 characters for encrypted OAuth session cookies. |
| `PUBLIC_APP_URL`, `NEXTAUTH_URL` | Same canonical application origin; HTTPS in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Web OAuth application. |
| `GITHUB_ID`, `GITHUB_SECRET` | GitHub OAuth application. |
| `APPLE_ID`, `APPLE_SECRET` | Apple Services ID and signed client-secret JWT. Renew the secret before its expiration. |
| `ACCOUNT_EMAIL_ENABLED=true` | Enables verification and password-reset emails. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Mail transport; authenticated TLS on 587 or implicit TLS on 465. The public app URL must be HTTPS. |

Register exact callback URLs in each provider console:

- Google: `https://YOUR_DOMAIN/api/auth/callback/google`
- GitHub: `https://YOUR_DOMAIN/api/auth/callback/github`
- Apple: `https://YOUR_DOMAIN/api/auth/callback/apple`

Use the deployed domain for Apple. Apple requires an HTTPS non-localhost domain, service configuration in the Apple Developer account, and a signed client secret. Configure its private email relay to accept your sender if you need to email relay addresses. Google/GitHub permit separately configured local development callbacks. Unconfigured providers appear as unavailable rather than launching a broken sign-in.

Follow the official [Google provider setup](https://next-auth.js.org/providers/google), [Apple setup](https://next-auth.js.org/providers/apple) and [GitHub email API](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user). Provider scopes are limited to identity and email. OAuth uses NextAuth's CSRF and callback checks; Google/Apple use PKCE and state, GitHub uses state. Apple's cross-site POST callback requires Secure, HTTP-only, short-lived SameSite=None state/PKCE cookies. Account session cookies retain their stricter defaults.

## Database and identity

The idempotent setup adds columns to `ov_demo_accounts` and creates `ov_account_identities` and `ov_account_tokens`. It runs before account operations; no embedded database or Python is involved. Existing password accounts remain supported and start unverified until they confirm ownership. Before rollout, back up the database and verify permissions to apply additive schema changes.

Emails are trimmed/lowercased with a database unique index. Plus-addresses, aliases and Apple's private relay addresses can represent different email identities; one-email uniqueness cannot establish one-person uniqueness. Shared network/browser quotas limit repeated free-trial spending.

Google/Apple must return a verified email claim. GitHub must return a primary **verified** address from its authenticated email API. Provider identities are keyed by provider and immutable subject. Existing email accounts cannot be silently linked to another provider: use the original sign-in method. This prevents pre-registration/account-linking attacks. There is no provider linking UI in this release.

Manual passwords use bcrypt with cost 12 and a 12-character minimum / 72-byte maximum. Single-use verification and recovery links expire after 30 minutes; only SHA-256 hashes are stored. Tokens travel in URL fragments and are submitted by an explicit same-origin POST. Reset, password change and sign-out-all invalidate previous session versions. Every authenticated request checks active account status and the current database version. Provider access/refresh tokens and profile photos are not retained.

Without mail credentials, email/password accounts can still register/sign in and use the guest-sized demo; **they cannot unlock 10 minutes until verified**. Configured verified social accounts unlock that allowance immediately. Verification/recovery failures never bypass verification.

## Voice allowance

- Guests and unverified accounts: 60 seconds per rolling 24 hours.
- Verified accounts: 600 seconds per rolling 24 hours, shared with the network and browser.
- Prior guest reservations reduce the remaining verified allowance (60 seconds used → 540 seconds remaining).
- A conversation reserves all remaining time before provider credentials are issued. Hanging up early or an ambiguous connection failure does not refund it.
- PostgreSQL serializes reservations. Changing browsers, networks, accounts or concurrent requests cannot reset a matching account/network/browser budget. Network changes and browser clearing combined with a genuinely different identity cannot be fully prevented; the site-wide daily cap also remains in place.
- The provider receives the reserved maximum duration; the UI also displays and stops its timer. Provider agent concurrency stays at one. Each published agent permits one daily start to prevent signed-URL replay. After upgrading a used guest demo, publish the agent again before starting the remaining account demo; reuse is rejected before reserving more time. The database is authoritative for the total seconds.

Registration, sign-in, recovery and account mutations have shared server-side rate limits. No browser-supplied role, email verification, allowance or target-account ID is accepted. Name and appearance updates are scoped to the authenticated account; email changes are intentionally absent.

Appearance previews immediately, persists on the device, and saves to the signed-in account when requested. System mode follows the device preference. Sign-out does not delete local company documents. Identity metadata resides in PostgreSQL and is protected by TLS, database access controls and the hosting provider's encryption at rest; it is not end-to-end encrypted.

## Verification boundary

Local tests use isolated disposable PostgreSQL schemas, concurrent reservations and mocked provider identity responses. Provider console registration, live Google/Apple/GitHub consent/return and SMTP delivery still require actual provider/mail credentials. Neither a successful build nor callback unit tests prove those external integrations are configured.
