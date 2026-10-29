# Satuu AI inbox: brief for ChatGPT (connect the shared inbox to the n8n WhatsApp bot)

Everything below is copied from the repository (private repo: usmanovs/satuu-inbox). It contains NO secrets. The integration key and webhook secret are given to you separately by the owner; never ask for or paste Supabase service-role keys.

Rules: change n8n only on a COPY of the workflow. Do not claim the integration works until a real end-to-end test passes. Retries must be OFF on every WhatsApp send node.

---

# Handoff: connect the Satuu AI shared inbox to the n8n WhatsApp bot

Prepared 2026-10-29 from the repository and the deployed Supabase **test** project. No secrets are included. Placeholders: `<PROJECT_REF>`, `<BUSINESS_ID>`, `<INTEGRATION_KEY>`, `<SEND_WEBHOOK_SECRET>`.

**Legend** — IMPLEMENTED: code exists in the repo. DEPLOYED: running in the Supabase test project. TESTED: exercised by a passing test (and against what). MOCKED: stood in by a fake. MISSING: not built or not done.

## 0. Bottom line
- The Supabase side (schema, RLS, SQL functions, two Edge Functions) is IMPLEMENTED, DEPLOYED to a throwaway test project, and TESTED over real HTTP with real Auth/Postgres.
- **Nothing in n8n has been changed, and nothing has been tested against n8n or the WhatsApp Cloud API.** The integration is **not live**.
- The code is in a private GitHub repo and the dashboard is deployed on Vercel (URLs in §1). No owner account exists yet.
- Update (later the same day): added the `claim-human-send` endpoint (database-enforced idempotency for n8n), bound `request-human` to the triggering message (no customer id parameter), and documented batch handling; migration 4 applied and `n8n` function v2 deployed; integration tests now 30/30, unit tests 21/21.
- The test project is currently **empty** of data (test fixtures were removed). A real owner, business and integration key do not exist yet.

## 1. Project access
| Item | State |
|---|---|
| Dashboard URL | **https://satuu-inbox.vercel.app** (Vercel, deployed; live login screen verified; no owner exists yet, so no one can log in). Uses Supabase project `mejaptdkcwxwcetxfdtr`. |
| GitHub repo | **https://github.com/usmanovs/satuu-inbox** (private, branch `main`). |
| Hosting | Vercel (team `seyitbek's projects`, project `satuu-inbox`), deployed by CLI, not yet linked to the Git repo. |
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

---

# n8n integration

**Status: contracts are implemented and tested against a Supabase test project. The n8n workflow changes below have NOT been made or run against your real n8n or WhatsApp number.** Until they are, the dashboard shows «Не подключено» and a conversation state change does not stop your bot.

Base URL for everything below: `https://<project-ref>.supabase.co/functions/v1`

## Authentication

| Caller | Credential | Identity |
|---|---|---|
| n8n → `/n8n/*` | `Authorization: Bearer <integration key>` | The key maps to one business. The payload's `business_id` must equal it, otherwise `403 business_mismatch`. |
| Dashboard → `/inbox/*` | Manager's Supabase JWT | Business and manager come from the JWT + `business_memberships`. Body fields named `business_id` / `user_id` are ignored. |
| Dashboard backend → n8n send webhook | `Authorization: Bearer <N8N_SEND_WEBHOOK_SECRET>` | Shared secret, set as an Edge Function secret. |

In n8n create two **Header Auth** credentials (never paste keys into node parameters):
- `Satuu Supabase` → name `Authorization`, value `Bearer <key from create_integration_key.sql>`
- `Satuu send webhook` → name `Authorization`, value `Bearer <same value as N8N_SEND_WEBHOOK_SECRET>`

Define one workflow-level constant `SATUU_BUSINESS_ID` (from `provision_owner.sql`).

## 1. Incoming message ingestion

`POST /n8n/ingest-message`

```json
{
  "business_id": "1b2c…-uuid",
  "sender_id": "996700123456",
  "provider_message_id": "wamid.HBgMOTk2NzAwMTIzNDU2FQIAEhgg…",
  "type": "text",
  "text": "Сколько стоит курс?",
  "timestamp": "1793276163",
  "display_name": "Айбек",
  "detect_human": true
}
```
`timestamp` accepts unix seconds (as WhatsApp sends), unix ms, or ISO-8601. `text` is `null` for media.

Response `200` (also `200` for a duplicate, with `duplicate: true`):
```json
{
  "duplicate": false,
  "message_id": "…",
  "conversation_id": "…",
  "contact_id": "…",
  "state": "ai_active",
  "state_version": 1,
  "ai_allowed": true,
  "supported": true
}
```
- `supported: false` for image/audio/video/document/sticker/location/…: the message is stored with a placeholder such as `[Изображение — ассистент не обрабатывает изображения]`. **Do not send these to the AI.**
- `type` values `status`, `delivered`, `read`, `sent`, `failed` are refused with `422 not_a_message`. Receipts go to `/message-status`.
- A conservative RU/KY phrase list (e.g. «позовите менеджера», «адам менен сүйлөшкүм») moves an `ai_active` conversation to `human_requested`. Set `detect_human: false` to switch it off.

## 2. AI permission check

`POST /n8n/ai-permission` — call it **twice** per reply.

```json
{ "business_id": "…", "sender_id": "996700123456", "stage": "before_generate" }
```
```json
{ "business_id": "…", "sender_id": "996700123456", "stage": "before_send", "expected_state_version": 1 }
```
Response:
```json
{ "allowed": true, "reason": "ok", "stage": "before_send", "state": "ai_active", "state_version": 1, "checked_at": "2026-10-29T12:16:03Z" }
```
`allowed` is `true` only when `state = ai_active` **and** (if given) `state_version` still equals `expected_state_version`. Reasons: `ok`, `state_human_requested`, `state_human_handling`, `state_changed`, `unknown_conversation` (fails closed).

## 3. Outgoing messages and statuses

**AI reply** (call right after the WhatsApp send node returns the message id): `POST /n8n/record-outbound`
```json
{
  "business_id": "…", "sender": "ai", "sender_id": "996700123456",
  "provider_message_id": "wamid.…", "type": "text",
  "text": "Курс стоит 12 000 сом.", "timestamp": "1793276170", "status": "accepted"
}
```
Send `accepted` here, never `delivered`: the Cloud API returning an id only means the message was accepted for sending. Idempotent on `provider_message_id`.

**Status receipt:** `POST /n8n/message-status`
```json
{ "business_id": "…", "provider_message_id": "wamid.…", "status": "delivered", "timestamp": "1793276175" }
```
```json
{ "business_id": "…", "provider_message_id": "wamid.…", "status": "failed", "timestamp": "1793276175", "error_code": "131047", "error_message": "Re-engagement message" }
```
Statuses move forward only (`accepted → sent → delivered → read`); a late `sent` never overwrites `delivered`; `failed` never overwrites `delivered`/`read`. If the receipt arrives before the message row exists you get `202 {"matched":false,"buffered":true}` and it is applied when the message is recorded. Receipts never create chat messages.

**Explicit human request:** `POST /n8n/request-human`
```json
{ "business_id": "…", "trigger_message_id": "wamid.XXXX", "reason": "Клиент просит оператора" }
```
→ `{ "changed": true, "conversation_id": "…", "state": "human_requested", "state_version": 2 }`

There is **no customer id parameter**. The conversation is derived from `trigger_message_id`, which must be an inbound **customer** message of this business that was ingested within the last 15 minutes (`404 unknown_trigger`, `409 stale_trigger` otherwise). A sender_id sent alongside is ignored. Only `ai_active → human_requested`; it never downgrades `human_handling`. The reason is stored as «Запрос человека (AI): …» (200 chars max).

**Who may call what.** The AI agent must never choose `business_id`, `sender_id`, `trigger_message_id` or any other identifier. Every `/n8n/*` call is made by a **deterministic workflow node** whose values come from the trigger item and the `SATUU_BUSINESS_ID` variable. To let the AI ask for a human, have the agent return a structured flag (for example `{"reply":"…","needs_human":true}`) and let an ordinary IF + HTTP node call `request-human` with the trigger's own message id. Do **not** expose `request-human` (or any `/n8n/*` endpoint) as an HTTP Request *tool* whose parameters the model fills in. Server-side, `request-human` is additionally bound to the triggering message so a model that did call it still could not target another customer.

**Claim a human send (n8n-side idempotency):** `POST /n8n/claim-human-send`
```json
{ "business_id": "…", "idempotency_key": "6f1c0f3e-0b8e-4a39-9d52-5a2d7f6b9c11" }
```
→ first caller: `{ "claimed": true, "message_id": "…", "to": "996700123456", "type": "text", "text": "Здравствуйте!", "template_name": null }`
→ every later caller: `{ "claimed": false, "reason": "already_claimed", "status": "pending" }`
Other reasons: `not_pending` (already accepted/failed), `not_human_handling` (the manager returned the chat to the AI before n8n got to it). Unknown key or another business's key: `404`.
The claim is one row-locked UPDATE in Postgres, so concurrent duplicate deliveries produce exactly one `claimed:true` (verified with 6 parallel calls). **n8n must send exactly the recipient and text returned by the claim, not the webhook body.**

## 4. Human replies (dashboard → n8n)

The dashboard calls `POST /inbox/send-reply` (manager JWT). The function verifies `human_handling`, the 24-hour window, creates a `pending` message, and then calls **your n8n webhook**:

```json
{
  "event": "human_reply",
  "business_id": "…",
  "message_id": "…",
  "idempotency_key": "6f1c…-uuid",
  "to": "996700123456",
  "type": "text",
  "text": "Здравствуйте! Это Азамат, менеджер.",
  "template": null,
  "requested_by": "manager-user-uuid",
  "requested_at": "2026-10-29T12:16:03Z"
}
```
Outside the 24h window `type` is `"template"`, `text` is `null` and `template` is `{ "name": "your_approved_template", "language": "ru" }`.
The same key is also sent as an `Idempotency-Key` header.

How the dashboard interprets the webhook response:

| n8n answers | Message status shown |
|---|---|
| `2xx` | `accepted` («Принято к отправке») — **not** delivered |
| `4xx` | `failed` |
| `5xx`, `408`, timeout, network error | stays `pending` — unknown result, **never retried automatically** |

Then n8n reports the real outcome with `POST /n8n/record-outbound`:
```json
{ "business_id": "…", "sender": "manager", "idempotency_key": "6f1c…", "provider_message_id": "wamid.…", "status": "accepted" }
```
```json
{ "business_id": "…", "sender": "manager", "idempotency_key": "6f1c…", "status": "failed", "error_code": "131026", "error_message": "Message undeliverable" }
```
Delivery then arrives through `/message-status`.

## Webhook batches: every message and every status is processed

A WhatsApp delivery is a batch: `entry[] → changes[] → value`, and one `value` can hold several `messages[]` and several `statuses[]` (and `contacts[]` for the names). Reading `messages[0]` / `statuses[0]` drops the rest. Put the Code node [`n8n/code/flatten-batch.cjs`](../n8n/code/flatten-batch.cjs) straight after the WhatsApp Trigger. It emits **one item per message and one per status**, oldest first, with the right display name per sender, dropping non-actionable statuses (`deleted`, `warning`, …). Every later node then runs once per item, so each message/status is ingested, gated, answered and recorded independently. This is unit-tested (`n8n/code/n8n-code.test.ts`) against a mixed batch, but not inside n8n.

Processing rules for the flattened items:
- Route by `kind`: `status` → `message-status`; `message` → the message branch.
- Use `{{ $json.sender_id }}`, `{{ $json.provider_message_id }}`, … from **the current item**, never `$('Trigger').first()` or `[0]`. For later nodes in the same branch refer to the same item (`$('Flatten').item`).
- A failure on one item must not block the others: enable *Continue On Fail* (or an error output) on the ingest node and stop only that item's branch.
- If two messages from the same customer sit in one batch, both are stored; the AI will run twice. To answer once, add a step that keeps only the newest message per `sender_id` for generation (ingest all, generate for the latest).
- Because Meta may redeliver a batch, every endpoint used here is idempotent (messages by `provider_message_id`, statuses forward-only, AI replies by `provider_message_id`). Replays are safe.

## Required n8n changes (checklist)

> Field expressions assume the n8n WhatsApp Trigger's output shape. **Verify them on one real execution.** Nothing below has been run in n8n.

### A. Main workflow (WhatsApp Trigger → AI Agent → send)
1. **Flatten the batch** with `flatten-batch.cjs` (see above). Then IF `kind = status` → step 9; else → message branch.
2. **Ingest.** HTTP `Ingest message` → `POST …/n8n/ingest-message`, credential `Satuu Supabase`, fields from the current item. *Retry On Fail* **on** (idempotent). *On Error*: stop this item's branch (never fall through to the AI).
3. **Gate 1.** IF `{{ $json.supported && $json.ai_allowed }}`. False → end (optional fixed reply for unsupported media must pass gates 2–3).
4. **Permission before generating.** HTTP `ai-permission` stage `before_generate`; IF `allowed`; keep `state_version`.
5. **AI Agent** (existing). Give it **no** Satuu tools. Ask it for structured output including `needs_human`. After the agent: IF `needs_human` → HTTP `request-human` with `trigger_message_id = {{ $('Flatten').item.json.provider_message_id }}` (deterministic node).
6. **Permission before send.** HTTP `ai-permission` stage `before_send` with `expected_state_version`; IF `allowed`. Nothing slow between this node and the send.
7. **WhatsApp send** (existing). *Retry On Fail* **off**.
8. **Record AI reply.** HTTP `record-outbound` `sender: "ai"`, `provider_message_id` = the wamid returned by the send node, `status: "accepted"`. Retry **on**.
9. **Receipts.** HTTP `message-status` per status item (`provider_message_id`, `status`, `timestamp`, `error_code`, `error_message`). Retry **on**. Receipts never go to `ingest-message`.
10. **Remove** every node that reads or writes the `wa_customers` / `wa_messages` Data Tables (after cutover, see `MIGRATION_PLAN.md`).

### B. New workflow «Human send» (authenticate and validate BEFORE acknowledging; idempotent in n8n)
1. **Webhook** node: `POST`, unguessable path, *Authentication* = Header Auth (`Satuu send webhook`), *Respond* = **Using 'Respond to Webhook' Node**. An unauthenticated caller is rejected by n8n before the workflow runs. Nothing has been acknowledged yet.
2. **Code** `Validate` = [`n8n/code/validate-human-send.cjs`](../n8n/code/validate-human-send.cjs) (event, business id equals `SATUU_BUSINESS_ID`, UUID idempotency key equal to the `Idempotency-Key` header, type `text|template`, sane template language). IF `ok = false` → **Respond to Webhook** with the returned status (`400/403/422`) and stop.
3. **HTTP** `Claim` → `POST …/n8n/claim-human-send` `{ business_id, idempotency_key }`. IF `claimed = false`:
   - `already_claimed` → **Respond** `200 {"accepted":true,"duplicate":true}` and stop (a duplicate delivery is acknowledged but never sent again);
   - `not_human_handling` / `not_pending` → **Respond** `409` and stop (the dashboard shows the message as failed);
   - HTTP 404 → **Respond** `404` and stop.
4. **Respond to Webhook** `200 {"accepted":true}` (only now, after authentication, validation and a successful claim).
5. IF claim `type = template` → WhatsApp **send template** (`template_name` from the claim, language from the validated payload), else WhatsApp **send message** with the claim's `text`; recipient = the claim's `to`. Use the **existing WhatsApp credential**. *Retry On Fail* **off** on both. Do not read recipient or text from the webhook body.
6. Success → HTTP `record-outbound` `{ sender: "manager", idempotency_key, provider_message_id: <wamid>, status: "accepted" }`. Send-node error branch → same endpoint with `status: "failed"`, `error_code`, `error_message`. (Required: the HTTP answer already went out, so this is the only way a failed send becomes visible.)

**Delivery guarantee:** at most once. If n8n crashes after the claim but before the WhatsApp call, the message stays `pending` («Нет подтверждения») and is **not** re-sent automatically; the manager decides. Duplicates are prevented by the database claim, not by the dashboard.

### C. Credentials and secrets
- n8n: Header Auth credentials `Satuu Supabase` and `Satuu send webhook`; variables `SATUU_BUSINESS_ID`, `SATUU_FUNCTIONS_URL`.
- Supabase Edge Function secrets: `N8N_SEND_WEBHOOK_URL`, `N8N_SEND_WEBHOOK_SECRET`, optionally `WA_TEMPLATE_NAME`, `WA_TEMPLATE_LANG`.

## Known races and limits (read before going live)

1. **Check → send gap.** Between «permission before send» and the WhatsApp API call there is still a window (milliseconds to a couple of seconds). A takeover inside it cannot cancel the AI message; it will be sent, recorded as an AI message, and appear in the chat just before the manager's. `state_version` only detects changes made *before* the second check. This is documented, not solved.
2. **Concurrent customer messages.** Two quick messages can start two executions. Both pass the gate and both answer. If that matters, serialize per `sender_id` in n8n (queue mode concurrency or a short debounce).
3. **Unconfirmed human sends.** When n8n returns 5xx or times out, the message stays `pending` («Нет подтверждения» after 60 s). It may or may not have been sent. Nothing retries it. The same idempotency key can be resubmitted safely; a *new* message must be a new key.
4. **Receipts before records.** Handled by buffering (`status_events`), but a receipt for a message that is never recorded (for example an AI send whose `record-outbound` call failed permanently) stays unattached.
5. **`accepted` is not `sent`.** The status moves to `sent`/`delivered` only when Meta's webhook says so. If the status branch (step 9) is not wired, messages stay at «Принято к отправке» forever.
6. **Replies are not cancelled by resume/takeover after they are sent.** Obviously, but worth saying.

---

## Code for n8n Code nodes

### flatten-batch.cjs
```js
// n8n Code node, mode "Run Once for All Items". Place it right after the WhatsApp Trigger.
//
// A WhatsApp webhook delivery is a BATCH: entry[] -> changes[] -> value, and each `value` can hold
// several messages[] AND several statuses[]. Reading only messages[0] / statuses[0] silently drops
// the rest. This node turns the batch into ONE n8n item per message or per status, in timestamp
// order. Everything downstream (ingest, permission check, AI, send, record, receipts) then runs per
// item, so each message/status is processed independently and exactly like a single one.
//
// Accepts either the raw Cloud API body ({ entry: [...] }) or the n8n WhatsApp Trigger's output
// (the `value` object: { messages, contacts, statuses }). Verify the shape on one real execution.

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

function textOf(m) {
  if (m.type === 'text') return m.text?.body ?? null;
  if (m.type === 'button') return m.button?.text ?? null;
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  return m[m.type]?.caption ?? null; // image/video/document caption, otherwise null
}

function valuesOf(json) {
  if (json?.body?.entry) return valuesOf(json.body); // webhook node wraps the payload in `body`
  if (json?.entry) {
    return json.entry.flatMap((e) =>
      (e.changes ?? []).filter((c) => !c.field || c.field === 'messages').map((c) => c.value ?? {}));
  }
  return [json ?? {}];
}

function flattenBatch(jsonItems) {
  const out = [];
  for (const json of jsonItems) {
    for (const v of valuesOf(json)) {
      const names = new Map((v.contacts ?? []).map((c) => [String(c.wa_id), c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        out.push({
          kind: 'message', sender_id: String(m.from), provider_message_id: m.id, type: m.type ?? 'text',
          text: textOf(m), timestamp: m.timestamp, display_name: names.get(String(m.from)) ?? null,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!STATUSES.has(s.status)) continue; // ignore 'deleted', 'warning', ...
        const e = s.errors?.[0];
        out.push({
          kind: 'status', provider_message_id: s.id, status: s.status, timestamp: s.timestamp,
          error_code: e?.code != null ? String(e.code) : null, error_message: e?.title ?? e?.message ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)); // stable
}

if (typeof module !== 'undefined') module.exports = { flattenBatch };

// --- n8n wrapper (uncomment inside the Code node; delete the module.exports line above) ---
// return flattenBatch($input.all().map((i) => i.json)).map((json) => ({ json }));
```

### validate-human-send.cjs
```js
// n8n Code node placed right after the "Human send" Webhook node, BEFORE anything is acknowledged
// or sent. (The Webhook node's Header Auth credential already rejects unauthenticated callers with
// 403 before the workflow runs; this validates the shape and the business.)
//
// On { ok: false } route to a "Respond to Webhook" node that returns { status, error }.
// On { ok: true } continue to the claim-human-send HTTP node. The recipient and the text are NOT
// taken from this body: they come back from claim-human-send (the database is the authority).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateHumanSend(body, expectedBusinessId, headerKey) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'invalid_body' };
  if (body.event !== 'human_reply') return { ok: false, status: 422, error: 'invalid_event' };
  if (!expectedBusinessId || body.business_id !== expectedBusinessId) return { ok: false, status: 403, error: 'business_mismatch' };
  if (typeof body.idempotency_key !== 'string' || !UUID.test(body.idempotency_key)) return { ok: false, status: 422, error: 'invalid_idempotency_key' };
  if (headerKey !== undefined && headerKey !== body.idempotency_key) return { ok: false, status: 422, error: 'idempotency_key_mismatch' };
  if (body.type !== 'text' && body.type !== 'template') return { ok: false, status: 422, error: 'invalid_type' };
  let templateLanguage = null;
  if (body.type === 'template') {
    templateLanguage = body.template?.language;
    if (typeof templateLanguage !== 'string' || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(templateLanguage)) {
      return { ok: false, status: 422, error: 'invalid_template_language' };
    }
  }
  return { ok: true, value: { idempotency_key: body.idempotency_key, type: body.type, template_language: templateLanguage } };
}

if (typeof module !== 'undefined') module.exports = { validateHumanSend };

// --- n8n wrapper (uncomment inside the Code node; delete the module.exports line above) ---
// const body = $input.first().json.body;
// const headerKey = $input.first().json.headers?.['idempotency-key'];
// return [{ json: validateHumanSend(body, $vars.SATUU_BUSINESS_ID, headerKey) }];
```
