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

**Explicit human request** (for the AI agent's tool): `POST /n8n/request-human`
```json
{ "business_id": "…", "sender_id": "996700123456", "reason": "Клиент просит оператора" }
```
Only `ai_active → human_requested`; it never downgrades `human_handling`.

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

## Required n8n changes (checklist)

### A. Main workflow (WhatsApp Trigger → AI Agent → send)

> Field expressions assume the n8n WhatsApp Trigger output (`messages[0].from`, `messages[0].id`, `contacts[0].profile.name`, `statuses[0].…`). Check them against one real execution of your trigger before relying on them.

1. **Split messages from receipts.** After the trigger add an IF: `{{ $json.statuses }}` exists → status branch (step 9); otherwise → message branch.
2. **Ingest.** HTTP Request `Ingest message` → `POST …/n8n/ingest-message`, credential `Satuu Supabase`, body as in §1 (`sender_id` = `{{ $json.messages[0].from }}`, `provider_message_id` = `{{ $json.messages[0].id }}`, `type` = `{{ $json.messages[0].type }}`, `text` = `{{ $json.messages[0].text?.body }}`, `timestamp` = `{{ $json.messages[0].timestamp }}`, `display_name` = `{{ $json.contacts?.[0]?.profile?.name }}`).
   Settings: *Retry On Fail* **on** (3 tries) — safe, the endpoint is idempotent. *On Error*: stop the workflow (never fall through to the AI).
3. **Gate 1.** IF `{{ $json.supported && $json.ai_allowed }}`. False → end (NoOp). Optional: for `supported = false` send a fixed «Пока я понимаю только текстовые сообщения» — it must pass gates 2 and 3 too.
4. **Permission before generating.** HTTP `AI permission (before generate)` → §2. IF `allowed` else end. Remember `state_version`.
5. **AI Agent** (existing). Add an HTTP Request **tool** named `request_human` → `/n8n/request-human`, and one line to the system prompt: «Если клиент просит человека/менеджера — вызови request_human и скажи, что передаёшь диалог».
6. **Permission before send.** HTTP `AI permission (before send)` with `expected_state_version = {{ $('AI permission (before generate)').item.json.state_version }}`. IF `allowed` else end. **Put nothing slow between this node and the send node.**
7. **WhatsApp send** (existing). Set *Retry On Fail* **off**.
8. **Record AI reply.** HTTP → `/n8n/record-outbound` with `sender: "ai"`, `provider_message_id = {{ $json.messages[0].id }}` (the send node's response), `status: "accepted"`. Retry On Fail **on** (idempotent).
9. **Status branch.** IF `statuses[0].status` is one of `sent`, `delivered`, `read`, `failed` (ignore `deleted`, `warning`, …) → HTTP → `/n8n/message-status` with `provider_message_id = {{ $json.statuses[0].id }}`, `status`, `timestamp`, and for `failed`: `error_code = {{ $json.statuses[0].errors?.[0]?.code }}`, `error_message = {{ $json.statuses[0].errors?.[0]?.title }}`.
10. **Remove** every node that reads or writes the `wa_customers` / `wa_messages` Data Tables (see `MIGRATION_PLAN.md`).

### B. New workflow: «Human send»

1. **Webhook** node: POST, path unguessable, *Authentication* = Header Auth (`Satuu send webhook`), *Respond* = **Immediately**, response body `{"accepted": true}`. The URL goes into `N8N_SEND_WEBHOOK_URL`.
2. IF `{{ $json.body.type }}` = `template` →
   - WhatsApp **send template** node (name/language from `body.template`), recipient `{{ $json.body.to }}`; else
   - WhatsApp **send message** node, text `{{ $json.body.text }}`.
   Use the **existing WhatsApp credential**, so it sends from the same business number. *Retry On Fail* **off** on both.
3. Success → HTTP → `/n8n/record-outbound` `{ sender: "manager", idempotency_key: {{ $('Webhook').item.json.body.idempotency_key }}, provider_message_id: <wamid>, status: "accepted" }`.
4. Error branch of the send node → same endpoint with `status: "failed"` + `error_code` / `error_message`. (Required: the HTTP answer was already sent, so this is the only way a failed send becomes visible.)

### C. Credentials and secrets
- n8n: the two Header Auth credentials above.
- Supabase Edge Function secrets: `N8N_SEND_WEBHOOK_URL`, `N8N_SEND_WEBHOOK_SECRET`, optionally `WA_TEMPLATE_NAME`, `WA_TEMPLATE_LANG`.

## Known races and limits (read before going live)

1. **Check → send gap.** Between «permission before send» and the WhatsApp API call there is still a window (milliseconds to a couple of seconds). A takeover inside it cannot cancel the AI message; it will be sent, recorded as an AI message, and appear in the chat just before the manager's. `state_version` only detects changes made *before* the second check. This is documented, not solved.
2. **Concurrent customer messages.** Two quick messages can start two executions. Both pass the gate and both answer. If that matters, serialize per `sender_id` in n8n (queue mode concurrency or a short debounce).
3. **Unconfirmed human sends.** When n8n returns 5xx or times out, the message stays `pending` («Нет подтверждения» after 60 s). It may or may not have been sent. Nothing retries it. The same idempotency key can be resubmitted safely; a *new* message must be a new key.
4. **Receipts before records.** Handled by buffering (`status_events`), but a receipt for a message that is never recorded (for example an AI send whose `record-outbound` call failed permanently) stays unattached.
5. **`accepted` is not `sent`.** The status moves to `sent`/`delivered` only when Meta's webhook says so. If the status branch (step 9) is not wired, messages stay at «Принято к отправке» forever.
6. **Replies are not cancelled by resume/takeover after they are sent.** Obviously, but worth saying.
