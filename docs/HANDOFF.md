# Handoff: connect the Satuu AI shared inbox to the n8n WhatsApp bot

Prepared 2026-10-29 from the repository and the deployed Supabase **test** project. No secrets are included. Placeholders: `<PROJECT_REF>`, `<BUSINESS_ID>`, `<INTEGRATION_KEY>`, `<SEND_WEBHOOK_SECRET>`.

**Legend** — IMPLEMENTED: code exists in the repo. DEPLOYED: running in the Supabase test project. TESTED: exercised by a passing test (and against what). MOCKED: stood in by a fake. MISSING: not built or not done.

## 0. Bottom line
- The Supabase side (schema, RLS, SQL functions, two Edge Functions) is IMPLEMENTED, DEPLOYED to a throwaway test project, and TESTED over real HTTP with real Auth/Postgres.
- **Nothing in n8n has been changed, and nothing has been tested against n8n or the WhatsApp Cloud API.** The integration is **not live**.
- There is **no deployed dashboard, no GitHub repository, no hosting configured** (no GitHub/hosting access was available; see `docs/DEPLOY.md`). The code is a local git repo with no remote.
- Update (later the same day): added the `claim-human-send` endpoint (database-enforced idempotency for n8n), bound `request-human` to the triggering message (no customer id parameter), and documented batch handling; migration 4 applied and `n8n` function v2 deployed; integration tests now 30/30, unit tests 21/21.
- The test project is currently **empty** of data (test fixtures were removed). A real owner, business and integration key do not exist yet.

## 1. Project access
| Item | State |
|---|---|
| Dashboard URL | **MISSING** — not deployed. It would use Supabase project `mejaptdkcwxwcetxfdtr` ("Satuu AI"). Run locally (`npm run dev`) or deploy `dist/` (`docs/DEPLOY.md`). |
| GitHub repo | **MISSING** — local repo only: `/Users/seyitbek/Sales Super Bot`, branch `main`, commit `40b86a2`. Push to a remote or share the folder. |
| Hosting | **MISSING** — none chosen. The app is a static Vite build (any static host) plus Supabase for backend. |
| Stack | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui-style components; Supabase Auth, Postgres, Realtime, Edge Functions (Deno). |

Key paths: `supabase/migrations/*.sql` · `supabase/functions/n8n/index.ts` · `supabase/functions/inbox/index.ts` · `supabase/functions/_shared/{lib,pure}.ts` · `supabase/provisioning/*.sql` · `src/lib/{liveBackend,demoBackend,types,format}.ts` · `src/components/*` · `tests/integration.test.mjs` · `docs/{PROVISIONING,N8N_INTEGRATION,MIGRATION_PLAN}.md` · `.env.example` · `supabase/.env.functions.example`.

Setup: see `docs/PROVISIONING.md` (migrate → create user → `provision_owner.sql` → `create_integration_key.sql` → secrets → deploy functions → `.env.local` → `npm run dev`).

**Owner/manager account** (IMPLEMENTED, not yet done for a real business): create the user in Supabase Dashboard → Authentication → Users (password set there, never in code); turn off public sign-ups; run `supabase/provisioning/provision_owner.sql` (edit email + business name) as the database owner. That inserts `businesses` + `business_memberships` and prints `<BUSINESS_ID>`. Users cannot self-join: `business_memberships` has no INSERT/UPDATE/DELETE policy and `authenticated` only has `SELECT`.

## 2. Database
Project URL: `https://<PROJECT_REF>.supabase.co` (test project ref: `mejaptdkcwxwcetxfdtr`, region ap-south-1, name "Satuu AI"). Anon key: obtain from Dashboard → Settings → API (public, but not included here).

Migrations (repo files; applied to the test project via the Supabase API, so its migration history names differ — `20261029121313 core_schema`, `…121323 rls`, `…121404 functions`; for a fresh project use `supabase db push`):
1. `supabase/migrations/20261029000001_core_schema.sql`
2. `supabase/migrations/20261029000002_rls.sql`
3. `supabase/migrations/20261029000003_functions.sql`

### Tables (public)
- **businesses**: `id uuid pk`, `name text`, `last_ai_check_at timestamptz`, `last_ingest_at timestamptz`, `created_at`
- **business_memberships**: `id`, `business_id → businesses`, `user_id → auth.users`, `role text CHECK ('owner')`, `created_at`; `UNIQUE(business_id,user_id)`
- **integration_keys**: `id`, `business_id`, `label`, `key_hash text UNIQUE` (SHA-256 hex; plain key never stored), `created_at`, `revoked_at`
- **contacts**: `id`, `business_id`, `wa_id text` (len 3–64), `display_name`, `created_at`; `UNIQUE(business_id,wa_id)`, `UNIQUE(id,business_id)`
- **conversations**: `id`, `business_id`, `contact_id`, `state`, `state_version int`, `state_updated_at`, `state_updated_by → auth.users`, `state_note`, `last_inbound_at`, `last_message_at`, `last_message_preview`, `manager_last_read_at`, `created_at`; `UNIQUE(business_id,contact_id)`, `UNIQUE(id,business_id)`; composite FK `(contact_id,business_id) → contacts(id,business_id)`
- **messages**: `id`, `business_id`, `conversation_id`, `provider_message_id text`, `idempotency_key text`, `sender_role`, `sender_user_id → auth.users`, `direction`, `message_type`, `body`, `is_placeholder bool`, `template_name`, `message_timestamp`, `status`, `status_updated_at`, `error_code`, `error_message`, `created_at`; composite FK `(conversation_id,business_id) → conversations(id,business_id)`
  - `UNIQUE(business_id, provider_message_id)` ← WhatsApp message-id dedupe (`messages_provider_id_unique`)
  - `UNIQUE(business_id, idempotency_key)` ← human-send dedupe
  - CHECKs: `sender_role IN ('customer','ai','manager')`; `direction IN ('inbound','outbound')`; `(sender_role='customer') = (direction='inbound')`; inbound rows must be `status='received'`
- **status_events**: buffer for receipts that arrive before their message; `UNIQUE(business_id,provider_message_id,status)`

**Exact state values** (`conversations.state` CHECK): `ai_active`, `human_requested`, `human_handling`.
**Exact message statuses**: `received` (inbound only), `pending`, `accepted`, `sent`, `delivered`, `read`, `failed`.

### Row-level security (verified in the deployed DB)
RLS enabled on all 7 tables. Policies (all `SELECT … TO authenticated`):
- `businesses_select` using `is_business_member(id)`
- `memberships_select_own` using `user_id = (select auth.uid())`
- `contacts_select`, `conversations_select`, `messages_select` using `is_business_member(business_id)`
- `integration_keys`, `status_events`: RLS on, **no policies** (service role only)
No INSERT/UPDATE/DELETE policies exist; table privileges for `anon`/`authenticated` were revoked except `SELECT` for `authenticated` on the five tables above. All writes go through SECURITY DEFINER SQL functions callable by `service_role` only (the Edge Functions).

**Realtime**: CONFIGURED — `conversations`, `messages`, `contacts` are in the `supabase_realtime` publication (verified). The client subscription is IMPLEMENTED (`src/lib/liveBackend.ts`) but **NOT TESTED**; the UI also polls every 30 s.

**Business membership** is assigned only by `provision_owner.sql` (see §1). n8n's business is determined by its integration key (`integration_keys.business_id`).

## 3. Integration contract
Base: `https://<PROJECT_REF>.supabase.co/functions/v1`. Source: `supabase/functions/n8n/index.ts` (+ `_shared/lib.ts` auth, `_shared/pure.ts` validation) and SQL in `…000003_functions.sql`. All `/n8n/*` routes: `POST`, `Content-Type: application/json`, header `Authorization: Bearer <INTEGRATION_KEY>`. The key resolves to one business; body `business_id` **must equal** it (else `403 business_mismatch`). Errors: `{"error":{"code":"…","message":"…"}}`; `401` bad/missing key; `422` validation.

All of these are IMPLEMENTED + DEPLOYED (test project) + TESTED over HTTP by `tests/integration.test.mjs` — **with synthetic payloads, not real WhatsApp traffic.**

### 3.1 Incoming customer message — `POST /n8n/ingest-message`
```json
{ "business_id": "<BUSINESS_ID>", "sender_id": "996700123456", "provider_message_id": "wamid.XXXX",
  "type": "text", "text": "Сколько стоит курс?", "timestamp": "1793276163", "display_name": "Айбек", "detect_human": true }
```
→ `200`
```json
{ "duplicate": false, "message_id": "…", "conversation_id": "…", "contact_id": "…",
  "state": "ai_active", "state_version": 1, "ai_allowed": true, "supported": true }
```
Duplicate `provider_message_id` → `200` with `"duplicate": true`, no new row. `type` of `status|statuses|receipt|delivery|sent|delivered|read|failed` → `422 not_a_message`. Non-text types (`image`, `audio`, …) are stored with a placeholder body and `supported:false` — **do not pass these to the AI**. A conservative RU/KY phrase list can set `human_requested` automatically (`detect_human:false` disables).

### 3.2 May the AI reply? — `POST /n8n/ai-permission` (call before generating and again right before sending)
```json
{ "business_id": "<BUSINESS_ID>", "sender_id": "996700123456", "stage": "before_send", "expected_state_version": 1 }
```
→ `200` `{ "allowed": true, "reason": "ok", "stage": "before_send", "state": "ai_active", "state_version": 1, "checked_at": "…" }`
`allowed` is true only if `state='ai_active'` and (when given) `state_version` is unchanged. Reasons: `ok`, `state_human_requested`, `state_human_handling`, `state_changed`, `unknown_conversation` (fails closed). `stage` ∈ `before_generate|before_send`.

### 3.3 Outgoing AI message — `POST /n8n/record-outbound`
```json
{ "business_id": "<BUSINESS_ID>", "sender": "ai", "sender_id": "996700123456", "provider_message_id": "wamid.YYYY",
  "type": "text", "text": "Курс стоит 12 000 сом.", "timestamp": "1793276170", "status": "accepted" }
```
→ `200` `{ "duplicate": false, "message_id": "…", "conversation_id": "…" }`. Send `accepted` (the API took it), never `delivered`.

### 3.4 Delivery / read / failure — `POST /n8n/message-status`
```json
{ "business_id": "<BUSINESS_ID>", "provider_message_id": "wamid.YYYY", "status": "delivered", "timestamp": "1793276175" }
```
`status` ∈ `sent|delivered|read|failed` (`failed` accepts `error_code`, `error_message`). → `200 {"matched":true,"applied":true}`; if the message isn't recorded yet → `202 {"matched":false,"buffered":true}` (applied later). Statuses only move forward; never creates a chat message.

### 3.5 Explicit "customer wants a human" — `POST /n8n/request-human`
`{ "business_id": "…", "trigger_message_id": "wamid.XXXX", "reason": "…" }` → `{ "changed": true, "conversation_id": "…", "state": "human_requested", "state_version": 2 }`.
**No customer id parameter:** the conversation is derived from `trigger_message_id`, which must be an inbound customer message of this business ingested in the last 15 minutes (`404 unknown_trigger`, `409 stale_trigger`). A `sender_id` in the body is ignored. Only `ai_active → human_requested`. The AI agent must not fill in any identifier: call this from a deterministic node using the trigger item's own message id (see `docs/N8N_INTEGRATION.md`). TESTED live: a smuggled other-customer `sender_id` leaves that customer untouched; unknown, outbound and other-business ids are refused.

### 3.5b Claim a human send — `POST /n8n/claim-human-send` (n8n-side idempotency)
`{ "business_id": "…", "idempotency_key": "<uuid>" }` → first call `{ "claimed": true, "to": "996700123456", "type": "text", "text": "…", "template_name": null }`; later calls `{ "claimed": false, "reason": "already_claimed" }` (also `not_pending`, `not_human_handling`). One row-locked UPDATE in Postgres: 6 parallel claims → exactly 1 winner (TESTED live). n8n must send the recipient/text returned by the claim, not the webhook body. Source: `supabase/functions/n8n/index.ts`, SQL `claim_human_send` in `…000004_…sql`.

### 3.6 Manager takeover / resume — dashboard only, NOT an n8n endpoint
`POST /inbox/conversation-action`, header `Authorization: Bearer <manager JWT>` (+ `apikey: <anon key>`), body `{ "conversation_id": "<uuid>", "action": "takeover" | "resume" | "mark_read" }` → `{ "changed": true, "conversation_id": "…", "state": "human_handling", "state_version": 2, "state_updated_at": "…" }`. Source: `supabase/functions/inbox/index.ts` → SQL `set_conversation_state`. n8n observes the result through §3.2. n8n must **not** call this.

### 3.7 Human reply from the same WhatsApp number
Two halves:
1. **Dashboard → Supabase** (IMPLEMENTED, DEPLOYED, TESTED against a mock n8n): `POST /inbox/send-reply` (manager JWT), body `{ "conversation_id": "<uuid>", "idempotency_key": "<uuid>", "text": "…", "use_template": false }`. Server checks `human_handling`, the 24 h window, inserts a `pending` message, then calls n8n. Replies: `200 {"ok":true,"status":"accepted","message":{…}}`; `202 {"ok":false,"status":"pending","unconfirmed":true}`; `502 {"ok":false,"status":"failed",…}`; `503 not_connected` / `template_not_configured` (nothing created); `409 not_human_handling`; `422 window_closed`.
2. **Supabase → n8n webhook** (**MISSING in n8n — must be created**; it must authenticate and validate before acknowledging, then `claim-human-send` before sending, see `docs/N8N_INTEGRATION.md` §B and `n8n/code/validate-human-send.cjs`): the function POSTs to `N8N_SEND_WEBHOOK_URL` with `Authorization: Bearer <SEND_WEBHOOK_SECRET>` and `Idempotency-Key: <uuid>`:
```json
{ "event": "human_reply", "business_id": "<BUSINESS_ID>", "message_id": "…", "idempotency_key": "<uuid>",
  "to": "996700123456", "type": "text", "text": "Здравствуйте!", "template": null,
  "requested_by": "<manager user id>", "requested_at": "2026-10-29T12:16:03Z" }
```
(outside the 24 h window: `"type":"template","text":null,"template":{"name":"<WA_TEMPLATE_NAME>","language":"ru"}`). The webhook must answer `2xx` immediately; `4xx` = definite failure; `5xx`/timeout leaves the message `pending` (never auto-retried). Then n8n reports back with `POST /n8n/record-outbound`:
`{ "business_id":"…", "sender":"manager", "idempotency_key":"<uuid>", "provider_message_id":"wamid.ZZZ", "status":"accepted" }` or `…"status":"failed","error_code":"…","error_message":"…"`.

### 3.8 Dashboard status — `GET /inbox/status` (manager JWT)
→ `{ "send_configured": false, "template_configured": false, "last_ai_check_at": null, "last_ingest_at": null }`. Drives the «Не подключено» UI.

### Endpoints that still must be created in n8n
1. **Human-send webhook workflow** (the §3.7 receiver). Nothing else on the Supabase side is missing.
2. HTTP Request nodes in the main workflow calling §3.1–3.5b (these are *clients* of existing endpoints, not new endpoints).
3. A Code node that flattens webhook batches (`n8n/code/flatten-batch.cjs`) so every message and status is processed, not just `messages[0]` / `statuses[0]`.

## 4. n8n configuration
| Name | Where | Purpose | Configured? |
|---|---|---|---|
| `Satuu Supabase` (Header Auth: `Authorization: Bearer <INTEGRATION_KEY>`) | n8n credential | Auth for all `/n8n/*` calls | **No** (key not yet created) |
| `Satuu send webhook` (Header Auth: `Authorization: Bearer <SEND_WEBHOOK_SECRET>`) | n8n credential, on the Webhook node | Authenticates Supabase → n8n human sends | **No** |
| `SATUU_BUSINESS_ID` | n8n workflow variable / Set node | `business_id` in every payload | **No** (no real business yet) |
| `SATUU_FUNCTIONS_URL` = `https://<PROJECT_REF>.supabase.co/functions/v1` | n8n variable | Base URL | **No** |
| Existing WhatsApp Cloud API credential | n8n credential | Sends from the business number (reused by Human-send workflow) | Exists per the team; **not inspected** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function env | Auto-injected by Supabase | Auto (platform) |
| `N8N_SEND_WEBHOOK_URL` | Supabase Edge Function secret | Where `inbox` sends human replies | **No** (`send_configured:false` observed) |
| `N8N_SEND_WEBHOOK_SECRET` | Supabase Edge Function secret | Must equal `<SEND_WEBHOOK_SECRET>` | **No** |
| `WA_TEMPLATE_NAME`, `WA_TEMPLATE_LANG` | Supabase Edge Function secret | Approved template for sends outside the 24 h window | **No** |
| `ALLOWED_ORIGIN` | Supabase Edge Function secret (optional) | CORS lock to the dashboard origin | No |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Dashboard build env (`.env.local`) | Public URL + anon key for the browser | No |
| `VITE_DEMO_MODE` | Dashboard build env | `true` = fictional data, never sends | Unset (live) |

### Required workflow changes
Expressions assume the n8n WhatsApp Trigger output (`messages[0].from|id|type|text.body|timestamp`, `contacts[0].profile.name`, `statuses[0].…`). **Unverified — check against one real execution.** Details and settings in `docs/N8N_INTEGRATION.md`.
1. **WhatsApp Trigger** → Code `flatten-batch.cjs` (one item per message/status, oldest first) → IF `kind=status` → receipt branch (step 8); else message branch. Never read `[0]`.
2. **Store incoming**: HTTP `ingest-message` (retry-on-fail ON: idempotent; on error stop, never continue to AI).
3. **Check state**: IF `supported && ai_allowed`; then HTTP `ai-permission` stage `before_generate`; IF `allowed`; keep `state_version`.
4. **Generate**: existing AI Agent with **no** Satuu tools; have it return `needs_human`, then a deterministic IF + HTTP node calls `request-human` with `trigger_message_id` from the trigger item.
5. **Recheck**: HTTP `ai-permission` stage `before_send` with `expected_state_version`; IF `allowed`; nothing slow between this and step 6.
6. **Send**: existing WhatsApp send node; **Retry On Fail OFF**.
7. **Store outgoing**: HTTP `record-outbound` `sender:"ai"`, `provider_message_id` = wamid returned by the send node, `status:"accepted"`.
8. **Receipts, separately**: IF status ∈ `sent|delivered|read|failed` → HTTP `message-status`. Receipts never go to `ingest-message`.
9. **New workflow «Human send»**: Webhook (POST, Header Auth, *Respond using Respond-to-Webhook node*) → Code `validate-human-send.cjs` (reject `400/403/422` before anything is acknowledged) → HTTP `claim-human-send` (duplicate → ack `200 duplicate`, never send; `not_human_handling` → `409`) → Respond `200` → WhatsApp template/text node using the **claim's** `to`/`text` (existing credential, retry OFF) → HTTP `record-outbound` `sender:"manager"` (success: `accepted` + wamid; error branch: `failed`).
10. **Delete** all nodes reading/writing the `wa_customers`/`wa_messages` Data Tables (after cutover, §5).

## 5. Data migration
| n8n Data Table column | Supabase |
|---|---|
| `wa_customers.sender_id` | `contacts.wa_id` |
| `wa_customers.display_name` | `contacts.display_name` |
| `wa_customers.state` | `conversations.state` (same 3 values) |
| `wa_customers.state_updated_at`, `state_note` | `conversations.state_updated_at`, `state_note` |
| `wa_customers.last_inbound_at`, `last_message_preview` | `conversations.last_inbound_at`, `last_message_preview` (also seeds `last_message_at`) |
| `wa_messages.provider_message_id` | `messages.provider_message_id` (unique per business) |
| `wa_messages.sender_id` | via `contacts` → `messages.conversation_id` |
| `wa_messages.direction` | `messages.direction` + `sender_role` (`inbound`→`customer`; `outbound`→`ai`, since history can't distinguish a human) |
| `wa_messages.body`, `message_timestamp` | `messages.body`, `message_timestamp` |
| `wa_messages.status` | `messages.status` (imported outbound → `accepted`; inbound → `received`) |

**Switchover without competing stores** (`docs/MIGRATION_PLAN.md`): build the new workflow as an inactive copy → deactivate old workflow → export both tables → run `supabase/provisioning/import_from_n8n_data_tables.sql` (**untested template**, `ON CONFLICT DO NOTHING`) → activate the new workflow → smoke-test → retire the Data Tables. No dual write, no sync. Rollback = reactivate the old workflow; messages received meanwhile exist only in Supabase.

## 6. Verification (what was actually run)
Run: 30 integration tests (23 original + 7 for request-human binding and claim-human-send) (`tests/integration.test.mjs`) against the **deployed Supabase test project** over real HTTPS (real Auth login, real PostgREST/RLS, real Edge Functions, real Postgres), all passing; plus 21 unit tests (`npm test`, including the n8n batch/validation snippets); typecheck and production build clean. The test project data was deleted afterwards, so these are not re-runnable until `supabase/tests/fixtures.sql` is applied again.

| Requirement | Result | Level |
|---|---|---|
| Login and access isolation | Password login for 3 users works; anon/unauthenticated REST denied on all 7 tables; user without membership → `403`; business B can't read/act on A; same `wa_id` in two businesses stays separate; users can't insert memberships or write state | **Live** (Supabase). UI login screen **not** browser-tested |
| Incoming messages appear in the inbox | Ingested rows are readable by the manager under RLS | **Live** for data. UI rendering was verified only in **demo mode** with fictional data; live rendering and Realtime push **not tested** |
| Duplicate prevention | Same `provider_message_id` ×3 → 1 row (`duplicate:true`) | **Live** (Supabase), synthetic events |
| Takeover pausing AI | After takeover `ai-permission` → `allowed:false` at both stages; `state_version` change between checks → `state_changed` | **Live** for the gate. **Whether the n8n bot actually stays silent: NOT tested** (n8n not connected) |
| Human replies | Refused unless `human_handling`; success path → `accepted`; n8n 4xx → `failed`; 5xx/timeout → `pending`; same key never re-sent (mock saw 12 calls / 12 keys); unconfigured → `503` and nothing created | **MOCKED n8n** (`mock-n8n` + `inbox-selftest`). Real n8n/WhatsApp send: **NOT tested** |
| Resume AI | `ai-permission` → `allowed:true` after resume | **Live** for the gate; real bot behaviour **NOT tested** |
| Delivery status | `accepted`→`sent`→`delivered`→`read` forward-only; late `sent` ignored; `failed` recorded with code; early receipt buffered and replayed; receipts never create messages | **Live**, with synthetic receipts — **no real Meta receipts** |
| 24 h window | Conversation with last inbound 30 h ago: free text → `422 window_closed`; template accepted | **MOCKED n8n**, synthetic timestamp. Real template send **NOT tested** (no approved template configured) |

## 7. Unresolved blockers and smallest end-to-end checklist
Blockers: (a) no real Supabase project/business/owner/integration key; (b) Edge Function secrets unset; (c) n8n human-send webhook doesn't exist, so no URL yet; (d) no dashboard deployment or repo remote; (e) n8n trigger field shapes unverified; (f) no approved WhatsApp template (only needed for the window test); (g) n8n must be reachable from Supabase over public HTTPS; (h) `mock-n8n` and `inbox-selftest` are still deployed on the test project and should be deleted (the test table they need was dropped).

Smallest ordered checklist for **one** end-to-end test:
1. Pick the project (recommended: a new dedicated Supabase project); `supabase db push`.
2. Create the manager user; disable sign-ups; run `provision_owner.sql` → `<BUSINESS_ID>`.
3. Run `create_integration_key.sql` → create n8n credential `Satuu Supabase`.
4. `supabase functions deploy n8n --no-verify-jwt` and `supabase functions deploy inbox` (from the repo).
5. In n8n, on a **copy** of the workflow: add trigger split, `ingest-message`, both permission checks, `record-outbound`, receipt branch (§4 steps 1–8). Retries OFF on the send node.
6. Send a message from a personal WhatsApp number → bot replies; check it and the AI reply appear in the dashboard (`npm run dev` with `.env.local`), and delivery status advances beyond «Принято к отправке».
7. Build the «Human send» workflow; set `N8N_SEND_WEBHOOK_URL` / `N8N_SEND_WEBHOOK_SECRET` via `supabase secrets set`.
8. In the dashboard press «Взять диалог»; send another customer message → **bot must stay silent**; reply from the dashboard → arrives **from the business number**; status goes accepted → sent → delivered.
9. Press «Вернуть AI»; next customer message → bot answers again.
10. (Optional, needs an approved template + `WA_TEMPLATE_NAME`) test the >24 h window with an idle number.

Known unsolved race: an AI reply can still be sent in the gap between the final `before_send` check and the WhatsApp API call (documented in `docs/N8N_INTEGRATION.md`, not solved).
