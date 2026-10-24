# Company-information assistant

The compact assistant lives in `SupportStudio`, including subsequent company edits and other workspace tabs. It proposes changes to the existing form, shows current/proposed values, requires explicit selection to replace existing values, detects stale proposals, and uses the existing Save action. It never saves automatically. Users can edit applied values in the form before saving, minimize, and reopen the assistant.

## Architecture and scope

The current customer experience uses Next.js `/api/studio`, shared `ProfileSchema`, and either IndexedDB or the encrypted PostgreSQL workspace store. The older Python company/service CRUD APIs are operator-only and are not the current form's persistence path; they remain unchanged. No duplicate company table, onboarding form, or profile-saving API was introduced.

The assistant also proposes source-backed text for the existing Company information editor. After review, the ordinary Save action adds it to the existing knowledge library. New workspaces start without example companies or policies. Loading an older workspace removes exact untouched Acme documents, example inboxes/routes, and sample hours when the legacy greeting/company identifies the sample setup. Edited documents and custom settings remain. The UI marks cleanup for review and save. A neutral greeting uses the confirmed company name. Cached browser agents are invalidated after sample cleanup.

All existing profile fields are supported: company name, opening greeting, business context/conversation style, default support email, specialist team routes, IANA timezone, hours toggle, weekly office-hour windows, holidays, and human support phone. The existing instructions field holds short source-backed business descriptions/services. There are no standalone category, website, address, or service-catalog fields in this form, so the assistant does not invent them. Long About Us content still belongs in the existing company knowledge editor.

`POST /api/company-assistant` accepts only a UUID request ID, a bounded new message, allowlisted current profile fields, and up to three application-defined follow-up field identifiers. It authenticates through the existing verified Google account/session flow. In PostgreSQL workspace mode the existing dedicated tenant requires the canonical product administrator; clients cannot supply tenant/company identifiers. The endpoint reads no company records and has no profile write capability. Browser-mode users submit only their current local form. Existing persistence permissions remain authoritative.

Google's maintained `@google/genai` SDK runs only on the Next.js server, using `GEMINI_API_KEY`. Model selection is server-only, defaults to **gemini-3.5-flash-lite**, and was verified with the configured key. No silent fallback, search, code execution, functions, external URL fetching, or general-purpose output is enabled. Provider output uses named weekdays, mapped to the existing Monday=0 convention by the backend.

## Security boundaries

- Strict request/output schemas reject unknown root, profile, nested route/hour, and evidence properties. Existing profile field validators enforce lengths, types, phone, email, IANA zones, clock times, and dates. Incomplete bounded form edits may be used as reference; proposed values remain strictly validated.
- Clearly unrelated tasks, common instruction overrides, secret extraction, executable HTML, and destructive SQL payloads are rejected before Gemini. Recognizable credentials are rejected before transmission. These filters reduce abuse; they do not claim to detect every injection or every secret.
- For ambiguous input Gemini classifies/extracts, but the application still permits only profile-field proposals with exact supporting source excerpts. Business context and explicit greetings use source excerpts; business context may join complete verbatim source sentences. Company knowledge copies the accepted company-description source with obvious footer boilerplate removed. A neutral greeting is composed by application code from the confirmed company name, making no claims about services or policies. Model explanations are never returned: replies and follow-up questions are composed from application-defined labels. User and model strings are rendered as React text, never HTML/Markdown.
- Incremental hours merge only affected named days, and reject unsupported changes to other days. Other team routes are preserved. No model query, executable command, tenant identifier, provider config, or persistence operation can be requested.
- Parameterized PostgreSQL queries; authenticated ingress throttles; same-origin checks; 32 KiB body limit; 6,000-character message limit; 10-second upload deadline; 20-second Gemini timeout; 3,072 output tokens; minimal thinking; **one provider attempt with zero automatic retries**. Client clicks are guarded synchronously and never auto-retried. Server deduplication also covers new IDs for identical recent payloads.
- Gemini only receives the new message, company name, relevant existing hours/routing fields, and at most three follow-up field IDs. Chat history is never sent. The browser retains only six recent display messages in component memory.
- No company content, prompt, credentials, or provider error bodies are logged. Shared usage metadata contains keyed user/network/content digests, UUIDs, timestamps, status, token counts, and estimated cost. Records expire after eight days during reservations. Key material is absent from client modules and API responses. Ignored env files are excluded from Docker build contexts.

## Shared usage controls

PostgreSQL is required even when company profiles use browser storage. There is **no in-memory billing limiter fallback**: database/protection failure prevents provider calls. A short PostgreSQL advisory-lock transaction atomically reserves every user/network/site allowance before contacting Gemini, across server instances. PostgreSQL lock/statement deadlines bound reservation waits; provider calls happen outside the transaction.

| Server setting | Default |
| --- | --- |
| `COMPANY_AI_ENABLED` | `true` (`false` disables calls) |
| `COMPANY_AI_MODEL` | `gemini-3.5-flash-lite` |
| `COMPANY_AI_REQUESTS_PER_MINUTE` | 3 per user, rolling 60 seconds |
| Active provider requests per user | 1 (fixed) |
| `COMPANY_AI_USER_DAILY` | 30 per rolling 24 hours |
| `COMPANY_AI_USER_DAILY_TOKENS` | 250,000 |
| `COMPANY_AI_IP_PER_MINUTE` | 15 per rolling minute |
| `COMPANY_AI_IP_DAILY` | 150 per rolling 24 hours |
| `COMPANY_AI_SITE_CONCURRENCY` | 10 |
| `COMPANY_AI_SITE_DAILY` | 500 per rolling 24 hours |
| `COMPANY_AI_SITE_DAILY_TOKENS` | 2,000,000 |
| `COMPANY_AI_SITE_DAILY_USD` | $5 estimated per rolling 24 hours |
| `COMPANY_AI_INPUT_USD_PER_MILLION` | $0.30 |
| `COMPANY_AI_OUTPUT_USD_PER_MILLION` | $2.50 |

429 responses include `Retry-After`; the UI presents the error and pauses sending. Request IDs remain deduplicated for retained records; identical payloads with fresh IDs are blocked for 60 seconds. Reservations use a conservative 40,000-token bound plus output cost; completed calls reconcile to provider-reported input/output/thinking tokens. Unknown usage, failed/abandoned calls retain worst-case reservations and keep the active lease until its deadline. A 90-second active lease permits recovery after worker termination; it exceeds the bounded provider lifetime. Daily/token/cost reservations do not expire with that lease. Estimates are application safeguards, not an invoice guarantee or protection against other applications using the same key.

## Production configuration

1. Supply `GEMINI_API_KEY`, `DATABASE_URL` (or `NEON_DB_CONNECTION_STRING`), and a stable random `STUDIO_SESSION_SECRET` of at least 32 characters through server environment/secret management. Existing Google sign-in and account DB configuration must remain enabled. No `NEXT_PUBLIC_` Gemini variable. Local Next.js already reads `frontend/.env.local`; root `.env` is not automatically loaded by Next.js.
2. Grant the deployment DB role permission to create the metadata table/indexes (`ov_company_ai_requests`) on first use, or provision them using the SQL in `company-assistant-budget.mjs` with a migration role before rollout. Reuse the existing database connection pool. Use the same DB and secrets across instances.
3. Network identity uses the existing verified Netlify `x-nf-client-connection-ip`, including IPv6 /64 grouping. For other production hosts, the existing network resolver deliberately fails closed. Add a deployment-specific, proxy-authenticated network adapter before enabling there; do not trust caller-supplied `X-Forwarded-For`. A Docker deployment currently needs this adapter.
4. In Google AI Studio → API Keys → the key's restriction control, choose **Restrict to Gemini API only**. In Google Cloud Console → APIs & Services → Credentials → the key → Application restrictions, allow only fixed backend egress IPs where available. Serverless hosts with changing egress need a fixed-egress service before applying IP allowlists. Follow Google's current auth-key migration/service-account guidance if the project's key requires it. These console settings were not changed or independently verified by this implementation.
5. In the associated Cloud project, verify billing is attached to the intended project, choose an appropriate paid-service data-use policy for company content, lower Gemini quotas to match expected traffic, and configure Cloud Billing budgets/alerts. Budget alerts are not a hard spending cap. Reserve a dedicated key/project for this feature when an independent billing boundary is needed. Review quotas, provider pricing, and the application price settings whenever changing models. The application switch `COMPANY_AI_ENABLED=false` is the immediate kill switch.
6. Keep `.env*` out of source control and images; inject runtime secrets. Existing `.gitignore`/`.dockerignore` cover them. `npm run check:secrets` scans tracked/staged/current files and built browser assets for configured secret values and recognizable Gemini keys without printing values. Rotate keys if exposure is suspected.

Guidance reviewed: [Gemini model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [key security](https://ai.google.dev/gemini-api/docs/api-key), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## Verification

From `frontend/`:

```sh
npm test
npm run test:hardening
npm run lint
npm run build
npm run check:secrets
node tests/company-assistant-postgres.integration.mjs
node tests/company-assistant-gemini.integration.mjs
node tests/start-assistant-ui.mjs
```

The explicit PostgreSQL integration creates/drops an isolated schema and uses no real company records; it verifies simultaneous requests, rolling boundaries, idempotency, network/user/site budgets, token/cost protection, accounting, encrypted persistence through the existing workspace store, and no writes from rejected model operations. The Gemini integration makes nine bounded calls using synthetic company content. The UI fixture runs actual production components on isolated localhost port 3107 with synthetic authentication/provider responses and no real credentials. It removes its temporary app when stopped. It is not an authentication route in the application.

See `docs/audits/company-assistant-2026-10-24/RESULTS.md` for the tested outcomes and limits of validation. No deployment was performed.
