import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { flattenBatch } = require('./flatten-batch.cjs');
const { validateHumanSend } = require('./validate-human-send.cjs');

describe('flattenBatch: every message and status in a batch is processed', () => {
  const value = {
    contacts: [{ wa_id: '996700000001', profile: { name: 'Айбек' } }, { wa_id: '996700000002', profile: { name: 'Динара' } }],
    messages: [
      { from: '996700000002', id: 'wamid.B', type: 'text', timestamp: '1793276200', text: { body: 'Второй' } },
      { from: '996700000001', id: 'wamid.A', type: 'text', timestamp: '1793276100', text: { body: 'Первый' } },
      { from: '996700000001', id: 'wamid.IMG', type: 'image', timestamp: '1793276300', image: { caption: 'скан' } },
    ],
    statuses: [
      { id: 'wamid.OUT1', status: 'delivered', timestamp: '1793276150' },
      { id: 'wamid.OUT2', status: 'failed', timestamp: '1793276160', errors: [{ code: 131047, title: 'Re-engagement message' }] },
      { id: 'wamid.OUT3', status: 'deleted', timestamp: '1793276170' },
    ],
  };
  const raw = { entry: [{ changes: [{ field: 'messages', value }] }, { changes: [{ field: 'messages', value: { messages: [{ from: '996700000009', id: 'wamid.C', type: 'text', timestamp: '1793276400', text: { body: 'Из второй записи' } }] } }] }] };

  test('trigger output (value object): all items, oldest first, per-contact names, junk statuses dropped', () => {
    const out = flattenBatch([value]);
    expect(out.map((o: any) => o.provider_message_id)).toEqual(['wamid.A', 'wamid.OUT1', 'wamid.OUT2', 'wamid.B', 'wamid.IMG']);
    expect(out.find((o: any) => o.provider_message_id === 'wamid.B')).toMatchObject({ kind: 'message', display_name: 'Динара', text: 'Второй' });
    expect(out.find((o: any) => o.provider_message_id === 'wamid.IMG')).toMatchObject({ type: 'image', text: 'скан' });
    expect(out.find((o: any) => o.provider_message_id === 'wamid.OUT2')).toMatchObject({ kind: 'status', error_code: '131047' });
    expect(out.some((o: any) => o.provider_message_id === 'wamid.OUT3')).toBe(false);
  });
  test('raw Cloud API body: every entry and change is read, also when wrapped in `body`', () => {
    expect(flattenBatch([raw]).length).toBe(6);
    expect(flattenBatch([{ body: raw }]).length).toBe(6);
  });
  test('several incoming items are all flattened', () => {
    expect(flattenBatch([value, value]).length).toBe(10);
  });
});

describe('validateHumanSend: validate before acknowledging', () => {
  const biz = 'b1000000-0000-0000-0000-0000000000b1';
  const good = { event: 'human_reply', business_id: biz, idempotency_key: '6f1c0f3e-0b8e-4a39-9d52-5a2d7f6b9c11', type: 'text' };
  test('accepts a valid text request', () => expect(validateHumanSend(good, biz, good.idempotency_key)).toMatchObject({ ok: true }));
  test('rejects wrong business, bad key, bad type, mismatching header', () => {
    expect(validateHumanSend({ ...good, business_id: 'other' }, biz)).toMatchObject({ ok: false, status: 403 });
    expect(validateHumanSend({ ...good, idempotency_key: 'abc' }, biz)).toMatchObject({ ok: false, status: 422 });
    expect(validateHumanSend({ ...good, type: 'image' }, biz)).toMatchObject({ ok: false, status: 422 });
    expect(validateHumanSend(good, biz, '11111111-1111-1111-1111-111111111111')).toMatchObject({ ok: false, error: 'idempotency_key_mismatch' });
    expect(validateHumanSend(null, biz)).toMatchObject({ ok: false, status: 400 });
    expect(validateHumanSend(good, '')).toMatchObject({ ok: false, status: 403 });
  });
  test('template needs a sane language code', () => {
    expect(validateHumanSend({ ...good, type: 'template', template: { language: 'ru' } }, biz)).toMatchObject({ ok: true, value: { template_language: 'ru' } });
    expect(validateHumanSend({ ...good, type: 'template', template: { language: 'ru; drop' } }, biz)).toMatchObject({ ok: false });
  });
});
