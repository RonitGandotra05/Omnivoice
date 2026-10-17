> **Current default:** the studio uses Next.js routes, local browser parsing and IndexedDB. See [the Next.js guide](nextjs-migration.md). Python scanner/container instructions below describe the retained alternative backend, not the active browser mode.

# Security controls and deployment requirements

This is a defense-in-depth implementation, not a guarantee that every malicious file or unknown vulnerability is detectable. Production requires the services and controls below; the application refuses startup when its scanner/sandbox preflight fails. No credentials, encryption keys, or existing customer data were changed by this work.

## Uploads are treated as hostile

Only PDF, DOCX, UTF-8 TXT/Markdown and JSON are accepted. ZIP archives, executables and unsafe filenames are rejected. Content signatures and actual parsing are checked; a renamed executable is not treated as a document. Raw uploads are never published, served as downloads, placed under the web root, or executed. Only extracted text can be stored and published.

DOCX is an archive, so validation checks both its directory and bounded inflation: 2,000 entries, 8 MiB per member, 40 MiB total and a 100:1 compression-ratio ceiling. Absolute/traversal paths, duplicate members, symlinks, encrypted entries, nested archives, macro binaries, ActiveX, OLE/embedded objects, external relationships, field instructions and unsupported parts are rejected. CRC/actual size checks run during bounded reads. XML uses a no-network, no-entity, no-DTD parser with normal depth limits. Ordinary DOCX documents with external hyperlinks or field codes must be simplified before upload; this is an intentional strict policy.

PDF object graphs have a complexity budget. JavaScript, automatic actions, file attachments, embedded files, XFA/rich media and external/submit/launch actions are rejected. PDF text extraction/rendering never follows document URLs. Parser CPU, memory, elapsed-time, rendered-pixel/page and extracted-text limits remain enforced. JSON is parsed as data; text/HTML/Markdown is displayed as escaped React text rather than executed markup.

Production files are streamed to a **private ClamAV daemon** before parsing. An infected, malformed, oversized, interrupted, timed-out or unsuccessful scan is rejected. Scanner outages return 503 and accept nothing. `deploy/clamd.conf` bounds scan size, recursion, queue and time, and treats exceeded limits as alerts. ClamAV is signature/heuristic detection, not proof a file is harmless; Freshclam signature updates and current container/native packages remain operational requirements. Do not expose port 3310 to a public network or submit private files to public malware-analysis services.

## Parser isolation and network boundaries

The production parser runs under Linux Bubblewrap with separate namespaces including **no network**, no capabilities, a read-only Python/OCR runtime and application code, and temporary scratch space. It does not mount the host root, home directory, `.env`, database files, scanner socket or provider credentials. Credential-bearing environment values are not inherited. The API verifies the real scanner-plus-parser path during startup. Parser availability depends on the host permitting unprivileged namespaces and the required syscalls; a missing/blocked sandbox causes startup to fail. This was configured and unit-tested on macOS but **has not been executed in a Linux container here**. Validate it on the target host. Do not work around failures by running the API privileged, disabling the sandbox, or using `seccomp=unconfined`; use a reviewed narrow host policy or a dedicated parsing VM/service instead.

Development mode defaults to resource-limited subprocess parsing without Bubblewrap or antivirus. It is for controlled local files, not a public hostile-upload deployment. `PARSER_SANDBOX_REQUIRED=true` enables the strict Linux requirement outside production as well.

Only the approved `https://api.elevenlabs.io` origin is accepted for voice API requests. Plain HTTP, credential-bearing URLs, metadata/local addresses and lookalike hosts are rejected. The client does not follow redirects or inherit proxy credentials from environment variables. Regional endpoints need an explicitly reviewed allowlist change. Uploaded URLs are never fetched by this app. Company agents must not be configured with arbitrary browsing, shell or generic HTTP tools; keep provider tool destinations fixed to authorized company endpoints.

The API and studio ports bind to loopback in Compose. Put a real HTTPS reverse proxy in front, keep PostgreSQL and the scanner private, restrict outbound traffic at the firewall, and allow only the voice API, your database/SMTP and signature-update destinations. The application does **not** configure or certify your host/cloud firewall. Remote PostgreSQL certificates and SMTP STARTTLS certificates are verified. Production requires an HTTPS frontend origin; the studio sends HSTS, frame restrictions, nosniff and restrictive microphone/camera/geolocation permissions. Its CSP restricts framing/base/object use; a full script-nonce CSP is not yet implemented.

## Tenant authorization and SQL safety

Company APIs verify a tenant-specific hashed API key, company activity, expiry and read/write permissions. Tenant IDs are UUIDs; record reads, approval, deletion, tickets, publishing and conversations are scoped to the authenticated company. Wrong-company keys and object IDs are denied. The provider agent mapping is unique per company. Never share a company key or voice agent between companies.

SQLAlchemy expressions and parameterized PostgreSQL queries carry untrusted values as data. Dynamic admin update column names come from fixed application definitions, not request input. SQL-looking text is stored as text and cannot create SQL statements. SQL parameters are hidden from SQLAlchemy error output, and frontend database errors log codes rather than detailed query errors.

The connected studio currently has **installation administrator access**, not self-service user-to-company memberships. Administrators are trusted operators and may manage installation-wide records. Ordinary accounts cannot access connected company data through admin routes. Both middleware and handlers verify active administrator status; disabled/deleted/demoted administrators lose access on their next privileged request. Two older handlers' missing asynchronous verification was fixed. A future multi-company self-service UI needs explicit membership authorization, rather than reusing these installation admin endpoints.

## Encryption and ElevenLabs

AES-256-GCM field encryption protects support document names/content, pending OCR text, company profile JSON, ticket subject/summary/contact/transcript/routing fields and stored conversation summaries/transcripts. Random nonces prevent equal plaintext producing equal ciphertext. Key ID and field/table purpose are authenticated; wrong keys, changed ciphertext and field swaps fail closed. Key IDs support rotation. This protects database contents/backups from someone without the application keys; it does not protect against a compromised running API, authorized operators, or provider access. A shared installation keyring is used; per-company KMS keys and PostgreSQL row-level security are not implemented.

Company IDs, timestamps, status/quality metadata, provider IDs and legacy non-support/account tables are not covered by this field encryption. Enable encrypted database volumes/backups and hosting KMS for the complete database, plus access controls for logs and object storage. No claim is made that those hosting settings have been enabled here.

Client-only **end-to-end encryption** that prevents the server/provider reading content is incompatible with ElevenLabs processing that content in this architecture. The API decrypts approved text for authorized retrieval and HTTPS publishing; ElevenLabs processes the resulting knowledge and call audio. Provider-side encryption, retention, recording, region and subprocessors must be reviewed in your account. Zero Retention Mode is a provider/plan setting and does not mean every uploaded knowledge file is deleted or never stored. Browser demo drafts/exported files are plaintext local data; use dummy information and protect/delete exports.

### Configure keys and migrate existing support records

Keep keys in the deployment secret manager, separate from database backups. Never put keys in NEXT_PUBLIC variables or Git. Losing all keys makes encrypted data unrecoverable.

1. Generate your own 32-byte random key using the command in `backend/.env.example`.
2. Set `DATA_ENCRYPTION_KEYS={"key-2026":"YOUR_BASE64_KEY"}` and `DATA_ENCRYPTION_ACTIVE_KEY=key-2026` in your private environment. No usable example key is provided.
3. Before encrypting an existing database, stop app traffic and publishing workers; back up the database and preserve all existing keys. New deployments create encrypted Text columns automatically; existing PostgreSQL VARCHAR columns need the explicit migration below.
4. Temporarily set `ALLOW_LEGACY_PLAINTEXT_READS=true` and run from `backend`: `.venv/bin/python -m scripts.encrypt_support_data`. It widens the selected PostgreSQL fields to Text and encrypts/re-encrypts bounded pages. It can be rerun after interruption. Inspect the migration and run it against staging first; PostgreSQL execution has not been tested here.
5. Set `ALLOW_LEGACY_PLAINTEXT_READS=false` before production startup. Plaintext reads then fail closed. Test restore and retrieval.
6. For rotation, add a new key without removing the old key, switch the active ID and rerun the offline migration. Retain old keys while any backups/provider reconciliation still require them.

## Verification and remaining work

**The research update adds knowledge-check and release tests; current counts are in [the research report](architecture-research.md).** Lint, the optimized production build and live HTTP checks passed. Fresh Python runtime and full npm dependency audits reported zero known vulnerabilities. Local adversarial tests cover small, bounded archive-bomb fixtures, traversal, macros, XML entities/external relationships, active PDF actions, renamed binaries, genuine DOCX tables, ClamAV wire-protocol clean/infected/error responses and scanner outage, authenticated randomized encryption/key rotation, raw database ciphertext, SQL payloads stored as data, and cross-tenant authorization. The test suite does not download or execute live malware. Real ClamAV detection/signatures, Linux sandbox enforcement, container images, PostgreSQL migration/concurrency and HTTPS/firewall rules require staging tests. Provider/SMTP tests remain mocked until you configure credentials. A dependency audit detects known advisories at the time it runs; it is not a guarantee against future or undisclosed vulnerabilities.

Before customer traffic, also verify backups/restores, key custody, monitoring/alerts, deletion/retention, account/session revocation, abuse controls, real provider tool permissions and document prompt-injection behavior. Prompt guardrails reduce misuse but are not an authorization boundary; tenant authorization is enforced by tools. This is not a completed external penetration test or compliance certification.

References: [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [ClamAV protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [Bubblewrap](https://github.com/containers/bubblewrap), [ElevenLabs retention scope](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode).

### Source scan review

Bandit reported no high-severity findings. Its three medium findings refer to the literal `/tmp` destination **inside a newly created sandbox tmpfs**, not shared host temporary filenames. Six low findings refer to the OAuth token type string `bearer`, importing subprocess, Tesseract subprocess calls, and non-cryptographic randomness used only for retry jitter. These were reviewed: retry randomness does not generate secrets; `bearer` is protocol metadata; OCR uses argument arrays without a shell, a resolved local executable, generated temporary file paths, validated language identifiers, timeouts and the production namespace boundary. They remain visible in the scan rather than being silently treated as proof of safety.

To repeat checks locally:

```sh
cd backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pip-audit -r requirements.txt
.venv/bin/bandit -r app
# In another terminal, from frontend:
npm ci
npm audit
npm run lint
npm run build
```


## Structured caller intake

Caller details use a new encrypted JSON table scoped by company and system conversation ID. Human requests create one durable routed ticket per conversation; callback contacts require explicit permission and international phone formatting. Names/numbers are self-reported, not authentication. Contact withdrawal clears intake/ticket contacts and name summaries; historical provider transcripts and already-sent emails require separate retention/deletion handling. No claim of end-to-end encryption is made: the voice platform and backend must process the conversation.

The managed voice tool has a random per-company credential with `voice_tools` permission only, stored as a bcrypt hash locally and a secret in the voice platform. It cannot read documents, profiles, caller lists or call history. Fixed company URLs and system-provided conversation IDs prevent caller-selected tenant routing. Disable the corresponding API key to revoke it; reconfigure the managed tool before republishing. Local HTTP deployments do not provision this credential. API-wide request limits plus a shared 30/minute company handoff quota apply. Live browser tracking uses administrator authentication and bounded polling with cancellation/backoff; caller details are not added to local draft exports.

Transfer availability is a server-clock decision based on saved hours and destination configuration. Provider native transfer conditions are interpreted by the conversation model, so PBX/ACD routing must enforce hard business-hours and staff availability constraints. “Transfer available” is not confirmation that a human answered.
