# Next.js deployment and storage

The active application runs entirely from `frontend/`. It does not call FastAPI, launch Python, require port 8000, or need a database for local document/text use. Public voice access requires Neon/PostgreSQL for shared abuse protection. The Python implementation remains in `backend/` as a reference/alternative, disconnected from the studio.

## Run locally

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000/try-for-free`. Use this exact origin in `PUBLIC_APP_URL`. `npm ci` prepares PDF/OCR worker assets locally. Node 22 is recommended; no native OCR executable or system Python package is required. Build with `npm run build`, then `npm start -- --hostname 127.0.0.1`.

## Storage and trust boundaries

| Data / operation | Default location |
| --- | --- |
| Company profile, extracted document text, checks, tickets, collected callers, browser transcripts | This browser's IndexedDB |
| Original uploaded files | Read into an isolated browser worker; not uploaded or retained by the app |
| PDF parsing, DOCX extraction, English scanned-PDF OCR | Local JavaScript/WASM workers |
| Session signing and voice API key | Next.js server routes and server environment |
| Approved knowledge after explicit Publish | Extracted text uploaded to the voice platform |
| Voice audio after explicit Start and microphone consent | Browser connects directly to the voice platform |
| Accounts, shared/inbound call history, email outbox | Optional PostgreSQL adapter |

IndexedDB is specific to this browser/origin. It is not shared company storage, an account system, or end-to-end encryption. Other people using the same browser profile can access it. Clearing site data/private-browsing expiry removes local records. Export company knowledge for backup; exports deliberately exclude caller tickets. Existing valid `omnivoice-workspace-v1` localStorage drafts migrate into IndexedDB on first load. Original binary files are not needed after text extraction.

Local human requests create a persisted local queue item, not an email, calendar booking, outbound call or telephone transfer. Browser voice client tools can update local records while that browser is open. When it is closed, those tools cannot service inbound telephone calls. Enable PostgreSQL/native server tools for that scenario. Do not describe local requests as business-team notifications.

## Enable browser voice

Set `ELEVENLABS_API_KEY` in `frontend/.env.local` or Netlify's server-side environment. Never prefix secrets with `NEXT_PUBLIC_`. Optionally set `ELEVENLABS_VOICE_ID`; otherwise agent creation uses provider defaults. Set an independent `STUDIO_SESSION_SECRET` and `JWT_SECRET`, each at least 32 random characters, and a pooled Neon `DATABASE_URL` for public demo limits and accounts. These stay in private server environment settings.

1. Save company settings and import documents locally.
2. Review OCR text and approve it explicitly.
3. Add/run important knowledge checks. Failed checks prevent publishing.
4. Select **Publish knowledge**. Individual extracted texts are sent in bounded requests; indexing is polled before attaching the full set to a new private workspace agent.
5. Keep the tab open until publishing completes. Receipts and progress persist locally; an interrupted publication is explicitly marked failed and retries reuse receipts.
6. Start **Test with voice**. The server creates a signed URL for that browser-owned private agent. The API key never enters browser code.

A signed HttpOnly same-site cookie identifies the browser. Public demo signed URLs include `include_conversation_id=true`, making their conversation signature single-use. Document/agent grants are authenticated, bound to that owner and expire after seven days. Browser A cannot publish Browser B's documents, obtain its signed voice URL, or delete its artifacts. There is no shared mutable global demo agent. Rotating the signing key/API key or losing the owner cookie requires republishing. The provider still receives/retains published text and conversation data according to its privacy settings. Audio recording is disabled in agent configuration; configure transcript retention/disclosures as appropriate.

**Remove published voice copies** deletes that browser's published agents and known attached sources in small bounded requests. Local files/text remain. If cookies/grants are lost/expired or publication loses a response after provider creation, use the provider dashboard to inspect/remove orphaned resources. Do not assume closing the tab deletes provider data. Failed partial preparations are reused, not silently claimed as published.

Public demos reserve one 60-second session per IP/network and signed browser cookie per **rolling 24 hours**. The entire minute is reserved before the provider is contacted; failed, cancelled or unused connections consume it. Limits are enforced using PostgreSQL transactions and an advisory lock across serverless instances. A database failure blocks new paid operations rather than falling back to browser state. The provider agent also enforces duration, one concurrent conversation, one call daily and disabled burst pricing; a visible client countdown is an additional UX safeguard.

On Netlify, only the platform's `x-nf-client-connection-ip` header is accepted; arbitrary `X-Forwarded-For` is ignored. IPv6 addresses are grouped by /64 to limit privacy-address rotation. IP and browser identifiers are stored as HMAC digests with short retention. Daily publication limits cover network, browser and site totals (100 sources / 5 million characters and two agent creations per network; 200 sources / 10 million characters and 40 agents across the site). A default rolling site cap of 20 voice reservations protects the account across different networks; lower it with `DEMO_SITE_DAILY_LIMIT`. Set `VOICE_DEMO_ENABLED=false` to disable publishing and new sessions.

`/account` provides password-based registration/sign-in with bcrypt hashes, HttpOnly cookies, current account status checks and shared request limits. Signup does not grant admin permissions, shared company-data access, or extra trial time. `ov_demo_accounts.extended_access` defaults to false and may only be approved by the operator through trusted database administration; an approved account receives one 180-second trial under the same daily IP/browser/account checks. Email verification/reset is not advertised or implemented while email is disabled. Trial accounts are separate from the existing operator/admin account system.

Cookies and IP addresses are abuse signals, not a verified human identity: shared networks can share a limit, while VPN/proxy rotation can change networks. Neither fingerprinting nor these limits guarantee perfect bot prevention. The site-wide cap bounds successful session reservations; also set a provider credit quota/budget. Hosting, OCR bandwidth and provider usage remain subject to their allowances.

## Document limits and security

100 documents; 10 MB each; 200,000 extracted characters each; 5,000,000 combined characters. Two documents process at a time. Workers terminate on cancellation or after 150 seconds. PDFs are limited to 100 pages, 30 OCR pages and 20 million rendered pixels per page. Scans always require manual text review. English OCR models, fonts, CMaps and WASM are served from local build assets; no document is sent to a third-party OCR service.

DOCX extraction validates central-directory limits before decompression, rejects excessive expansion, ZIP64/split/encrypted archives, embedded active content, external relationships and XML declarations/entities. Arbitrary ZIP files/executables are not accepted. PDFs disable evaluation/XFA and reject document JavaScript/actions and attachments. Only plain text is shown; imported text is never rendered as HTML or executable instructions. JSON FAQ context is preserved. Text parsing rejects invalid UTF-8/empty/oversized output.

These are bounded browser parsers, **not ClamAV or the previous Linux sandbox**. A browser worker is not a guarantee that a file is malware-free. Original files never reach the Next.js backend; the backend separately validates text, profile, manifest and caller data. Any future file-upload server endpoint needs independent scanning/isolation. OCR confidence is a review aid, not an accuracy guarantee.

## Optional PostgreSQL / Neon

Set:

```dotenv
SUPPORT_STORAGE=postgres
DATABASE_URL=postgresql://...pooled-connection...
SUPPORT_TENANT_ID=your-fixed-company-id
SUPPORT_DATA_KEY=base64-encoded-32-byte-random-key
SUPPORT_INTEGRATION_KEY=optional-long-random-machine-key
```

There is no embedded PostgreSQL dependency. A compatible `NEON_DB_CONNECTION_STRING` is also accepted. Connections use certificate-verified TLS off loopback and a small pool. The adapter creates new `ov_workspaces` and `ov_request_limits` tables; it does not rewrite the Python schema or account tables. Workspace payloads use authenticated AES-256-GCM encryption with tenant-bound additional data. Back up the encryption key separately; it is required to recover records. To migrate a local workspace, export its knowledge and deliberately import/save it into the server workspace; changing the storage setting does not silently upload local caller records.

Server workspace APIs require an active administrator cookie from the existing optional account system, or a server integration bearer key of at least 32 characters. The server selects `SUPPORT_TENANT_ID`; caller-supplied tenant fields never select another workspace. External SSO does not grant administrator access. The existing user/account schema and admin setup scripts remain optional. Do not use the single-tenant adapter as an unreviewed multi-company account system.

PostgreSQL serializes mutations using transactions/row locks; tickets are committed before SMTP. Shared quotas survive different serverless instances. Large documents are fetched individually to fit function payload limits. Transcripts load on demand. A future account-based tenant resolver can replace the fixed tenant without changing the shared domain logic.

## Native telephone support and email

For inbound calls while browsers are closed, enable PostgreSQL and configure:

- `NATIVE_CALLS_ENABLED=true` and a public HTTPS `PUBLIC_APP_URL`.
- A random `SUPPORT_TOOL_SECRET` and provider secret ID `ELEVENLABS_TOOL_SECRET_ID` containing `Bearer <SUPPORT_TOOL_SECRET>`.
- A dedicated published company agent assigned to your supported phone integration.
- `ELEVENLABS_WEBHOOK_SECRET` and a signed post-call webhook at `/api/studio/webhooks/elevenlabs`.
- Optional `EMAIL_ENABLED=true` and SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`).

`/api/studio/native` accepts only the tool credential and writes consented intake/human requests into the fixed company workspace. Native publishing uses a managed server webhook tool rather than browser client tools; a configured human number enables provider-native transfer. Subsequent native publications update the same assigned phone agent and reuse the managed tool ID, preserving other tool IDs and manually attached sources. Saved hours/holidays use the server clock. Staff presence and busy/no-answer behaviour must still be enforced/tested in your PBX. Browser calls cannot transfer to a telephone. Unknown hours never imply staff availability. Callback requests remain a queue, not booked appointments or an automatic dialer.

The SMTP outbox claims a delivery lease, verifies TLS, disables file/URL loading and stores sanitized failure state for retry. SMTP acceptance is not proof of inbox delivery. Post-call HMAC verification checks the raw payload and timestamp, rejects unmapped agents and deduplicates conversations. Old agents from a replaced native publication should be retired/removed after active calls end.

## Netlify

Use the repository-root `netlify.toml` (`frontend` base, `npm run build`, `.next` output). Netlify's Next.js adapter deploys the route handlers. Use the real HTTPS site origin for `PUBLIC_APP_URL`; do not set a Python backend URL or add a proxy to port 8000. Local workers/OCR assets are prepared at install/build. All provider requests are short bounded operations, and no continuous in-process publishing worker is required. No single HTTP function receives a 35-file binary batch.

The no-database default is a browser workspace and live browser demo. Reliable unattended telephone operations and server email use the optional server database. This is an explicit storage boundary, not a hidden fallback to Python.

## Testing a real PostgreSQL connection

The default unit suite never connects to your database. Use a direct (unpooled) test connection for schema isolation; the tests convert a Neon pooled hostname to its direct equivalent. To opt into the four adapter integration tests, set `TEST_POSTGRES_URL` to a dedicated test Neon/PostgreSQL connection and run `npm test` in `frontend/`. They create a uniquely named test schema, isolate their tables using `search_path`, and drop only that schema afterward. The database role must be allowed to create schemas. Without this variable those four tests are explicitly skipped; no embedded database runs. Never commit the connection string.

For the initial public browser demo, keep `SUPPORT_STORAGE=browser`, `EMAIL_ENABLED=false`, and `NATIVE_CALLS_ENABLED=false`. Adding a Neon connection enables shared rate-limit persistence; it does not automatically migrate IndexedDB records. Switching workspace storage to `postgres` requires `SUPPORT_TENANT_ID`, `SUPPORT_DATA_KEY` and authenticated admin/integration access as described above. A public visitor must never receive the integration key or anonymous access to the company's shared records.

## Credential handling

Keep only blank placeholders in `.env.example`. Real values belong in ignored `frontend/.env.local` and Netlify environment settings, never `NEXT_PUBLIC_*`, Git, browser storage or HTML. The credentials originally provided in the example were preserved in private local configuration and an ignored backup before sanitizing the template. `netlify env:import` configures the runtime; secrets are not declared in `netlify.toml`. Deploy the HTTPS site origin as `PUBLIC_APP_URL`.

Reference: [single-use conversation signatures](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url), [agent configuration and limits](https://github.com/elevenlabs/skills/blob/main/agents/references/agent-configuration.md), and [Netlify CLI environment management](https://cli.netlify.com/commands/env/).
