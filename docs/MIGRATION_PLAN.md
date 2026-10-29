# Replacing the n8n Data Tables with Supabase

**Rule: one source of truth.** Supabase owns conversation state and messages. The n8n Data Tables (`wa_customers`, `wa_messages`) must stop being read or written once n8n is cut over. There is no live sync and no dual write.

## Mapping

| n8n Data Table | Supabase |
|---|---|
| `wa_customers.sender_id` | `contacts.wa_id` (unique per business) |
| `wa_customers.display_name` | `contacts.display_name` |
| `wa_customers.state` (`ai_active` / `human_requested` / `human_handling`) | `conversations.state` (same values, CHECK-constrained) |
| `state_updated_at`, `state_note` | `conversations.state_updated_at`, `state_note` (+ `state_version`, `state_updated_by`) |
| `last_inbound_at`, `last_message_preview` | `conversations.last_inbound_at`, `last_message_preview` (+ `last_message_at`) |
| `wa_messages.provider_message_id` | `messages.provider_message_id` — `UNIQUE (business_id, provider_message_id)` |
| `wa_messages.direction` | `messages.direction` + `sender_role` (`customer` / `ai` / `manager`) |
| `wa_messages.body`, `message_timestamp` | `messages.body`, `message_timestamp` |
| `wa_messages.status` | `messages.status` (`received`, `pending`, `accepted`, `sent`, `delivered`, `read`, `failed`) |

## Steps

1. **Prepare (no downtime).** Apply the migrations, provision the owner and the integration key (`PROVISIONING.md`), deploy the Edge Functions, and set the secrets. Test the endpoints with `curl` using the payloads in `N8N_INTEGRATION.md`.
2. **Build the new n8n workflow as a copy.** Duplicate the existing workflow, apply checklist A and B from `N8N_INTEGRATION.md`, and leave it **inactive**. Keep the original untouched as the rollback.
3. **Cutover (short window).**
   1. Deactivate the old workflow (Meta retries failed webhook deliveries for a limited time; check Meta's current documentation for how long).
   2. Export both Data Tables to CSV.
   3. Run `supabase/provisioning/import_from_n8n_data_tables.sql` (template, untested on your data) on the export. Verify counts.
   4. Activate the new workflow.
   5. Send a test message from a personal number: it must appear in the dashboard; then take the conversation over and confirm the next customer message is **not** answered by the AI.
4. **Retire the Data Tables.** After a few days without issues, remove the Data Tables (or keep them as a read-only archive). Any workflow that still reads them is a bug.

## Behaviour changes to expect
- Imported outbound messages are labelled `ai` (history cannot tell AI from a human) and `accepted` (delivery is unknown).
- «AI paused» becomes real only after step 3.4. Before that the dashboard says so («Не подключено» / «n8n ещё ни разу не запрашивал разрешение»).

## Rollback
Reactivate the old workflow. Messages received while the new one was active exist only in Supabase; the old Data Tables will not contain them. Keep the window short, and do not roll back after the dashboard has been used for takeovers.
