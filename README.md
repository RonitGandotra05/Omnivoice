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

OmniVoice turns company documents, policies, and support workflows into a configurable calling agent. Customers get grounded answers; your team gets clear escalations with the context to follow through.

| Your workspace | What it does |
| :--- | :--- |
| **01 · Company brief** | Set the company identity, greeting, tone, and default support inbox. |
| **02 · Knowledge** | Upload PDF, DOCX, TXT, Markdown, or JSON documents and inspect the extracted text. |
| **03 · Escalations** | Route issues to specialist teams. Save tickets, track SMTP delivery, and retry failed emails. |
| **04 · Test conversation** | Preview source-cited answers and human handoffs. Start live voice in a configured workspace. |
| **05 · Connect** | Integrate company-scoped APIs, synchronize voice knowledge, and review completed call activity. |

> **Start without credentials.** The sandbox parses documents and previews answers and routing against your local backend. Demo tickets never send email or place calls. Live voice and email stay off until you explicitly enable them.

## From knowledge to follow-through

**Your documents → Grounded conversation → The right human.**

Each company has its own API keys, knowledge, routing configuration, and dedicated voice agent. Key permissions and expiration checks protect access. Escalation tickets persist before email delivery, and signed post-call events capture transcripts, summaries, duration, and outcomes.

The studio’s text preview uses attributed **extractive document search**. Natural voice conversations use the configured voice platform and its native knowledge retrieval. Test both before taking customer calls.

## Run it locally

### 1. Start the support API

From the repository root:

```sh
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 2. Start the studio

In a second terminal, from the repository root. Requires Node.js 20.9 or later:

```sh
cd frontend
npm ci
npm run dev -- --hostname 127.0.0.1
```

### 3. Make it your agent

Open **[the company studio](http://127.0.0.1:3000/try-for-free)**. Edit the example company, add documents, define specialist inboxes, and ask a customer question. Save the demo workspace to keep it in that browser.

| Local service | Address |
| :--- | :--- |
| Company studio | [127.0.0.1:3000](http://127.0.0.1:3000) |
| Support API | [127.0.0.1:8000](http://127.0.0.1:8000/health) |
| API reference | [Interactive endpoint documentation](http://127.0.0.1:8000/docs) |

## Connect your company

Copy the example configuration files, then add your credentials locally:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

| Configuration | Purpose |
| :--- | :--- |
| **Company access** | Create a company with the operator API, then save its returned company ID and API key. |
| **Connected studio** | Set server-side `SUPPORT_COMPANY_ID` and `SUPPORT_API_KEY`, then sign in as an administrator. |
| **Voice** | Configure the dedicated company agent, knowledge synchronization, server tools, and signed call webhooks. |
| **Email** | Add SMTP settings and explicitly enable delivery. Tickets remain saved when email is unconfigured. |

**[Read the company integration guide →](docs/company-integration.md)**

It covers environment variables, tenant endpoints, voice-provider setup, telephony, escalation tools, email delivery semantics, and operational limits. Provider-specific details live in operator documentation; the customer-facing interface uses OmniVoice branding.

## Built with clear boundaries

- **Secrets stay on the server.** Real environment files and private credential files are excluded from Git; examples contain placeholders.
- **Company data stays scoped.** Support endpoints authenticate each company key and check permissions, expiry, and company activity.
- **Actions have receipts.** Confirm tickets and connected actions from actual tool results. SMTP acceptance is tracked separately from guaranteed inbox delivery.
- **The demo is a sandbox.** Drafts stay in browser storage. Use a connected workspace for persistent company operations.

The backend supports multiple companies. Each studio deployment currently connects to one company through server configuration. Use PostgreSQL for concurrent production traffic. Live transfers, booking fulfillment, billing, and background email retries require additional integrations.

## Check the build

```sh
cd frontend
npm run lint
npm run build
npm audit --omit=dev
```

Local verification covered document retrieval, company isolation, escalation routing and retries, mocked voice/webhook integrations, and browser flows at phone, tablet, and desktop widths. New test sources and browser artifacts are intentionally excluded from this change.

Live audio quality, native retrieval, telephony, and actual email delivery need a controlled credentialed integration test. See the integration guide for the remaining dependency and operational notes.

---

<p align="center">
  <strong>OmniVoice</strong><br />
  <sub>Good conversations. Thoughtfully built.</sub>
</p>
