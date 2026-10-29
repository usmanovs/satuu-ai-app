// Integration tests against a TEST Supabase project (see supabase/tests/fixtures.sql).
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node --test tests/integration.test.mjs
// Uses the `inbox-selftest` + `mock-n8n` functions for the send path, so no real WhatsApp message is ever sent.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
assert.ok(URL_ && ANON, 'Set SUPABASE_URL and SUPABASE_ANON_KEY');
const FN = `${URL_}/functions/v1`;
const A = 'a1000000-0000-0000-0000-0000000000a1';
const B = 'b1000000-0000-0000-0000-0000000000b1';
const RUN = String(Date.now()).slice(-8);
const wa = (n) => `99670${RUN}${n}`;
const uid = (p) => `${p}-${RUN}-${Math.random().toString(36).slice(2, 8)}`;

async function login(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test-Password-123!' }),
  });
  const j = await r.json();
  assert.ok(j.access_token, `login failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}
async function call(path, { token, body, method = 'POST' } = {}) {
  const r = await fetch(`${FN}/${path}`, {
    method, headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
async function rest(table, token, query = 'select=*') {
  const r = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
const n8n = (route, body, key = 'test-key-A') => call(`n8n/${route}`, { token: key, body });
const ingest = (sender, pid, text, extra = {}) =>
  n8n('ingest-message', { business_id: A, sender_id: sender, provider_message_id: pid, type: 'text', text, timestamp: new Date().toISOString(), ...extra });
const perm = (sender, stage = 'before_generate', v) =>
  n8n('ai-permission', { business_id: A, sender_id: sender, stage, ...(v ? { expected_state_version: v } : {}) });

let tokA, tokB, tokC;
before(async () => { tokA = await login('manager-a@test.local'); tokB = await login('manager-b@test.local'); tokC = await login('nobody@test.local'); });

const action = (token, conversation_id, act) => call('inbox/conversation-action', { token, body: { conversation_id, action: act } });
const send = (token, conversation_id, text, key = uid('k'), extra = {}) =>
  call('inbox-selftest/send-reply', { token, body: { conversation_id, idempotency_key: key, text, ...extra } });
const msgs = async (convId) => (await rest('messages', tokA, `conversation_id=eq.${convId}&select=*&order=message_timestamp`)).json;

describe('access control', () => {
  test('unauthenticated REST access is denied on every table', async () => {
    for (const t of ['businesses', 'business_memberships', 'contacts', 'conversations', 'messages', 'integration_keys', 'status_events']) {
      const r = await rest(t, ANON);
      assert.ok(r.status >= 400, `${t} returned ${r.status}`);
    }
  });
  test('dashboard functions reject missing token, anon key and users without membership', async () => {
    assert.equal((await call('inbox/status', { method: 'GET' })).status, 401);
    assert.equal((await call('inbox/status', { token: ANON, method: 'GET' })).status, 401);
    const c = await call('inbox/status', { token: tokC, method: 'GET' });
    assert.equal(c.status, 403);
  });
  test('n8n endpoints reject missing key, wrong key and a business id that does not match the key', async () => {
    assert.equal((await call('n8n/ai-permission', { body: { business_id: A } })).status, 401);
    assert.equal((await n8n('ai-permission', { business_id: A, sender_id: '1', stage: 'before_send' }, 'wrong')).status, 401);
    assert.equal((await n8n('ai-permission', { business_id: B, sender_id: '1', stage: 'before_send' }, 'test-key-A')).status, 403);
  });
});

describe('ingestion', () => {
  test('duplicate events do not create duplicate messages', async () => {
    const s = wa(1); const pid = uid('wamid.dup');
    const r1 = await ingest(s, pid, 'Здравствуйте');
    const r2 = await ingest(s, pid, 'Здравствуйте');
    const r3 = await ingest(s, pid, 'Здравствуйте');
    assert.equal(r1.json.duplicate, false); assert.equal(r2.json.duplicate, true); assert.equal(r3.json.duplicate, true);
    const rows = await msgs(r1.json.conversation_id);
    assert.equal(rows.length, 1);
  });
  test('delivery receipts never become chat messages', async () => {
    const s = wa(2); const r = await ingest(s, uid('wamid.in'), 'Привет');
    const before = (await msgs(r.json.conversation_id)).length;
    const st = await n8n('message-status', { business_id: A, provider_message_id: uid('wamid.unknown'), status: 'delivered', timestamp: Math.floor(Date.now() / 1000) });
    assert.equal(st.status, 202);
    for (const type of ['status', 'delivered', 'read']) {
      const bad = await ingest(s, uid('wamid.rcpt'), 'x', { type });
      assert.equal(bad.status, 422, `type ${type}`); assert.equal(bad.json.error.code, 'not_a_message');
    }
    assert.equal((await msgs(r.json.conversation_id)).length, before);
  });
  test('unsupported media is stored with an honest placeholder', async () => {
    const r = await ingest(wa(3), uid('wamid.img'), null, { type: 'image' });
    assert.equal(r.json.supported, false);
    const rows = await msgs(r.json.conversation_id);
    assert.equal(rows[0].is_placeholder, true);
    assert.match(rows[0].body, /Изображение — ассистент не обрабатывает/);
    const a = await ingest(wa(3), uid('wamid.aud'), null, { type: 'audio' });
    assert.match((await msgs(a.json.conversation_id)).at(-1).body, /не распознаёт аудио/);
  });
});

describe('business isolation', () => {
  test('another business cannot read or act on the conversation', async () => {
    const s = wa(4); const r = await ingest(s, uid('wamid.iso'), 'Тест изоляции');
    const convId = r.json.conversation_id;
    assert.ok((await rest('conversations', tokA, `id=eq.${convId}`)).json.length === 1);
    assert.deepEqual((await rest('conversations', tokB, `id=eq.${convId}`)).json, []);
    assert.deepEqual((await rest('messages', tokB, `conversation_id=eq.${convId}`)).json, []);
    assert.deepEqual((await rest('contacts', tokB, `wa_id=eq.${s}`)).json, []);
    assert.deepEqual((await rest('conversations', tokC)).json, []);
    assert.equal((await action(tokB, convId, 'takeover')).status, 404);
    assert.equal((await action(tokC, convId, 'takeover')).status, 403);
    assert.equal((await perm(s)).json.state, 'ai_active'); // B's takeover attempt changed nothing
    const mem = (await rest('business_memberships', tokB)).json;
    assert.ok(mem.every((m) => m.business_id === B));
  });
  test('users cannot add themselves to a business or write directly', async () => {
    const ins = await fetch(`${URL_}/rest/v1/business_memberships`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tokC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: A, user_id: 'c0000000-0000-0000-0000-00000000000c' }) });
    assert.ok(ins.status >= 400);
    const upd = await fetch(`${URL_}/rest/v1/conversations?business_id=eq.${A}`, { method: 'PATCH', headers: { apikey: ANON, Authorization: `Bearer ${tokA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'human_handling' }) });
    assert.ok(upd.status >= 400, 'even a member cannot write state directly');
  });
  test('the same WhatsApp sender in two businesses stays separate', async () => {
    const s = wa(5);
    const a = await ingest(s, uid('wamid.same'), 'из A');
    const b = await n8n('ingest-message', { business_id: B, sender_id: s, provider_message_id: uid('wamid.same'), type: 'text', text: 'из B' }, 'test-key-B');
    assert.notEqual(a.json.conversation_id, b.json.conversation_id);
  });
});

describe('takeover / resume and the AI gate', () => {
  test('takeover blocks AI permission checks; resume allows AI again', async () => {
    const s = wa(6); const r = await ingest(s, uid('wamid.t'), 'Сколько стоит?');
    const c = r.json.conversation_id;
    const p0 = await perm(s, 'before_generate');
    assert.equal(p0.json.allowed, true);
    const t = await action(tokA, c, 'takeover');
    assert.equal(t.status, 200); assert.equal(t.json.state, 'human_handling');
    for (const stage of ['before_generate', 'before_send']) {
      const p = await perm(s, stage);
      assert.equal(p.json.allowed, false); assert.equal(p.json.reason, 'state_human_handling');
    }
    const rs = await action(tokA, c, 'resume');
    assert.equal(rs.json.state, 'ai_active');
    assert.equal((await perm(s)).json.allowed, true);
  });
  test('a takeover between the two checks is detected via state_version', async () => {
    const s = wa(7); const r = await ingest(s, uid('wamid.v'), 'Привет');
    const p1 = await perm(s, 'before_generate');
    await action(tokA, r.json.conversation_id, 'takeover');
    await action(tokA, r.json.conversation_id, 'resume');
    const p2 = await perm(s, 'before_send', p1.json.state_version);
    assert.equal(p2.json.allowed, false); assert.equal(p2.json.reason, 'state_changed');
    assert.equal((await perm(s, 'before_send', p2.json.state_version)).json.allowed, true);
  });
  test('monitoring (mark_read) does not change state or interrupt AI', async () => {
    const s = wa(8); const r = await ingest(s, uid('wamid.m'), 'Привет');
    const rd = await action(tokA, r.json.conversation_id, 'mark_read');
    assert.equal(rd.json.state, 'ai_active'); assert.equal(rd.json.changed, false);
    assert.equal((await perm(s)).json.allowed, true);
  });
  test('a request for a person pauses AI; request-human never downgrades human_handling', async () => {
    const s = wa(9); const r = await ingest(s, uid('wamid.h'), 'Позовите менеджера, пожалуйста');
    assert.equal(r.json.state, 'human_requested'); assert.equal(r.json.ai_allowed, false);
    assert.equal((await perm(s)).json.allowed, false);
    const ok = await ingest(wa(10), uid('wamid.ok'), 'Нас будет 3 человека, сколько стоит?');
    assert.equal(ok.json.state, 'ai_active', 'false positive on "3 человека"');
    const rq = await n8n('request-human', { business_id: A, sender_id: wa(10), reason: 'Клиент просит оператора' });
    assert.equal(rq.json.state, 'human_requested');
    await action(tokA, ok.json.conversation_id, 'takeover');
    const rq2 = await n8n('request-human', { business_id: A, sender_id: wa(10) });
    assert.equal(rq2.json.state, 'human_handling'); assert.equal(rq2.json.changed, false);
    assert.equal((await perm(wa(10))).json.allowed, false);
  });
  test('unknown conversations fail closed', async () => {
    const p = await perm('99999999999999');
    assert.equal(p.json.allowed, false); assert.equal(p.json.reason, 'unknown_conversation');
  });
});

describe('human replies (mock n8n, no real WhatsApp)', () => {
  test('require human_handling', async () => {
    const r = await ingest(wa(11), uid('wamid.r'), 'Привет');
    const res = await send(tokA, r.json.conversation_id, 'Ответ менеджера');
    assert.equal(res.status, 409); assert.equal(res.json.error.code, 'not_human_handling');
    const r2 = await ingest(wa(12), uid('wamid.r2'), 'Позовите менеджера');
    assert.equal(r2.json.state, 'human_requested');
    assert.equal((await send(tokA, r2.json.conversation_id, 'Ответ')).status, 409);
    assert.equal((await msgs(r.json.conversation_id)).filter((m) => m.sender_role === 'manager').length, 0);
  });
  test('accepted is not delivered; statuses only move forward', async () => {
    const s = wa(13); const r = await ingest(s, uid('wamid.s'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const key = uid('k');
    const res = await send(tokA, c, 'Здравствуйте, это менеджер', key);
    assert.equal(res.status, 200); assert.equal(res.json.status, 'accepted');
    let m = (await msgs(c)).find((x) => x.idempotency_key === key);
    assert.equal(m.status, 'accepted'); assert.notEqual(m.status, 'delivered');
    const wamid = uid('wamid.out');
    const o = await n8n('record-outbound', { business_id: A, sender: 'manager', idempotency_key: key, provider_message_id: wamid, status: 'sent' });
    assert.equal(o.json.status, 'sent');
    await n8n('message-status', { business_id: A, provider_message_id: wamid, status: 'delivered' });
    await n8n('message-status', { business_id: A, provider_message_id: wamid, status: 'sent' }); // late/out of order
    m = (await msgs(c)).find((x) => x.idempotency_key === key);
    assert.equal(m.status, 'delivered', 'late "sent" must not regress delivered');
    await n8n('message-status', { business_id: A, provider_message_id: wamid, status: 'read' });
    assert.equal((await msgs(c)).find((x) => x.idempotency_key === key).status, 'read');
    assert.equal(m.sender_role, 'manager');
  });
  test('the same idempotency key is never sent twice', async () => {
    const r = await ingest(wa(14), uid('wamid.i'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const key = uid('k');
    const a = await send(tokA, c, 'Один раз', key);
    const b = await send(tokA, c, 'Один раз', key);
    const d = await send(tokA, c, 'Один раз', key);
    assert.equal(a.json.created, true); assert.equal(b.json.created, false); assert.equal(d.json.created, false);
    assert.equal((await msgs(c)).filter((m) => m.idempotency_key === key).length, 1);
  });
  test('a backend rejection shows as failed, never successful, and is not retried', async () => {
    const r = await ingest(wa(15), uid('wamid.f'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const key = uid('k');
    const res = await send(tokA, c, 'FAIL4XX сообщение', key);
    assert.equal(res.status, 502); assert.equal(res.json.ok, false); assert.equal(res.json.status, 'failed');
    const retry = await send(tokA, c, 'FAIL4XX сообщение', key);
    assert.equal(retry.json.created, false); assert.equal(retry.json.ok, false); assert.equal(retry.json.status, 'failed');
    const m = (await msgs(c)).find((x) => x.idempotency_key === key);
    assert.equal(m.status, 'failed'); assert.match(m.error_code, /n8n_http_400/);
  });
  test('an n8n 5xx or timeout stays pending (unconfirmed), is not shown as sent, and is not retried', async () => {
    const r = await ingest(wa(16), uid('wamid.p'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const k1 = uid('k');
    const r5 = await send(tokA, c, 'FAIL5XX сообщение', k1);
    assert.equal(r5.status, 202); assert.equal(r5.json.ok, false); assert.equal(r5.json.status, 'pending');
    const k2 = uid('k');
    const rt = await send(tokA, c, 'TIMEOUT сообщение', k2);
    assert.equal(rt.status, 202); assert.equal(rt.json.unconfirmed, true);
    const again = await send(tokA, c, 'TIMEOUT сообщение', k2);
    assert.equal(again.json.created, false); assert.equal(again.json.status, 'pending');
    const rows = await msgs(c);
    assert.equal(rows.find((x) => x.idempotency_key === k1).status, 'pending');
    assert.equal(rows.find((x) => x.idempotency_key === k2).status, 'pending');
  });
  test('outside the 24h window free text is refused; an approved template is required', async () => {
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const r = await ingest(wa(17), uid('wamid.w'), 'Старое сообщение', { timestamp: old }); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const free = await send(tokA, c, 'Свободный текст');
    assert.equal(free.status, 422); assert.equal(free.json.error.code, 'window_closed');
    assert.equal((await msgs(c)).filter((m) => m.sender_role === 'manager').length, 0);
    const tpl = await send(tokA, c, null, uid('k'), { use_template: true });
    assert.equal(tpl.status, 200); assert.equal(tpl.json.message.message_type, 'template');
  });
  test('validation: empty text and another business conversation', async () => {
    const r = await ingest(wa(18), uid('wamid.e'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    assert.equal((await send(tokA, c, '   ')).status, 422);
    assert.equal((await send(tokB, c, 'чужой диалог')).status, 404);
  });
  test('the real inbox function says "not connected" and creates nothing while n8n is not configured', async () => {
    const r = await ingest(wa(19), uid('wamid.nc'), 'Привет'); const c = r.json.conversation_id;
    await action(tokA, c, 'takeover');
    const res = await call('inbox/send-reply', { token: tokA, body: { conversation_id: c, idempotency_key: uid('k'), text: 'Привет' } });
    assert.equal(res.status, 503); assert.equal(res.json.error.code, 'not_connected');
    assert.equal((await msgs(c)).filter((m) => m.sender_role === 'manager').length, 0);
    const st = await call('inbox/status', { token: tokA, method: 'GET' });
    assert.equal(st.json.send_configured, false);
  });
});

describe('AI replies and receipts', () => {
  test('AI replies are recorded as accepted (not delivered); early receipts are replayed', async () => {
    const s = wa(20); const r = await ingest(s, uid('wamid.a'), 'Привет'); const c = r.json.conversation_id;
    const wamid = uid('wamid.ai');
    const early = await n8n('message-status', { business_id: A, provider_message_id: wamid, status: 'sent', timestamp: Math.floor(Date.now() / 1000) });
    assert.equal(early.status, 202);
    const rec = await n8n('record-outbound', { business_id: A, sender: 'ai', sender_id: s, provider_message_id: wamid, type: 'text', text: 'Здравствуйте! Чем помочь?', status: 'accepted' });
    assert.equal(rec.json.duplicate, false);
    const dup = await n8n('record-outbound', { business_id: A, sender: 'ai', sender_id: s, provider_message_id: wamid, type: 'text', text: 'Здравствуйте! Чем помочь?', status: 'accepted' });
    assert.equal(dup.json.duplicate, true);
    let rows = (await msgs(c)).filter((m) => m.sender_role === 'ai');
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'sent', 'early "sent" receipt replayed, but not delivered');
    await n8n('message-status', { business_id: A, provider_message_id: wamid, status: 'failed', error_code: '131047', error_message: 'Re-engagement message' });
    rows = (await msgs(c)).filter((m) => m.sender_role === 'ai');
    assert.equal(rows[0].status, 'failed'); assert.equal(rows[0].error_code, '131047');
  });
});
