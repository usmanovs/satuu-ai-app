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
  "phone_number_id": "123456789012345",
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
  "supported": true,
  "human_requested_now": false
}
```
- `phone_number_id` (optional, digits only) is the Cloud API id of the business number from the trigger's metadata. The backend remembers it, and `claim-human-send` returns it, so human replies are sent from the SAME number. Until one inbound message with it has been ingested, `claim-human-send` answers `claimed:false, reason:phone_number_unknown` (without consuming the claim).
- `human_requested_now` is `true` only when THIS message moved the chat `ai_active → human_requested` (phrase detection). Use it to send the customer one notice; duplicates and later messages in a paused chat return `false`.
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
→ first caller: `{ "claimed": true, "message_id": "…", "to": "996700123456", "type": "text", "text": "Здравствуйте!", "template_name": null, "phone_number_id": "123456789012345" }`
→ every later caller: `{ "claimed": false, "reason": "already_claimed", "status": "pending" }`
Other reasons: `phone_number_unknown`, `not_pending` (already accepted/failed), `not_human_handling` (the manager returned the chat to the AI before n8n got to it). Unknown key or another business's key: `404`.
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

## Built in n8n (2026-10-29) — inactive, untested

Two workflows exist in n8n, both **inactive**. Nothing was run.
- **Satuu Inbox Integration - Stage A** (copy of the bot): flatten → ingest → permission before generate → AI Agent → permission before send → send AI reply (retries off) → record (`accepted`); receipts → `message-status`; one-time notice when `human_requested_now`. The old Data Table nodes remain on the canvas, disconnected.
- **Satuu Human Send**: Webhook → Validate → `claim-human-send` → respond → WhatsApp send (retries off) → `record-outbound` (`accepted` / `failed`). The webhook trigger is **disabled on purpose** and has no credential: n8n tried to attach the integration-key credential, which is the wrong secret. Create Header Auth credential `Satuu send webhook` (name `Authorization`, value `Bearer <webhook secret>`), select it on the webhook node, then enable the node.

Open before activation: `N8N_SEND_WEBHOOK_URL` and `N8N_SEND_WEBHOOK_SECRET` in Supabase (Edge Functions → Secrets); the OpenAI node has an invalid `builtInTools` setting and no credential; the agent prompt still says no handoff exists; only one WhatsApp trigger can be live per Meta app, so the live bot must be deactivated at cutover.

## Coexistence (WhatsApp Business app + AI on the same number)

**Implemented (backend + n8n, 2026-10-29):** a message the manager types in the WhatsApp Business app arrives from Meta as `smb_message_echoes` (`message_echoes[]` with `from` = business number, `to` = customer, `id`, `timestamp`, `type`, content). Stage A's Flatten node turns it into `kind: "echo"` (with `sender_id` = the **customer**), `Is Echo?` routes it to `POST /n8n/ingest-echo`:
```json
{ "business_id": "<BUSINESS_ID>", "to": "16505551234", "provider_message_id": "wamid.…", "type": "text", "text": "Здравствуйте, это менеджер", "timestamp": "1700255121", "phone_number_id": "106540352242922" }
```
→ `{ "duplicate": false, "message_id": "…", "conversation_id": "…", "state": "human_handling", "state_version": 3, "state_changed": true }`

Effects (SQL `ingest_manager_echo`, verified in a rolled-back transaction): recorded as a `manager` message with status `sent`; the AI is **paused** (`human_handling`, note «Менеджер ответил из приложения WhatsApp: AI приостановлен»), including from `human_requested`; idempotent on `provider_message_id`; an echo to an unknown customer creates the conversation already paused; media/other types get an honest placeholder; echoes do not open the 24 h window; receipts that arrived earlier are applied. The manager returns the chat to the AI with «Вернуть AI» as before.

**NOT done / NOT verified (needs Meta):**
- The number must actually be onboarded in coexistence. Per Meta's documentation this onboarding is performed through Embedded Signup by a Solution Partner / Tech Provider; a self-serve path for a business is not described. Eligibility for a US number is not confirmed.
- The Meta app must be subscribed to the webhook field `smb_message_echoes` (plus `history`, `smb_app_state_sync`, `account_update`). It is **unknown whether n8n's WhatsApp Trigger node forwards `smb_message_echoes` events**; if it does not, deliver them with a webhook override to a plain n8n Webhook node and run the same Flatten → Ingest Echo steps.
- Edited/deleted app messages arrive as separate events and are not handled.
- Voice/video calls are listed by Meta among features unsupported for coexistence numbers; calling inside the app on such a number must be confirmed with Meta.
- Not tested with a real echo event.
