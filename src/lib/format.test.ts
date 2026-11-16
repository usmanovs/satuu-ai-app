import { describe, expect, test } from 'vitest';
import { displayName, inServiceWindow, isUnread, statusView } from './format';
import type { Conversation } from './types';

const H = 3_600_000;
const now = Date.parse('2026-10-29T12:00:00Z');
const iso = (agoMs: number) => new Date(now - agoMs).toISOString();

describe('service window', () => {
  test('open within 24h, closed after, closed when never inbound', () => {
    expect(inServiceWindow(iso(23 * H), now)).toBe(true);
    expect(inServiceWindow(iso(24 * H), now)).toBe(false);
    expect(inServiceWindow(iso(30 * H), now)).toBe(false);
    expect(inServiceWindow(null, now)).toBe(false);
  });
});

describe('status view', () => {
  const base = { status_updated_at: iso(1000), error_message: null };
  test('accepted is never presented as delivered', () => {
    const v = statusView({ ...base, status: 'accepted' }, now);
    expect(v.label).toBe('Принято к отправке');
    expect(v.label).not.toMatch(/Доставлено/);
    expect(v.ticks).toBe(1);
  });
  test('delivered and read show double ticks', () => {
    expect(statusView({ ...base, status: 'delivered' }, now).ticks).toBe(2);
    expect(statusView({ ...base, status: 'read' }, now).tone).toBe('read');
  });
  test('failed shows the error; stale pending warns', () => {
    expect(statusView({ ...base, status: 'failed', error_message: 'oops' }, now)).toMatchObject({ tone: 'error', label: 'Не отправлено: oops' });
    expect(statusView({ status: 'pending', status_updated_at: iso(10 * 60_000), error_message: null }, now).tone).toBe('warn');
    expect(statusView({ ...base, status: 'pending' }, now).label).toBe('Отправляется…');
  });
});

describe('conversation helpers', () => {
  const c = (over: Partial<Conversation>): Conversation => ({
    id: '1', business_id: 'b', contact_id: 'c', state: 'ai_active', state_version: 1, state_updated_at: iso(0), state_note: null,
    last_inbound_at: iso(1000), last_message_at: iso(1000), last_message_preview: 'x', manager_last_read_at: null, manager_needed_at: null, manager_needed_reason: null,
    assigned_to: null, assigned_at: null, wa_number_id: 'n1',
    lead_score: null, lead_label: null, lead_reason: null, lead_scored_at: null, outcome: null, outcome_at: null,
    contacts: { wa_id: '996700000001', display_name: null }, ...over,
  });
  test('unread when inbound is newer than last read', () => {
    expect(isUnread(c({}))).toBe(true);
    expect(isUnread(c({ manager_last_read_at: iso(0) }))).toBe(false);
    expect(isUnread(c({ last_inbound_at: null }))).toBe(false);
  });
  test('name falls back to the WhatsApp number', () => {
    expect(displayName(c({}))).toBe('+996700000001');
    expect(displayName(c({ contacts: { wa_id: '1', display_name: ' Айбек ' } }))).toBe('Айбек');
  });
});

describe('list time and unread counts', () => {
  test('recent chats show relative time, older ones the date', async () => {
    const { formatListTime } = await import('./format');
    expect(formatListTime(iso(20_000), now)).toBe('только что');
    expect(formatListTime(iso(5 * 60_000), now)).toBe('5 мин назад');
    expect(formatListTime(iso(3 * H), now)).toBe('3 ч назад');
    expect(formatListTime(null, now)).toBe('');
  });
  test('counts only customer messages newer than the last read time', async () => {
    const { countUnread, splitVoice } = await import('./format');
    const m = (id: string, agoMs: number) => ({ conversation_id: id, message_timestamp: iso(agoMs) });
    const counts = countUnread(
      [{ id: 'a', manager_last_read_at: iso(2 * H) }, { id: 'b', manager_last_read_at: null }],
      [m('a', 3 * H), m('a', H), m('a', 60_000), m('b', H), m('zzz', H)],
    );
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.has('zzz')).toBe(false);
    expect(splitVoice('[Голосовое сообщение]\n🎤 Привет').transcript).toBe('Привет');
    expect(splitVoice('[Голосовое сообщение]').transcript).toBeNull();
  });
});
