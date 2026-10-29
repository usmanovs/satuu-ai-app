// TEST ONLY: stands in for the n8n human-reply webhook. Never sends WhatsApp messages.
// Needs the throwaway table:  create table public.test_mock_calls (id bigserial primary key, idempotency_key text, body jsonb, created_at timestamptz default now()); alter table public.test_mock_calls enable row level security;
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== 'Bearer mock-secret') return new Response('unauthorized', { status: 401 });
  const body = await req.json();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await db.from('test_mock_calls').insert({ idempotency_key: body.idempotency_key, body });
  const t = String(body.text ?? '');
  if (t.includes('FAIL4XX')) return new Response('bad request', { status: 400 });
  if (t.includes('FAIL5XX')) return new Response('boom', { status: 500 });
  if (t.includes('TIMEOUT')) await new Promise((r) => setTimeout(r, 12000));
  return new Response(JSON.stringify({ accepted: true }), { status: 200 });
});
