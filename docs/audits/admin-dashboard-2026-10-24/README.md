# Admin dashboard verification — 24 October 2026

Implemented server-confirmed allowance responses and immediate row updates, stale-refresh protection, 15-second visible-tab refresh, explicit empty/malformed JSON errors, and Node-owned bounded parsing for product administration. Middleware no longer consumes these request bodies before forwarding. The reported Netlify-only original failure was not reproduced against production; the updated route and middleware were exercised locally together.

Dashboard now includes spaced responsive cards, a seven-day confirmed-minute chart, compact integration states, user search/status/sort filters, side-by-side allowance controls, readable security labels, and expandable user call history (start time, duration, verification status, conversation identifier, joined and last sign-in dates). Counts reflect retained application records, not lifetime provider billing.

## Verified

- Next.js HTTP routes, actual middleware, signed synthetic admin/user cookies and real PostgreSQL in an isolated disposable schema: 15 HTTP checks passed.
- Seeded 222 seconds of confirmed usage: 10-minute budget showed 6.3 available; setting 20 returned and persisted 16.3 available. Reset returned 20 available while retaining the original call record.
- Search/filter/history reads passed. Invalid/empty/oversized bodies, foreign origin, unauthorized user, missing session and role escalation were rejected.
- Regression suite: 186 cases, 164 passed, 22 skipped (optional environment-dependent checks).
- Hardening suite: 16 cases, 15 passed, 1 skipped (optional live database check). HTTP fixture separately exercised database authorization and mutation boundaries.
- Lint, production build and secret scan passed.
- Browser visual/interaction QA could not run because local browser access is disabled in Work settings. HTTP and build checks do not establish visual correctness.

## ElevenLabs

Official pricing checked: https://elevenlabs.io/pricing/agents — published Free Agents reference is 15 call minutes and 4 concurrent calls. This reference is not presented as the account's verified remaining balance.

Subscription endpoint: https://elevenlabs.io/docs/api-reference/user/subscription/get — reports credits, not an authoritative remaining Agents-minute balance. The implementation never converts credits into minutes. The current configured key returned a permission error; subscription access needs `user_read`. An optional server-only `ELEVENLABS_USAGE_API_KEY` may supply this permission without changing the voice key. No key scopes, plan, payments or production records were changed. Provider requests time out after five seconds, fail independently of app balances, and cache for at most 60 seconds.

Changes remain local; no deployment was performed for this request.

## Re-run disposable HTTP verification

From frontend, run `node tests/start-admin-dashboard-ui.mjs`, then in another terminal `node tests/admin-dashboard-http.mjs`. This requires the existing database environment and creates its own schema and synthetic identities. Stop the fixture server with Ctrl-C to remove the schema, temporary app and synthetic cookies. Run the HTTP script once per fresh fixture (it intentionally asserts the seeded starting balance).
