// Dashboard backend. Auth: the manager's Supabase JWT. Business and manager identity are
// derived from it; any business_id / user_id in the body is ignored.
// Routes: POST /conversation-action, POST /send-reply, GET|POST /status
import {
  admin, errorResponse, HttpError, json, preflight, readJson, requireManager, rpc,
} from '../_shared/lib.ts';
import { classifyN8nResponse, optStr, reqStr } from '../_shared/pure.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_TIMEOUT_MS = 10_000;

function config() {
  const url = Deno.env.get('N8N_SEND_WEBHOOK_URL') ?? '';
  const secret = Deno.env.get('N8N_SEND_WEBHOOK_SECRET') ?? '';
  const template = Deno.env.get('WA_TEMPLATE_NAME') ?? '';
  return {
    url, secret, template,
    templateLang: Deno.env.get('WA_TEMPLATE_LANG') ?? 'ru',
    sendConfigured: url.startsWith('https://') && secret.length > 0,
    templateConfigured: template.length > 0,
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
    const { userId, businessId } = await requireManager(req);
    const cfg = config();

    if (route === 'status') {
      const { data } = await admin().from('businesses')
        .select('last_ai_check_at, last_ingest_at').eq('id', businessId).single();
      return json({
        send_configured: cfg.sendConfigured,
        template_configured: cfg.templateConfigured,
        last_ai_check_at: data?.last_ai_check_at ?? null,
        last_ingest_at: data?.last_ingest_at ?? null,
      });
    }

    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Используйте POST.');
    const body = await readJson(req);

    if (route === 'conversation-action') {
      const conversationId = reqStr(body, 'conversation_id', 36);
      const action = reqStr(body, 'action', 20);
      if (!UUID.test(conversationId)) throw new HttpError(422, 'invalid_field', 'Недопустимый conversation_id.');
      const result = await rpc('set_conversation_state', {
        p_business: businessId, p_conversation: conversationId, p_action: action, p_user: userId,
      });
      return json(result);
    }

    if (route === 'send-reply') {
      const conversationId = reqStr(body, 'conversation_id', 36);
      const key = reqStr(body, 'idempotency_key', 100);
      const useTemplate = body.use_template === true;
      if (!UUID.test(conversationId)) throw new HttpError(422, 'invalid_field', 'Недопустимый conversation_id.');

      // Not connected => nothing is created and nothing pretends to be sent.
      if (!cfg.sendConfigured) {
        throw new HttpError(503, 'not_connected', 'Не подключено: отправка через n8n не настроена.');
      }
      if (useTemplate && !cfg.templateConfigured) {
        throw new HttpError(503, 'template_not_configured', 'Не подключено: шаблон WhatsApp не настроен.');
      }

      const created = await rpc<{ created: boolean; message: Record<string, unknown>; wa_id: string }>(
        'create_human_message',
        {
          p_business: businessId, p_conversation: conversationId, p_user: userId,
          p_idempotency_key: key, p_text: optStr(body, 'text'),
          p_use_template: useTemplate, p_template_name: cfg.template || null,
        },
      );

      // Same idempotency key => return what we already have. NEVER send twice.
      if (!created.created) {
        return json({ ok: created.message.status !== 'failed', created: false, status: created.message.status, message: created.message });
      }

      let outcome = classifyN8nResponse({ networkError: 'not_attempted' });
      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          redirect: 'manual', // a redirect could replay the POST elsewhere
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.secret}`,
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            event: 'human_reply',
            business_id: businessId,
            message_id: created.message.id,
            idempotency_key: key,
            to: created.wa_id,
            type: useTemplate ? 'template' : 'text',
            text: useTemplate ? null : created.message.body,
            template: useTemplate ? { name: cfg.template, language: cfg.templateLang } : null,
            requested_by: userId,
            requested_at: new Date().toISOString(),
          }),
        });
        await res.body?.cancel();
        outcome = classifyN8nResponse({ httpStatus: res.status });
      } catch (e) {
        outcome = classifyN8nResponse({ networkError: e instanceof Error ? e.name : 'unknown' });
      }

      if (outcome.status === 'accepted' || outcome.status === 'failed') {
        const updated = await rpc<{ status: string }>('record_manager_outcome', {
          p_business: businessId, p_idempotency_key: key, p_status: outcome.status,
          p_error_code: outcome.status === 'failed' ? outcome.errorCode : null,
          p_error_message: outcome.status === 'failed' ? outcome.errorMessage : null,
        });
        const { data: row } = await admin().from('messages').select('*')
          .eq('business_id', businessId).eq('idempotency_key', key).single();
        const code = outcome.status === 'accepted' ? 200 : 502;
        return json({ ok: outcome.status === 'accepted', created: true, status: updated.status, message: row }, code);
      }

      // Unknown result. Left as pending on purpose; no automatic retry.
      console.error('send-reply unconfirmed:', outcome.reason);
      return json({ ok: false, created: true, status: 'pending', unconfirmed: true, message: created.message }, 202);
    }

    throw new HttpError(404, 'not_found', 'Неизвестный маршрут.');
  } catch (e) {
    return errorResponse(e);
  }
});
