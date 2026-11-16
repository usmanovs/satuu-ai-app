// n8n -> Supabase contracts. Auth: `Authorization: Bearer <integration key>`.
// Routes (POST): /ingest-message, /ingest-echo, /lead-context, /lead-score, /ai-permission, /request-human,
// /claim-human-send, /record-outbound, /message-status, /followup-candidates, /followup-claim, /need-manager
import {
  errorResponse, HttpError, json, preflight, readJson, requireIntegration, rpc,
} from '../_shared/lib.ts';
import { optStr, parseTimestamp, reqStr } from '../_shared/pure.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Используйте POST.');
    const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
    const body = await readJson(req);
    const businessId = await requireIntegration(req, body);

    switch (route) {
      case 'ingest-message': {
        const result = await rpc('ingest_inbound_message', {
          p_business: businessId,
          p_wa_id: reqStr(body, 'sender_id', 64),
          p_provider_message_id: reqStr(body, 'provider_message_id', 256),
          p_type: optStr(body, 'type', 40) ?? 'text',
          p_text: optStr(body, 'text'),
          p_ts: parseTimestamp(body.timestamp),
          p_display_name: optStr(body, 'display_name', 200),
          p_detect_human: body.detect_human === false ? false : true,
          // Cloud API phone_number_id of the business number; remembered so human replies are sent from it.
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'ingest-echo': {
        // Coexistence: a message the manager typed in the WhatsApp Business app (Meta smb_message_echoes).
        // Recorded as a manager message; the AI is paused for that conversation.
        const result = await rpc('ingest_manager_echo', {
          p_business: businessId,
          p_to_wa_id: reqStr(body, 'to', 64),
          p_provider_message_id: reqStr(body, 'provider_message_id', 256),
          p_type: optStr(body, 'type', 40) ?? 'text',
          p_text: optStr(body, 'text'),
          p_ts: parseTimestamp(body.timestamp),
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'lead-context': {
        // Recent messages of one chat, for the buying-signal scorer. Read-only.
        const limit = Number.isInteger(body.limit) ? (body.limit as number) : 12;
        const result = await rpc('get_lead_context', {
          p_business: businessId,
          p_wa_id: reqStr(body, 'sender_id', 64),
          p_limit: limit,
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'lead-score': {
        // AI estimate of buying likelihood (0-100); the label is derived in the database.
        const score = body.score;
        if (typeof score !== 'number' || !Number.isFinite(score)) {
          throw new HttpError(422, 'invalid_field', 'score должен быть числом от 0 до 100.');
        }
        const result = await rpc('record_lead_score', {
          p_business: businessId,
          p_wa_id: reqStr(body, 'sender_id', 64),
          p_score: Math.round(score),
          p_reason: optStr(body, 'reason', 200),
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'need-manager': {
        // The bot flags that a sales manager should step in. The AI keeps answering; the dashboard shows the flag.
        const result = await rpc('flag_manager_needed', {
          p_business: businessId,
          p_wa_id: reqStr(body, 'sender_id', 64),
          p_reason: optStr(body, 'reason', 200),
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'followup-candidates': {
        // Quiet leads still inside the 24 h window that have not been nudged yet. Read-only.
        const limit = Number.isInteger(body.limit) ? (body.limit as number) : 20;
        const result = await rpc('get_followup_candidates', { p_business: businessId, p_limit: limit });
        return json(result);
      }

      case 'followup-claim': {
        // Atomic once-only claim before a nudge is sent.
        const result = await rpc('followup_claim', {
          p_business: businessId,
          p_conversation: reqStr(body, 'conversation_id', 64),
        });
        return json(result);
      }

      case 'ai-permission': {
        const expected = body.expected_state_version;
        if (expected !== undefined && expected !== null && !Number.isInteger(expected)) {
          throw new HttpError(422, 'invalid_field', 'expected_state_version должно быть целым числом.');
        }
        const result = await rpc('ai_permission', {
          p_business: businessId,
          p_wa_id: reqStr(body, 'sender_id', 64),
          p_stage: reqStr(body, 'stage', 30),
          p_expected_version: (expected as number | null | undefined) ?? null,
          p_phone_number_id: optStr(body, 'phone_number_id', 40),
        });
        return json(result);
      }

      case 'request-human': {
        // Bound to the inbound message that triggered the AI run. There is deliberately NO
        // sender_id / customer id parameter: the conversation is derived from that message, so an
        // AI agent cannot request a human (or change state) for an arbitrary customer.
        const result = await rpc('request_human', {
          p_business: businessId,
          p_trigger_provider_message_id: reqStr(body, 'trigger_message_id', 256),
          p_reason: optStr(body, 'reason', 200),
        });
        return json(result);
      }

      case 'claim-human-send': {
        // n8n-side idempotency: only the first caller per idempotency key gets claimed:true.
        // The recipient and text come back from the database; n8n must send exactly those.
        const result = await rpc('claim_human_send', {
          p_business: businessId,
          p_idempotency_key: reqStr(body, 'idempotency_key', 100),
        });
        return json(result);
      }

      case 'record-outbound': {
        const sender = reqStr(body, 'sender', 10);
        const status = optStr(body, 'status', 20) ?? 'accepted';
        if (sender === 'ai') {
          const result = await rpc('record_ai_message', {
            p_business: businessId,
            p_wa_id: reqStr(body, 'sender_id', 64),
            p_provider_message_id: reqStr(body, 'provider_message_id', 256),
            p_type: optStr(body, 'type', 40) ?? 'text',
            p_text: optStr(body, 'text'),
            p_ts: parseTimestamp(body.timestamp),
            p_status: status,
            p_phone_number_id: optStr(body, 'phone_number_id', 40),
          });
          return json(result);
        }
        if (sender === 'manager') {
          // Reports the result of a dashboard-initiated send, correlated by idempotency key.
          const result = await rpc('record_manager_outcome', {
            p_business: businessId,
            p_idempotency_key: reqStr(body, 'idempotency_key', 100),
            p_status: status,
            p_provider_message_id: optStr(body, 'provider_message_id', 256),
            p_ts: parseTimestamp(body.timestamp),
            p_error_code: optStr(body, 'error_code', 100),
            p_error_message: optStr(body, 'error_message', 500),
          });
          return json(result);
        }
        throw new HttpError(422, 'invalid_field', 'sender должен быть ai или manager.');
      }

      case 'message-status': {
        const result = await rpc<{ matched: boolean }>('apply_message_status', {
          p_business: businessId,
          p_provider_id: reqStr(body, 'provider_message_id', 256),
          p_status: reqStr(body, 'status', 20),
          p_ts: parseTimestamp(body.timestamp),
          p_error_code: optStr(body, 'error_code', 100),
          p_error_message: optStr(body, 'error_message', 500),
        });
        // 202: receipt stored but the message row is not known yet; it is applied when the message is recorded.
        return json(result, result.matched ? 200 : 202);
      }

      default:
        throw new HttpError(404, 'not_found', 'Неизвестный маршрут.');
    }
  } catch (e) {
    return errorResponse(e);
  }
});
