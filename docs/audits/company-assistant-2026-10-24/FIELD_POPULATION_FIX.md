# Company field population and sample-data correction

Implemented locally on 24 October 2026. Not committed, pushed or deployed as part of this correction.

- New workspaces contain no Acme company name, greeting, support inbox, team routes, schedule, or policy documents.
- Existing workspaces remove only exact shipped sample documents and routes. Sample hours are cleared when the old sample company/greeting identifies the legacy setup. Custom documents, greetings, routes and schedules remain. A real company with the legacy Acme greeting receives a neutral greeting with its own name. Cleanup invalidates cached browser agent tokens and prompts review/save.
- Company descriptions propose text for the existing Company information editor, populated on Apply and saved into the ordinary knowledge library by Save workspace. Source text is copied rather than model-generated policy prose. Existing typed information requires explicit replacement approval, and edits made during extraction invalidate that replacement.
- Profile proposals cover name, greeting, business context, email, team routing, timezone, human phone, hours toggle/windows, and holidays. A Select all proposed changes control makes multi-field review practical. Unsupported or missing business facts stay empty. No example handbook is generated.
- Source validation accepts business context assembled from complete verbatim source sentences, while continuing to reject paraphrased/invented evidence. This fixed a real browser failure where Gemini joined two supported sentences from different parts of the source.
- Output limit is 3,072 tokens; conservative shared token reservations are now 40,000 tokens. Existing user/network/site rate and spending limits remain.

Validation:

- Automated suite: 146 passed, 22 existing skipped, zero failures.
- Hardening suite: 15 passed, one existing skipped, zero failures.
- ESLint, production build, secret scan, and git diff whitespace checks passed.
- Nine real Gemini scenarios passed in the expanded integration run, using 4,555 total tokens. Full company-section extraction included all 11 proposal fields. Sparse Amico name/email input supplied a company-specific greeting and introduced no unsupported hours, routing, holidays, shipping or refunds.
- Real PostgreSQL integration passed shared request protection and encrypted profile persistence in an isolated disposable schema.
- Browser verification on isolated localhost with actual Gemini: blank initial workspace and zero sample documents; real extraction; Select all; Apply populated company name, email, greeting, context, company-information textarea/title, sales routing, timezone, transfer number, Monday–Friday 09:00–17:00, hours enabled, and holiday closure.
- Browser control was then disabled in Work settings, preventing the final visual Save/reload check and screenshot. Automated persistence coverage verifies the existing profile/document save APIs, reloaded profile and knowledge text, and duplicate-note prevention. The browser test used synthetic authentication and bypassed usage reservations; production authentication and limits were covered separately by existing regression/integration tests.

No live user draft or deployed company record was edited during these tests. Users will need the corrected deployment before the cleanup and new field population are available on the live site.
