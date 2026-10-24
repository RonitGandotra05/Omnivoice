> **Latest active-app review (24 October 2026):** see [implemented improvements and verification](engineering-review-2026-10-24.md). The older backend-specific evidence below must not be read as current Next.js or deployment verification.

> **Current default:** the studio uses Next.js routes, local browser parsing and IndexedDB. See [the Next.js guide](nextjs-migration.md). Python scanner/container instructions below describe the retained alternative backend, not the active browser mode.

# Production readiness: scope, controls, and remaining gates

This is a production-hardening pass, **not a claim that every possible company, document, deployment, or voice conversation has been validated**. The API is tenant-scoped and the studio can be configured for a company. It is not a complete self-service SaaS: onboarding, billing, user-to-company membership management, and commercial operations still need product work.

## Implemented

| Area | Behavior |
|---|---|
| Bulk upload | Select up to 100 files, including 25/30/35-file batches. Two requests run at a time. Each file shows queued, processing, retrying, ready, duplicate, failed, cancelled, or review-required state. |
| Partial failures | Successful files are retained. Retry unfinished files independently. Transient failures get at most three attempts with bounded backoff and Retry-After handling. Permanent parsing errors are not retried automatically. |
| Limits | 10 MB per file, 200,000 extracted characters per file, 5,000,000 characters per workspace, 100 documents including quarantined sources. Oversized documents must be split; no silent truncation. |
| PDF extraction | Native text is preferred. Sparse/poor text pages fall back to local Tesseract 5 LSTM OCR at 300 DPI with orientation detection and per-page confidence metadata. |
| OCR review | All OCR requires human approval by default. Low-confidence/empty-page warnings remain visible. Unapproved text is excluded from company answers and publishing. A reviewer may correct it before approval. |
| Resource bounds | Two parsers per API process, one-second slot admission, 150-second document deadline, 100 PDF pages / 30 OCR pages, 20 million pixels per rendered page. Parser process groups are killed on timeout/cancellation. Linux subprocess address space is capped at 512 MiB; CPU is capped at 120 seconds. |
| File validation | Unsupported, corrupt, encrypted, empty, unreadable, over-limit and excessively expanded DOCX inputs are rejected. Actual parsers validate content; the extension alone is not trusted as evidence of readability. |
| Duplicate handling | SHA-256 fingerprints are unique per company. Repeated successful uploads return the original document, including after a transient client response failure. |
| API quotas | Atomic, database-shared fixed windows, with separate IP, upload, query/API, escalation, authentication and voice buckets. 429 responses include Retry-After. Quota-store failure fails closed. |
| Frontend sign-in | Shared PostgreSQL counters limit both account and ingress attempts to 10/minute. Forwarded IP headers are ignored unless explicitly trusted. Counters contain hashes, not raw email/IP values. |
| Web safety | Cookie-authenticated mutations check Origin. Streamed bodies are bounded even without Content-Length. Disabled, deleted or demoted administrators are rejected on subsequent privileged requests. Authenticated records are not cached. Remote database TLS certificates are verified. |
| Native voice | ElevenLabs Agents handles the live conversation. Dedicated company agents remain isolated. Larger source documents must finish native RAG indexing before the final agent update. Small sources under 500 bytes use the provider's supported inline behavior. |
| Publishing | Persistent database queue with a renewable per-company lease. Repeated publish clicks coalesce. A crashed worker's job can be recovered after lease expiry. One final provider update attaches the prepared set instead of 35 separate live updates. Local edits during publishing require republishing. |
| Retries | Safe provider GET/PATCH/DELETE operations retry selected temporary failures. Outbound call creation is never automatically repeated. Failed publishing retains known provider document IDs for retry. |
| Startup | Production mode rejects SQLite, weak/default backend secrets, debug mode, disabled quotas, enabled public demo, and missing configured OCR language packs. |

## OCR quality boundaries

Tesseract runs locally; uploaded text is not sent to an OCR cloud service. It is not universally the best model. Confidence is a heuristic, not a guarantee that prices, dates, account numbers or policy details are correct. Handwriting, low-resolution scans, complex tables, image-only diagrams, unusual scripts and mixed layouts need human review and sometimes a specialist pipeline. Native text PDFs may also omit information present only in embedded images.

Install Tesseract with `eng` and `osd` packs. Set `OCR_LANGUAGES` for other installed packs. For higher-accuracy LSTM data you can install language models from the official `tessdata_best` repository and set `TESSDATA_PREFIX`; test the tradeoff against your real corpus. There are no automatic model downloads at request time.

Sources: [Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), [official best language models](https://github.com/tesseract-ocr/tessdata_best), [ElevenLabs RAG](https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base/rag).

## Running locally

```sh
brew install tesseract       # macOS; eng and osd are included
cd backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Use a second terminal for `cd frontend && npm ci && npm run dev`. Install the required Tesseract language packs separately. The API exposes `/api/support/capabilities`, `/health`, and database/worker-aware `/ready` endpoints. Public demo parsing can be disabled using `PUBLIC_DEMO_ENABLED=false`.

## Deploying

Dockerfiles and `compose.production.yml` define a non-root API with Tesseract, constrained memory/CPU/process counts, a read-only filesystem and temporary OCR storage. The studio uses a production Node runtime. Build from the repository root. Real `.env` files, credentials, databases, tests, and local artifacts are excluded from the image build context.

Provide a **managed PostgreSQL database with verified TLS**, strong random secrets, company configuration and any optional SMTP/voice credentials through your deployment's secret manager. Put an HTTPS reverse proxy in front of the loopback-only service ports. Set `PUBLIC_APP_URL` and `FRONTEND_URL` to the exact public origin. Trust forwarded IP headers only from a proxy that overwrites them; otherwise shared-ingress quotas intentionally limit the entire ingress. Do not expose the raw backend to the internet or trust arbitrary forwarding headers. Adjust quotas for measured traffic and provider plan limits.

```sh
docker compose -f compose.production.yml build
docker compose -f compose.production.yml up -d
```

Container definitions have not been exercised in this environment because the Docker daemon is unavailable. PostgreSQL concurrency, proxy configuration and managed database certificates must be tested in staging. Current quota concurrency tests use SQLite. Add migration review, backups, restore drills, monitoring, log retention and alerting before accepting customer data.

Production now requires private malware scanning, a Linux namespace sandbox and encrypted support fields. Read [security controls and deployment requirements](security.md) before deployment; scanner/sandbox preflight fails closed. Local development without these settings is for controlled files only. Linux/container enforcement and real ClamAV signatures remain staging gates.

## Verification performed locally

- **Security regression counts are recorded in [the security report](security.md).** Regression tests cover real scanned and rotated PDF OCR, the isolated upload path, parser timeout/process cleanup, 35 accepted uploads with deduplication, quarantine/approval and company isolation, capacity accounting, atomic quota races, streamed size limits, publishing coalescing and lease recovery, provider indexing states, escalation routing and signed webhooks.
- **31 frontend tests passed.** Unit tests cover 35-file batches at concurrency two, partial failure/retry/cancellation, source review states, request-origin/body guards, revoked administrators, token validation and workspace constraints. Lint and optimized production build pass.
- A temporary production Next server and API passed live HTTP checks for readiness, headers, capabilities, cross-origin rejection, TXT/JSON uploads, corrupt-PDF rejection, unauthorized workspace access and a rotated scanned PDF through the frontend proxy. Both servers were stopped after verification.
- Fresh Python runtime and full npm audits (including development packages) report no known dependency vulnerabilities. The vulnerable lint preset was replaced with direct ESLint/React/accessibility rules; legacy Pydantic configuration was updated. Next build emits a non-blocking warning that its optional lint plugin is absent.
- Provider calls/indexing and SMTP are mocked in regression tests; no real calls or emails were sent. Container images and PostgreSQL/proxy staging are unverified here. This pass did not repeat browser visual validation because its changes focused on ingestion and backend protections.

## Remaining release gates

1. Configure real encryption keys, migrate existing support fields, and validate the private ClamAV service and Linux sandbox startup preflight. Build and run the containers against staging PostgreSQL and your actual HTTPS proxy. Confirm quotas across replicas and trusted client identity, including NAT/shared-network behavior. Fixed windows permit a boundary burst; a strict sliding-window policy is not implemented.
2. Run a representative company corpus through OCR, review errors and verify approved answers. Test real tables/languages and document revisions. Batch processing is bounded client-side orchestration, not a persistent server upload queue: accepted connected files persist; interrupted in-flight files must be selected/retried again.
3. Configure dedicated ElevenLabs agents and server tools; verify real calls, interruptions, tool authorization, knowledge indexing/plan quotas, prompt-injection behavior, and end-to-end latency. Provider failures after accepting a create request can leave an orphan provider document; reconcile through the provider dashboard if necessary. Idempotent updates do not make network side effects transactional.
4. Exercise real SMTP acceptance, bounces, mailbox routing and outage recovery. Tickets persist before sending, but SMTP is not exactly once. Background automatic email retry and bounce tracking are not implemented.
5. Verify full administrator session lifecycle (including stolen-token revocation), customer data retention/deletion, backups, and jurisdiction-specific recording/consent requirements for your deployment. No legal compliance certification is implied.

Do not describe this app as universally ready or perfectly accurate until those deployment- and corpus-specific checks have passed.
