// After-payment sequence: n8n asks what is due, claims a step before sending, then confirms or releases it.
// Auth: `Authorization: Bearer <integration key>` (same key as the `n8n` function). Routes (POST): /due, /claim, /confirm, /release
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = ['welcome', 'prep', 'reminder', 'checkin', 'demo'];

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return reply({ error: 'use POST' }, 405);
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
    if (!m) return reply({ error: 'unauthorized' }, 401);
    const { data: business, error: kerr } = await sb.rpc('resolve_integration_key', { p_hash: await sha256Hex(m[1]) });
    if (kerr || !business) return reply({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.business_id !== business) return reply({ error: 'business_mismatch' }, 403);
    const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();

    if (route === 'due') {
      const limit = Number.isInteger(body.limit) ? (body.limit as number) : 10;
      const { data, error } = await sb.rpc('get_onboarding_due', { p_business: business, p_limit: limit });
      if (error) return reply({ error: 'db_error' }, 500);
      return reply({ items: data ?? [] });
    }

    const conversation = String(body.conversation_id ?? '');
    const step = String(body.step ?? '');
    if (!UUID.test(conversation) || !STEPS.includes(step)) return reply({ error: 'invalid_input' }, 422);

    if (route === 'claim') {
      const template = String(body.template ?? '').slice(0, 80);
      const { data, error } = await sb.rpc('onboarding_claim', { p_business: business, p_conversation: conversation, p_step: step, p_template: template });
      if (error) return reply({ error: 'db_error' }, 500);
      return reply(data);
    }
    if (route === 'confirm' || route === 'release') {
      const { data, error } = await sb.rpc(route === 'confirm' ? 'onboarding_confirm' : 'onboarding_release', { p_business: business, p_conversation: conversation, p_step: step });
      if (error) return reply({ error: 'db_error' }, 500);
      return reply(data);
    }
    return reply({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('onboarding error:', e instanceof Error ? e.message : e);
    return reply({ error: 'internal_error' }, 500);
  }
});
