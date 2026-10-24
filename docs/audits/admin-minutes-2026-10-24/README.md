# Administrator voice minutes

Implemented locally on 24 October 2026. Deployment and production account changes have not been performed.

The existing `/admin/dashboard` gains:
- Server-side search by account name/email, with the existing 25-user pagination.
- Available, consumed, pending, configured allowance, retained confirmed usage, and last-reset timestamp for each account, displayed in minutes with a usage meter.
- Edit allowance: set 1–240 whole minutes per rolling 24-hour window (default 10). Increasing the allowance preserves consumed/pending usage; decreasing it does not cancel a call already in progress. New calls stay capped at ten minutes each.
- Reset minutes: consumed calls before the reset stop counting against the current allowance. Provider/billing session records remain, and pending reservations remain charged until verified. Reset does not bypass site capacity, publishing/network quotas or duplicate-agent protections.
- Compact confirmation panels automatically scroll into view and receive focus. Existing suspend/restore/revoke actions remain separate from minute changes. Administrator security/roles cannot be changed through the new actions.

Server implementation:
- `ov_demo_accounts.voice_budget_seconds`: constrained integer 60–14,400, default 600.
- `ov_demo_accounts.voice_reset_at`: nullable reset timestamp.
- `ov_admin_events.details`: JSON audit metadata containing previous/new budgets and reset timestamps.
- Migrations extend the existing database setup, requiring deployment migration permissions. No new credential or role is granted.
- The API reuses `requireProductAdmin` (verified canonical Ronit email AND existing database admin role), same-origin enforcement, request size bounds, strict operation schema, parameterized SQL and existing admin rate limiting.
- Changes run in a transaction with the same advisory lock as call reservations, followed by an account row lock and audit insertion. A forged user token/body cannot select an administrator role or write unlimited minutes.
- The caller-facing allowance API, call-reservation path and publication-spending guard read current account budgets from PostgreSQL; client/session claims are not the authority. Cross-instance operations use the shared database.
- Resets preserve financial records. The history label deliberately says “retained confirmed history”: the existing session retention cleanup means this is not a lifetime billing total. Pending usage is explicitly separated from settled usage.

Validation:
- Unit tests cover strict amount bounds/types, rejected extra/privilege fields, used/pending/remaining calculations, suspended-user ineligibility, zero database calls on invalid input, and unauthenticated admin mutation denial.
- Existing and new automated suites, build, lint and secret scans are run alongside the implementation.
- `frontend/tests/admin-minutes-postgres.integration.mjs` validates migrations and real SQL in an isolated disposable PostgreSQL schema, with synthetic users only and provider networking disabled. It covers increased/lowered limits, reset with a pending call, retained history, duplicate reservations, publication eligibility, per-call caps, validation rollback, audit events and unchanged user roles. The schema is removed after the run.
- Interactive browser QA is unavailable while local browser control is disabled in Work settings. No live administrator account or real user's balance was modified during tests.

The changes are not live until deployed. Existing environment/database configuration must remain available to Netlify server functions. Production DB roles must be able to apply the three additive schema alterations, or an administrator must provision them before rollout.

Real database audit completed successfully (`job-mvm8cfqy-afaea82a`, exit 0): increased/lowered allowances, pending-reservation preservation, reset/retained history, publication eligibility, per-call caps, strict validation, immutable roles, and transactional audit metadata all passed. Its disposable schema was removed.
