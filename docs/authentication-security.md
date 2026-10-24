# Authentication security

**Current customer policy: Google-only sign-in.** Manual customer signup/login/reset APIs return 410, old provider/password sessions are rejected, and legacy email pages redirect to Google sign-in. Google supplies the name, stable account ID and verified Gmail/Workspace email. SMTP is not required for customer signup or authenticator 2FA. Password/email-link implementation notes below describe retained inactive customer code and the separate operator/security-notice facilities; see [current account setup](accounts.md).

The protections here execute in Node route handlers and PostgreSQL, independently of JavaScript, disabled buttons, cookies used for UI preferences, or the request client. Postman, curl and automated tools must satisfy the same checks. A forged `Origin` header does not remove authentication or throttling requirements.

## Attempt limits and cooldowns

| Control | Enforced policy |
| :--- | :--- |
| Account and account/network pair | Five attempts within 15 minutes; a successful complete sign-in clears these counters. |
| Escalating lockout | 15 minutes, then 30, then a maximum of 60 minutes on repeated lockouts. Levels decay after 24 hours without attempts. |
| Shared source network | 30 attempts per 15 minutes, including attempts across different accounts. Successful individual logins do not clear the network budget. |
| Shared site ingress | 120 authentication attempts per minute, protecting expensive password checks. |
| MFA verification | Five attempts per challenge plus durable account/network limits across replacement challenges. |
| Challenge lifetime | Ten minutes, network-bound, HTTP-only cookie, single successful use. |
| Account mail | Three sends per address per hour, ten per day, 200 site-wide per day. Verification/reset links also have a two-minute resend gap. |
| Audit retention | Up to thirty days and approximately 10,000 recent events, pruned once per minute during authentication traffic; identifiers are HMAC digests, never passwords, OTPs, email-link tokens or recovery codes. |

Attempts reserve a counter slot before password checking, preventing concurrent requests from racing past the threshold. Consequently, several simultaneous legitimate attempts may consume the budget conservatively. The fifth request can still succeed; additional requests wait. Blocked requests do not extend an existing account lockout indefinitely. Checks apply to nonexistent accounts too, using the same generic invalid-credentials response and expensive password comparison.

Network identity uses only Netlify's platform-written IP header on Netlify. It ignores arbitrary `X-Forwarded-For`; IPv6 privacy addresses share a /64. Missing trustworthy identity in production fails closed. Counter/lockout state lives in PostgreSQL across function instances, browser resets and IP rotation. Correctly completed recovery can clear an account lockout, but not a shared network cooldown.

An attacker can deliberately trigger temporary account/network lockouts. Finite cooldowns and the independent recovery path reduce this denial-of-service tradeoff; they do not eliminate it. Provider WAF/traffic controls are still appropriate for volumetric attacks before requests reach serverless functions. No claim of immunity to every attack or independent penetration-test certification is made.

## Email and password handling

- Email validation checks the local part, domain labels and international domain normalization. New registration requires a working, non-null MX record; reserved/internal test domains are rejected. DNS outages produce a temporary failure rather than inventing mailbox validity.
- Mailbox ownership is proved by an expiring verification link. New manual registration never issues an authenticated session. Existing/new registrations return the same accepted response; email verification precedes password sign-in. The mailbox owner sets the final password at confirmation, replacing any unverified password; verification links cannot change an already verified account. Resend and recovery responses remain generic.
- A random-looking local part may be a perfectly legitimate address. The app does not guess whether an address is human from spelling, block all private-relay addresses, or claim that MX proves a mailbox exists. Ownership verification is the deciding check.
- New passwords require 15–128 Unicode code points, NFC normalization, a 512-byte ceiling, and rejection of a small local set of common/repeated values. Paste, password managers, spaces and Unicode are supported. There are no arbitrary character-class or periodic-rotation requirements. A large breached-password screening service is not configured.
- New hashes use Node's scrypt with a random 16-byte salt, N=32768, r=8, p=3, and a 64-byte derived key. Existing bcrypt passwords continue to verify with their original 72-byte bound; they are not silently truncated or changed. Password changes and resets adopt scrypt.
- Password changes require the current password and, when enabled, a fresh authenticator/recovery code. Password recovery requires its email token and the enrolled second factor; it never disables MFA. Successful changes revoke prior sessions.

## Authenticator-based two-factor authentication

Customer accounts can enable MFA in `/account/settings`; operators use `/admin/security`. Production operator workspace access requires MFA by default. An unenrolled operator can authenticate only into the enrollment flow; the signed bootstrap token cannot access administrator data. `OPERATOR_MFA_REQUIRED=true` also enforces this policy in development.

Enrollment requires a verified email plus current password, or a fresh authenticated social sign-in for passwordless accounts. Setup generates a local QR image and manual key; no QR service receives the secret. A six-digit authenticator code must be confirmed within ten minutes before activation. Enabling, disabling or replacing recovery codes revokes other sessions/challenges. Production operators who disable MFA return to enrollment-only access until setup completes again.

TOTP uses OTPAuth's RFC 6238 implementation, SHA-1, six digits and 30-second periods, with at most one adjacent step for clock skew. Accepted steps are persisted; replaying an accepted code fails, even through another concurrent request. This is not phishing-resistant authentication; passkeys/hardware security keys are a future enhancement.

Authenticator seeds are encrypted with AES-256-GCM and principal-bound authenticated data. Recovery consists of ten independent random 80-bit codes, shown once; only principal-bound hashes are stored. Each recovery code is consumed atomically. Disabling MFA or replacing codes requires the current factors rather than a settings toggle alone.

A password-only request never receives a full session when MFA is enabled. Social sign-in also pauses for the enrolled local factor. Signed sessions carry the verified factor/version; every server request checks current account/MFA state. Enrollment, recovery-code rotation, disablement, password changes and sign-out-all invalidate applicable older sessions. Recovery codes are not returned by session/status endpoints.

## SMTP and key configuration

Keep all values server-side in `.env.local` or hosting environment secrets. Do not use a `NEXT_PUBLIC_` prefix.

- Existing `DATABASE_URL`/`NEON_DB_CONNECTION_STRING`, `JWT_SECRET` and `STUDIO_SESSION_SECRET` remain necessary.
- `ACCOUNT_EMAIL_ENABLED=true` and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` enable account verification, recovery and security notices. HTTPS `PUBLIC_APP_URL` is required. SMTP uses verified STARTTLS on 587 or implicit TLS on 465 and disables remote/file content loading.
- Configure `AUTH_MFA_KEY` as a dedicated random 32-byte base64 value before enrolling production users, and back it up securely. Without it, a purpose-separated HKDF key is derived from `JWT_SECRET`. Rotating that fallback secret without migrating encrypted seeds makes them unreadable. Keeping the old encryption key available for a deliberate migration is necessary; no automatic key rotation is claimed.
- Do not disable the operator MFA policy as a substitute for enrollment. Existing operator users can still reach the security setup page using the supported enrollment sign-in flow.
- Security notices cover password changes/resets, MFA activation/deactivation, recovery-code replacement and recovery sign-in. Mail failures do not undo a completed security change; these notices are best effort, not a durable delivery/bounce queue. Verification/recovery never claims that SMTP acceptance proves inbox delivery.

The idempotent setup creates `ov_auth_guards`, `ov_auth_mfa`, `ov_auth_challenges`, `ov_auth_events`, `ov_auth_mail_budget` and `ov_auth_maintenance`. Secrets are not stored in those records in plaintext. Back up the database before rollout and permit the additive schema setup. Raw email identity remains in the account table so the service can authenticate/contact the user; this is not end-to-end encryption.

## Reference guidance and verification

The policy follows [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) for throttling, generic errors and lockout tradeoffs, and [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) for factor lifecycle and recovery. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) motivates the password minimum and the choice of an authenticator rather than treating email alone as a strong second factor. This implementation does not claim NIST assurance-level certification. TOTP uses [OTPAuth](https://github.com/hectorm/otpauth). The scrypt settings match an [OWASP password-storage configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Local verification uses isolated disposable Neon schemas, mocked SMTP/provider responses, real scrypt/bcrypt/TOTP algorithms and direct Fetch requests with attacker-style headers. It covers parallel attempts, rotating IPs, escalating cooldowns, unverified registration, duplicate responses, expired/replayed challenges, factor replay, recovery-code reuse, privileged bootstrap restrictions, OAuth checks, factor-required password reset, session revocation and tenant-bound seed encryption. Live OAuth consent, actual mailbox delivery, phishing resistance and external network/WAF behavior still require controlled integration tests with the configured services.

## Database-managed administrator access

The active product administrator is the existing verified Google account `ronitgandotra@gmail.com` in `ov_demo_accounts`. Its `is_admin` column defaults to false. A database check constraint restricts administrator status to that active, verified email, and a partial unique index permits at most one administrator. `cd frontend && npm run setup:admin` applies the additive schema and assigns the existing account transactionally; it fails instead of creating an account if the expected identity is absent. The script can use `.env.local` or server environment variables. Apply it against each deployment's database before deploying the new dashboard.

The homepage navigation derives its Admin link from the server account response. `/admin/dashboard` independently verifies the current signed Google/MFA session in its server component. `/api/admin/overview` and `/api/admin/accounts` each verify the current database account, session version, MFA state, verified email and administrator flag before accessing data. Browser roles and local storage are not authorization sources. Mutations require a same-origin request, bounded validated JSON and a shared database rate limit. Account controls cannot alter roles or modify the administrator; suspension, restoration and revocation invalidate existing sessions and challenges. Successful changes and their audit records commit together.

The old operator adapter remains for retained integrations and legacy screens. It also requires the canonical administrator email from its database row, alongside active status, administrator status, token version and configured MFA enforcement. The current production-shaped database inspected on 24 October 2026 has no legacy `users` table; use Google sign-in and the new dashboard for the active product.

Public account APIs reject role and permission mass assignment, including nested values and alternate casing. New accounts never receive administrator access automatically. Database credentials and signing keys stay server-side. An owner-level PostgreSQL credential can change database policy directly; use a separate migration credential and least-privilege runtime role in a production deployment.

## Demo account requirement

The studio requires an authenticated, verified customer account. Anonymous visitors can read the guide/tutorial but cannot use text previews, publish voice resources, or obtain live voice credentials. Route handlers enforce this even when development demo quotas are disabled. Anonymous/unverified allowance is zero; reservations and non-registration publication operations reject missing/unverified accounts. Verified accounts retain the existing ten-minute rolling daily allowance. Native signed webhooks and authenticated telephone tools keep their separate service authorization.

Authenticator TOTP enrollment and verification do not require SMTP or an external OTP delivery service. SMTP is used separately for manual account email ownership/reset links and best-effort notices. Configured verified OAuth sign-in can establish mailbox ownership without application-sent signup email. Passkeys are a possible future WebAuthn implementation, not currently enabled.
