<p align="center">
  <img src="docs/assets/readme-cover.svg" alt="OmniVoice — Your company. Every call. Understood." width="100%" />
</p>

<p align="center">
  <strong>A support agent shaped around your company.</strong><br />
  Give it the knowledge. Define the handoff. Make every conversation count.
</p>

<p align="center">
  <a href="#built-for-your-business">Explore the workspace</a> &nbsp; · &nbsp;
  <a href="#run-it-locally">Run locally</a> &nbsp; · &nbsp;
  <a href="docs/company-integration.md">Integration guide</a>
</p>

---

## Built for your business

OmniVoice turns company documents and support workflows into a configurable calling agent. The active app is **Next.js**, with browser document processing and IndexedDB storage by default. **No Python server is needed.** Document setup and text previews work locally; public voice demos use Neon-backed abuse protection.

| Your workspace | What it does |
| :--- | :--- |
| **01 · Company brief** | Identity, greeting, tone, human hours, timezone and holiday closures. |
| **02 · Knowledge** | Batch-import PDF, DOCX, TXT, Markdown and JSON. Extract text locally; review OCR before use. |
| **03 · Escalations** | Route issues and save human/callback requests. Optional PostgreSQL enables server email and shared records. |
| **04 · Test conversation** | Source-cited text answers, saved regression checks, caller journeys and configured live browser voice. |
| **05 · Setup & activity** | Publish approved knowledge, review caller details and follow conversations. |

> **Local first.** Workspace data stays in this browser until you explicitly publish approved extracted text to your voice agent. Original documents are not uploaded. Local requests do not send email or make phone calls.

## Run it locally

Requires **Node.js 22**. From the repository root:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open **[the company studio](http://127.0.0.1:3000/try-for-free)**. Configure your company, import documents, define specialist teams and ask a customer question. The PDF/OCR worker and English model assets are prepared automatically from locked npm dependencies. No system OCR installation is required.

For a production build:

```sh
npm run build
npm start -- --hostname 127.0.0.1
```

## Bring your voice

Set the server-side **`ELEVENLABS_API_KEY`** in `frontend/.env.local` or the hosting environment. Save your workspace, review OCR, then select **Publish knowledge**. Start a voice conversation after publication completes. Each browser receives a private workspace agent and owner-bound signed session; provider credentials stay on the server. Demos require a verified account. Accounts receive **up to 10 minutes per rolling 24 hours**, backed by Neon. Budgets are shared across account, network and browser; previous demo usage counts toward the account budget. The full remaining allowance is reserved at conversation start, including on early hang-up or connection failure, to prevent replay.

| Mode | Storage | Available operations |
| :--- | :--- | :--- |
| **Browser workspace · default** | IndexedDB on this device | Knowledge, checks, caller details, browser transcripts, local callback queue, configured live browser demo. |
| **Connected company · optional** | Encrypted PostgreSQL / Neon | Shared records, authenticated server API, native phone tools, signed post-call history and SMTP outbox. |

Use `DATABASE_URL` or `NEON_DB_CONNECTION_STRING` when you are ready for shared storage. The new PostgreSQL adapter is independent of the retained Python tables. It uses verified TLS, tenant-bound encryption, transactions and shared quotas. Public demo limits and trial accounts use separate `ov_demo_*` tables, while documents and caller records remain in IndexedDB. Customers sign in with Google; names and verified emails come from the Google profile. Manual email/password and other customer providers are disabled. One normalized email maps to one account; different sign-in methods are never silently linked. Account creation never resets the network allowance or grants administrator access. Settings include display name, light/dark/device appearance, authenticator 2FA, recovery codes and session revocation. Server-side account/network lockouts protect direct API requests as well as the login UI. Account roles are database-managed: new accounts are users, and neither public nor administrator APIs can grant roles. Support email and telephone integrations stay disabled by default.

**[Account providers, verification and setup →](docs/accounts.md)** · **[Authentication security →](docs/authentication-security.md)**

**[Deployment, environment variables and migration guide →](docs/nextjs-migration.md)**

## From knowledge to follow-through

**Your documents → Grounded conversation → The right human.**

Text previews use attributed extractive search. Live voice uses the configured provider's native reasoning and knowledge retrieval. The prompt asks for the caller's preferred name, reason and consented callback contacts, then saves confirmed details through a connected tool. Contact details are self-reported, not account authentication.

Human hours use the company timezone, holidays and overnight shifts. A callback is a saved request, not a guaranteed appointment. Browser conversations cannot transfer to a telephone; native telephone support while browsers are closed needs the optional server database and phone integration.

## Built for careful operation

| Documents | Processing | Publishing |
| :--- | :--- | :--- |
| **100 sources** · **35-file batches** | Two local workers · cancellation · 150-second timeout | Signed owner-bound document receipts |
| **10 MB/file** · **200k characters/file** · **5m/workspace** | Native PDF text + local English Tesseract OCR | Indexing and saved-check gates |
| PDF · DOCX · TXT · Markdown · JSON | Expansion/page/pixel limits · OCR review | Resume interrupted preparation without Python |

Browser parsers reject unsupported archives, excessive expansion, active PDF content and unsafe DOCX structures. They do not provide antivirus certification or the retained Python container's Linux sandbox. Treat imported text as untrusted reference data. Parsed content is displayed as text and validated again before publication.

IndexedDB is local browser storage; clearing site data removes it. Export a backup. Published text and voice conversations are processed by the voice platform. Use **Remove published voice copies** to clean known published resources; lost/expired ownership grants may require dashboard cleanup. Public voice operations require shared Neon-backed limits and fail closed when protection is unavailable. Also set provider usage limits for public access.

## Deploy to Netlify

Connect this repository using the root **[netlify.toml](netlify.toml)**. It builds `frontend/` and deploys Next.js routes with the framework adapter. Set `PUBLIC_APP_URL` to the real HTTPS origin and add secrets to the server environment. No Render service, Python function or port-8000 proxy is involved.

```sh
cd frontend
npm run lint
npm run build
npm run check:secrets
```

The local verification suite (kept out of commits as requested) covers IndexedDB concurrency, contact consent, knowledge checks, business hours/DST, private voice grants, mocked provider publishing, PostgreSQL transactions/encryption and real JavaScript PDF/OCR engines. No real calls or emails are sent by the test suite. See **[verification notes](docs/verification.md)**.

## Project notes

- **[Next.js migration and operations](docs/nextjs-migration.md)** — current application architecture and deployment.
- **[Security boundaries](docs/security.md)** — local storage, server secrets and retained Python security controls.
- **[Open-source research](docs/open-source-research.md)** — source review, licences and adopted patterns.
- **[Earlier Python integration guide](docs/company-integration.md)** — retained implementation, disconnected from the default app.

The Python code remains available in `backend/`. Nothing in the current studio requires it to run.
