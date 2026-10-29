# Satuu AI — shared inbox (MVP)

Private manager dashboard for the Satuu AI WhatsApp sales assistant. A manager monitors AI ↔ customer conversations, takes a conversation over, replies from the **same** WhatsApp business number (through n8n), and hands it back to the AI.

One business, one WhatsApp number, one manager account. Russian interface.

```
 WhatsApp Cloud API ──► n8n ──► Supabase Edge Function `n8n`  ──► Postgres (source of truth)
                         ▲  ▲        ingest · ai-permission · record-outbound · message-status
                         │  └───────── asks "may the AI answer?" before generating and before sending
                         │
   (human reply)  Edge Function `inbox` ◄── React dashboard (Supabase Auth + Realtime reads under RLS)
        └──► protected n8n webhook ──► existing WhatsApp credential/number
```

Stack: React + TypeScript + Tailwind v4 + shadcn/ui-style components, Supabase Auth / Postgres / Realtime, Supabase Edge Functions (Deno).

## Documents
- [`docs/PROVISIONING.md`](docs/PROVISIONING.md) — create the owner account, keys, secrets, deploy, run
- [`docs/N8N_INTEGRATION.md`](docs/N8N_INTEGRATION.md) — contracts with example JSON, the exact n8n workflow changes, known races
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — which Supabase project, GitHub push, dashboard deploy, remaining steps
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — technical handoff (implemented / deployed / tested / mocked / missing)
- [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md) — replacing the n8n Data Tables with Supabase (no dual source of truth)

## Layout
```
supabase/migrations/   schema, RLS, server-side SQL functions
supabase/functions/    n8n (integration contracts), inbox (dashboard backend), _shared
supabase/provisioning/ owner + integration key + one-time import templates
supabase/tests/        fixtures, cleanup, test-only mock webhook
src/                   React app (live backend, demo backend, components)
tests/                 integration tests (run against a throwaway Supabase project)
```

## What works (verified)

Verified against a throwaway Supabase project (`mejaptdkcwxwcetxfdtr`) with 30 passing integration tests, and 21 unit tests; typecheck and production build are clean.

| Area | Verified behaviour |
|---|---|
| Access | Unauthenticated REST access to every table is denied; dashboard functions reject no token, the anon key, and a user with no membership; n8n endpoints reject missing/wrong keys and a `business_id` that doesn't match the key |
| Isolation | Business B cannot read or act on business A's contacts/conversations/messages; the same WhatsApp number in two businesses stays separate; users cannot insert memberships or write state from the browser |
| Idempotency | Duplicate inbound events (same `provider_message_id`) produce one message row (DB `UNIQUE` constraint); AI-reply recording is idempotent too |
| Receipts | Statuses only update `status`, never create messages; `status`/`delivered`/`read` sent to the ingest endpoint are refused; early receipts are buffered and replayed; late `sent` can't overwrite `delivered` |
| AI gate | Takeover blocks `ai-permission` (both stages); resume allows it again; a takeover+resume between the two checks is detected via `state_version`; unknown conversations fail closed; opening/reading a chat doesn't change state |
| Human request | Phrases like «Позовите менеджера» set `human_requested` (AI blocked); «3 человека» does not; `request-human` never downgrades `human_handling` |
| Human replies | Refused unless `human_handling` (409); free text refused outside the 24 h window (422) while a template is accepted; same idempotency key never produces a second send (the mock webhook saw 12 calls for 12 keys); n8n `4xx` → `failed`, `5xx`/timeout → stays `pending`, `2xx` → `accepted` (never `delivered`); with n8n unconfigured the real function answers `503 not_connected` and creates nothing |
| Media | Image/audio get an honest placeholder, flagged `is_placeholder`, `supported:false` |
| UI | Desktop two-pane and mobile list → full-screen chat verified in a browser (demo mode); filters, search, unread dot, state badges, distinct customer/AI/manager bubbles, delivery ticks, pending/failed states, 24 h notice |

The UI's *live* mode (login + Realtime) was type-checked and built but **not clicked through in a browser**, because no real owner account exists yet. The demo mode was.

## What is mocked
- **Demo mode** (`npm run dev:demo`): in-memory fictional data, no network, no Supabase, cannot send. Clearly bannered «ДЕМО».
- **The n8n send webhook in tests**: `mock-n8n` / `inbox-selftest` (test-only). No real WhatsApp message was ever sent.

## What is NOT done / not verified
- **No n8n workflow has been changed or run.** Every item in `docs/N8N_INTEGRATION.md` («Required n8n changes») is still to do. Until then the dashboard shows «n8n: не подключено», and **taking over a conversation does not stop your existing bot.**
- **Nothing was tested with the real WhatsApp Cloud API**: payload field names in the n8n expressions are assumptions to confirm on one real execution.
- **Edge Function secrets are not set** in the test project (the MCP tooling can't set them), so the production `inbox` function correctly reports «not connected». The send path was exercised only through the test-only copy.
- **Live-mode login/Realtime UI** not exercised in a browser (see above). Realtime subscriptions were not tested at all; the UI also polls every 30 s as a fallback.
- Template sending outside the 24 h window uses one configured template name with no variables. Template approval in Meta is yours to do.
- `import_from_n8n_data_tables.sql` is an untested template.
- The functions on the test project were deployed through an API with comments stripped; the files in this repo are the source of truth (`supabase functions deploy`).

## Remaining n8n changes
See the checklist in [`docs/N8N_INTEGRATION.md`](docs/N8N_INTEGRATION.md#required-n8n-changes-checklist): split messages from receipts; ingest; gate 1; permission before generate; `request_human` tool; permission before send; WhatsApp send with retries off; record AI reply; status branch; remove Data Table nodes; new «Human send» workflow; two Header Auth credentials.

## Security notes
- Service-role key and n8n secrets exist only as Edge Function secrets; `.env.example` contains placeholders only; only the public URL and anon key reach the browser.
- Business and manager identity are derived from the JWT/membership (dashboard) or the integration key (n8n), never from client-supplied fields.
- Supabase advisor, after the migrations: `integration_keys`/`status_events` have RLS with no policies on purpose (service role only); `is_business_member` is callable by signed-in users on purpose (RLS helper, reveals only their own membership); enable leaked-password protection in Auth settings (plan-dependent).
- `status_events` grows without bound; add retention when volume justifies it.

## Product limits (by design for the MVP)
One business, one manager; no pagination beyond the latest 200 conversations / 500 messages per chat; text only (media shows as placeholders); no team invitations, billing, analytics, voice transcription, knowledge editor, or WhatsApp Business app Coexistence.
