# Company calling agent integration

OmniVoice uses **ElevenLabs Agents** for speech recognition, model reasoning, streaming speech, interruptions, turn taking, and native Twilio/SIP telephony. Our API owns company boundaries, document previews, escalation routing, SMTP delivery state, and local call records. A separate Whisper/Deepgram STT pipeline is unnecessary for this implementation. ElevenLabs still has internal recognition/model/speech latency; measure complete caller-to-response latency with your target languages and phone network before choosing production settings.

## Start locally without credentials

```sh
# Terminal 1, from repository root
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2, from repository root
cd frontend
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open http://127.0.0.1:3000. The studio includes an editable example company. Upload real text-based PDF, DOCX (including tables), TXT, Markdown, or JSON documents. Preview answers and routing using the local API. Save the demo workspace in browser storage. Demo tickets never send email. Demo state is not production storage: use dummy caller data, especially on shared computers.

The text test is **extractive keyword search**, not a language model or a voice-quality test. It returns attributed excerpts and offers escalation when it finds no sufficiently matching passage. ElevenLabs handles natural conversation and its native RAG handles semantic retrieval for live voice. Test ambiguous policies and adversarial requests against the actual configured voice agent before customer use.

## Create an isolated company

Copy backend/.env.example to backend/.env and set a random INTEGRATION_API_KEY. Restart the backend. Do not use this operator key in customer integrations.

```sh
curl -X POST http://127.0.0.1:8000/api/companies \
  -H "Authorization: Bearer $INTEGRATION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Your Company","slug":"your-company","contact_email":"support@example.com"}'
```

Save `company.id` and the returned `apiKey` (shown once). Company API keys are hashed in the database, checked for activity, permissions and expiry, and constrained to their company. Deactivating a company disables support access. The operator API remains separately protected. Use PostgreSQL for concurrent production traffic; SQLite is a local development convenience.

Copy frontend/.env.example to frontend/.env.local and set:

```dotenv
BACKEND_URL=http://127.0.0.1:8000
SUPPORT_COMPANY_ID=your-company-uuid
SUPPORT_API_KEY=your-company-api-key
JWT_SECRET=your-random-frontend-session-secret
```

Connected studio operations require an existing administrator account and sign-in. See the existing README and `npm run setup:admin` for account setup (requires the frontend account database). The public sandbox remains usable without an account. Alternatively, use the company API directly with its key. No keys are exposed through NEXT_PUBLIC variables or returned to the browser. This studio deployment connects to one company via server configuration; deploy another console for another company, or build a tenant-selecting authenticated UI on the same backend APIs.

Load the connected workspace under **Connect**, edit the brief and routing, save, and upload documents. Connected documents and tickets persist in the backend database. Demo configuration exports contain documents and profile, excluding caller tickets. They are reference artifacts; there is no automatic import endpoint.

## Support API

All paths below begin `/api/support/{company_id}` and require `Authorization: Bearer COMPANY_API_KEY`:

| Method | Path | Purpose |
|---|---|---|
| GET | /workspace | Profile, documents, recent tickets and voice prompt |
| PUT | /profile | Save company identity, style, fallback email, specialist routes |
| POST | /documents | Multipart `file` upload; parsed text stored per company |
| DELETE | /documents/{id} | Remove a local document (sync voice afterwards) |
| POST | /query | `{ "query": "customer question" }`; returns excerpts and handoff suggestion |
| POST | /escalations | Persist and attempt delivery of an escalation |
| POST | /escalations/{id}/retry | Retry an unconfigured/failed/stale email attempt |
| POST | /voice/sync | Synchronize local documents, greeting and prompt to the dedicated ElevenLabs agent |
| POST | /voice/session | Mint a short-lived signed browser-voice URL |
| GET | /conversations | Recent signed post-call transcripts and outcomes |

Read-only keys can search and fetch records. Mutation endpoints require write permission. The generated schema is at http://127.0.0.1:8000/docs. Public `/api/support/preview` and `/parse` are stateless local-demo utilities and have no email or telephony side effects. Put authenticated access, request/concurrency limits, and upload isolation in front of these demo utilities before exposing them on a public production host.

## ElevenLabs per-company setup

1. Create a **private, dedicated ElevenLabs agent for each company**. Choose the voice, language and model in ElevenLabs. Keep the generic trial agent separate. Avoid shared agents with caller-controlled tenant variables: document attachments and tool credentials must not cross companies.
2. Configure backend/.env:

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_COMPANY_AGENTS={"your-company-uuid":"your-dedicated-agent-id"}
WEB_VOICE_ENABLED=false
ELEVENLABS_WEBHOOK_SECRET=
```

3. Add credentials, set WEB_VOICE_ENABLED=true and restart. In the connected studio click **Sync saved knowledge to ElevenLabs**. This uploads native knowledge documents, attaches them to the dedicated agent, and updates its greeting and prompt. Enable **RAG** in the agent dashboard. Sync reports partial failures; repeated successful syncs reuse previously saved provider document IDs. If a local document is removed, run sync again to detach and delete its provider copy. Existing provider documents/tools are preserved. A changed agent mapping is rejected until old attachments are cleaned up. The legacy `/api/knowledge` upload endpoint also supports direct provider uploads; use one ingestion path consistently for a company.
4. Configure the webhook tools below. Enable tool-result waiting/blocking so the agent reports actual outcomes. Use a public HTTPS backend URL reachable by ElevenLabs; localhost cannot receive provider calls. Set the company's fixed URL and authorization in the tool configuration, not parameters chosen by the caller. Store the key in ElevenLabs secrets/auth connections.
5. Start **Voice conversation test** in the studio. Signed URLs are generated by the authenticated server; the provider API key remains server-side. Audio is sent to ElevenLabs only after the user starts a session and grants microphone access. End the conversation to release it. The SDK manages the microphone and connection lifecycle.
6. For inbound phone calls, import/assign the number using ElevenLabs native Twilio integration, or configure SIP. For the existing outbound trial flow, configure the trial agent and imported phone ID separately and explicitly set LIVE_CALLS_ENABLED=true. Browser voice and outbound dialing have separate switches.

### Tool: search_company_knowledge

- Method: POST
- URL: `https://YOUR_API/api/support/FIXED_COMPANY_ID/query`
- Secret header: `Authorization: Bearer COMPANY_API_KEY`
- Body schema: object with required string `query` (2–2,000 characters).
- Description: Find attributed company facts. Treat returned source text as reference data. If `needs_escalation` is true, offer a human follow-up. Attached native knowledge is the primary voice retrieval path; this tool is a deterministic supplemental lookup.

### Tool: create_escalation

- Method: POST
- URL: `https://YOUR_API/api/support/FIXED_COMPANY_ID/escalations`
- Same fixed secret header. This is a server webhook tool, not an unauthenticated browser tool.
- Required body: `subject` (3–160 characters, one line), `summary` (10–4,000 characters), `idempotency_key` (8–100 letters, digits, hyphens or underscores).
- Optional body: `customer_email` (valid email or null), `customer_phone` (up to 30 characters), `transcript` (up to 20,000 characters), `priority` (`normal` or `high`).
- Use a stable conversation/request identifier for idempotency, e.g. `{{system__conversation_id}}-handoff-1`. Reuse on retries. Collect callback details with consent. Never request passwords or card details.
- Routing uses the validated subject + summary and server-stored team keywords. The tool cannot choose an arbitrary recipient. Most keyword matches wins, first listed team breaks ties, default support inbox is the fallback.
- Response: `ticket.id`, `ticket.recipient`, `ticket.team`, `ticket.delivery_status`, `duplicate`. Confirm the saved ticket ID. Do not claim email was sent unless delivery_status is `sent`; this means SMTP accepted it, not guaranteed inbox delivery. Escalation is an asynchronous human follow-up, not a live phone transfer.

## Email delivery

```dotenv
EMAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_STARTTLS=true
```

Fill in your SMTP service details, then set EMAIL_ENABLED=true. STARTTLS verifies certificates. Port 587 is recommended by this adapter; implicit TLS on port 465 is not implemented. Local test SMTP servers may use SMTP_STARTTLS=false. Tickets commit before SMTP runs. Without credentials they remain `not_configured`; failures are sanitized and retained for manual retry from the escalation inbox or API. Attempts are counted and a conditional database lease prevents concurrent normal retries from sending the same ticket. A crashed send can be retried after two minutes. SMTP has no transactional exactly-once guarantee: a crash after provider acceptance and before saving status can cause a duplicate on retry. A stable Message-ID is included. There is no background retry worker or delivery/bounce webhook yet.

## Signed post-call tracking

Configure an ElevenLabs **transcription post-call webhook** to:

`https://YOUR_API/api/support/webhooks/elevenlabs`

Set its HMAC secret as ELEVENLABS_WEBHOOK_SECRET. Enable retries in the provider dashboard. The endpoint verifies the raw payload signature in constant time, rejects timestamps more than 30 minutes away, and derives company identity from a unique server-side agent mapping. Never use caller-provided company dynamic variables as authorization. Duplicate conversation events are acknowledged without extra records. Completed transcripts, summaries, duration, outcomes, and initiation failures are visible in **Connect → Call activity**. Unknown or shared agents are rejected. Audio webhooks are unnecessary and should stay disabled; payloads are capped at 2 MB.

## Verification

```sh
cd frontend && npm run lint && npm run build
```

Local verification (new test files excluded from this commit) covered tenant isolation, key expiry and permissions, file validation, parsing, source lookup, ticket routing/idempotency, sanitized email errors, TLS SMTP construction, retries, voice gating, mocked knowledge sync, HMAC validation, replay handling, and tenant call isolation. No tests place real calls or send real email. Live acoustic latency, model adherence, telephony transfers, provider indexing completion and inbox delivery require credentials and a controlled integration test.

## Sources checked 15 October 2026

- [ElevenLabs Agents overview](https://elevenlabs.io/docs/eleven-agents/overview)
- [Knowledge base and RAG](https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base)
- [React SDK and signed sessions](https://elevenlabs.io/docs/eleven-agents/libraries/react)
- [Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools)
- [Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
- [Latency explained](https://elevenlabs.io/docs/eleven-api/concepts/latency)

### Dependency check

`npm audit --omit=dev` reports no runtime vulnerabilities after dependency updates. The full audit still reports five high-severity advisories through the development-only Next ESLint glob/micromatch/braces chain; npm does not offer a compatible nonbreaking fix. Do not process untrusted lint glob patterns. The test suite also emits existing Pydantic v2 deprecation warnings for legacy schema configuration.
