// Dashboard backend. Auth: the manager's Supabase JWT. Business and manager identity are
// derived from it; any business_id / user_id in the body is ignored.
// Routes: GET /me, GET /team, GET|POST /status, POST /conversation-action, /conversation-outcome, /assign,
// /send-reply, /team-stats, /team-add, /team-link, /team-update, /team-remove. Roles: owner | director | manager.
import {
  admin, errorResponse, HttpError, json, preflight, readJson, requireManager, rpc,
} from '../_shared/lib.ts';
import { classifyN8nResponse, optStr, reqStr } from '../_shared/pure.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_TIMEOUT_MS = 10_000;

// Where invite / reset links send people. Only our own dashboard origin is trusted from the request.
function dashboardUrl(req: Request): string {
  const fallback = Deno.env.get('DASHBOARD_URL') ?? 'https://satuu-inbox.vercel.app';
  const origin = req.headers.get('origin') ?? '';
  return origin === fallback || origin === 'http://localhost:5173' ? origin : fallback;
}

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
    const { userId, businessId, role, email, displayName } = await requireManager(req);
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

    if (route === 'me') return json({ user_id: userId, role, email, display_name: displayName });

    if (route === 'team' && req.method === 'GET') {
      return json({ members: await rpc('team_list', { p_business: businessId, p_user: userId }) });
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

    if (route === 'assign') {
      const conversationId = reqStr(body, 'conversation_id', 36);
      if (!UUID.test(conversationId)) throw new HttpError(422, 'invalid_field', 'Недопустимый conversation_id.');
      const to = body.assigned_to === null || body.assigned_to === undefined ? null : reqStr(body, 'assigned_to', 36);
      if (to !== null && !UUID.test(to)) throw new HttpError(422, 'invalid_field', 'Недопустимый assigned_to.');
      return json(await rpc('assign_conversation', { p_business: businessId, p_conversation: conversationId, p_to: to, p_by: userId }));
    }

    if (route === 'team-stats') {
      const days = Number.isInteger(body.days) && (body.days as number) > 0 && (body.days as number) <= 365 ? (body.days as number) : 30;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      return json(await rpc('team_stats', { p_business: businessId, p_user: userId, p_since: since }));
    }

    if (route === 'team-add') {
      if (role !== 'owner') throw new HttpError(403, 'forbidden', 'Недостаточно прав для этого действия.');
      const newEmail = reqStr(body, 'email', 200).toLowerCase();
      const newRole = reqStr(body, 'role', 10);
      const name = optStr(body, 'name', 100);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) throw new HttpError(422, 'invalid_field', 'Недопустимый email.');
      if (newRole !== 'director' && newRole !== 'manager') throw new HttpError(422, 'invalid_role', 'Роль должна быть director или manager.');
      // No password is ever typed by the owner: the person opens a one-time link and sets their own.
      const { data: invited, error: iErr } = await admin().auth.admin.generateLink({
        type: 'invite', email: newEmail, options: { redirectTo: dashboardUrl(req) },
      });
      if (iErr || !invited?.user) {
        throw new HttpError(409, 'user_exists', 'Не удалось создать приглашение: возможно, этот email уже зарегистрирован.');
      }
      try {
        await rpc('team_add_member', {
          p_business: businessId, p_actor: userId, p_user: invited.user.id, p_email: newEmail, p_name: name, p_role: newRole,
        });
      } catch (e) {
        await admin().auth.admin.deleteUser(invited.user.id); // never leave an orphan login behind
        throw e;
      }
      return json({ user_id: invited.user.id, email: newEmail, role: newRole, link: invited.properties.action_link });
    }

    if (route === 'team-link') {
      // New one-time sign-in / password-reset link for an existing teammate. Owner only; never for the owner row.
      if (role !== 'owner') throw new HttpError(403, 'forbidden', 'Недостаточно прав для этого действия.');
      const target = reqStr(body, 'user_id', 36);
      if (!UUID.test(target)) throw new HttpError(422, 'invalid_field', 'Недопустимый user_id.');
      const { data: m } = await admin().from('business_memberships')
        .select('email, role').eq('business_id', businessId).eq('user_id', target).maybeSingle();
      if (!m || !m.email) throw new HttpError(404, 'not_found', 'Сотрудник не найден.');
      if (m.role === 'owner') throw new HttpError(403, 'forbidden', 'Недостаточно прав для этого действия.');
      const { data: link, error: lErr } = await admin().auth.admin.generateLink({
        type: 'recovery', email: m.email as string, options: { redirectTo: dashboardUrl(req) },
      });
      if (lErr || !link?.properties) throw new HttpError(502, 'link_failed', 'Не удалось создать ссылку. Попробуйте ещё раз.');
      return json({ link: link.properties.action_link });
    }

    if (route === 'team-update') {
      const target = reqStr(body, 'user_id', 36);
      if (!UUID.test(target)) throw new HttpError(422, 'invalid_field', 'Недопустимый user_id.');
      const newRole = optStr(body, 'role', 10);
      const active = typeof body.active === 'boolean' ? body.active : null;
      return json(await rpc('team_update_member', {
        p_business: businessId, p_actor: userId, p_target: target, p_role: newRole, p_name: optStr(body, 'name', 100), p_active: active,
      }));
    }

    if (route === 'team-remove') {
      const target = reqStr(body, 'user_id', 36);
      if (!UUID.test(target)) throw new HttpError(422, 'invalid_field', 'Недопустимый user_id.');
      const result = await rpc('team_remove_member', { p_business: businessId, p_actor: userId, p_target: target });
      await admin().auth.admin.deleteUser(target); // membership is gone; remove the login too
      return json(result);
    }

    if (route === 'conversation-outcome') {
      const conversationId = reqStr(body, 'conversation_id', 36);
      const outcome = reqStr(body, 'outcome', 10);
      if (!UUID.test(conversationId)) throw new HttpError(422, 'invalid_field', 'Недопустимый conversation_id.');
      const result = await rpc('set_conversation_outcome', {
        p_business: businessId, p_conversation: conversationId, p_outcome: outcome, p_user: userId,
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

      // backend permission check: a manager may only reply in a chat assigned to them
      await rpc('assert_conversation_access', { p_business: businessId, p_user: userId, p_conversation: conversationId });

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
