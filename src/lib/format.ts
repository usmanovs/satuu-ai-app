import type { Conversation, ConvState, Message, MsgStatus } from './types';

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A pending message with no answer for this long is shown as "no confirmation". */
export const STALE_PENDING_MS = 60 * 1000;

export const STATE_LABEL: Record<ConvState, string> = {
  ai_active: 'AI отвечает',
  human_requested: 'Нужен человек',
  human_handling: 'У менеджера',
};

export function displayName(c: Pick<Conversation, 'contacts'>): string {
  const n = c.contacts.display_name?.trim();
  return n || `+${c.contacts.wa_id}`;
}

export function isUnread(c: Conversation): boolean {
  if (!c.last_inbound_at) return false;
  if (!c.manager_last_read_at) return true;
  return Date.parse(c.last_inbound_at) > Date.parse(c.manager_last_read_at);
}

/** WhatsApp customer-service window: free-form replies only within 24h of the customer's last message. */
export function inServiceWindow(lastInboundAt: string | null, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && now - t < SERVICE_WINDOW_MS;
}

export function windowRemaining(lastInboundAt: string | null, now: number = Date.now()): string | null {
  if (!inServiceWindow(lastInboundAt, now)) return null;
  const left = SERVICE_WINDOW_MS - (now - Date.parse(lastInboundAt!));
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
export function formatListTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return sameDay(t, now) ? timeFmt.format(t) : dateTimeFmt.format(t).replace(',', '');
}
export function formatDay(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (sameDay(t, now)) return 'Сегодня';
  if (sameDay(t, now - 86_400_000)) return 'Вчера';
  return dayFmt.format(t);
}
export function formatAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86_400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86_400)} дн назад`;
}

export interface StatusView {
  label: string;
  /** 0 none, 1 single tick, 2 double tick */
  ticks: 0 | 1 | 2;
  tone: 'muted' | 'ok' | 'read' | 'warn' | 'error';
}

/**
 * "accepted" means the WhatsApp API took the message for sending. It is NOT shown as delivered.
 */
export function statusView(m: Pick<Message, 'status' | 'status_updated_at' | 'error_message'>, now: number = Date.now()): StatusView {
  const s: MsgStatus = m.status;
  switch (s) {
    case 'pending':
      return now - Date.parse(m.status_updated_at) > STALE_PENDING_MS
        ? { label: 'Нет подтверждения', ticks: 0, tone: 'warn' }
        : { label: 'Отправляется…', ticks: 0, tone: 'muted' };
    case 'accepted': return { label: 'Принято к отправке', ticks: 1, tone: 'muted' };
    case 'sent': return { label: 'Отправлено', ticks: 1, tone: 'ok' };
    case 'delivered': return { label: 'Доставлено', ticks: 2, tone: 'ok' };
    case 'read': return { label: 'Прочитано', ticks: 2, tone: 'read' };
    case 'failed': return { label: m.error_message ? `Не отправлено: ${m.error_message}` : 'Не отправлено', ticks: 0, tone: 'error' };
    default: return { label: '', ticks: 0, tone: 'muted' };
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
