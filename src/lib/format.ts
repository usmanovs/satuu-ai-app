import type { Conversation, ConvState, LostReason, Message, MsgStatus } from './types';

export const PURCHASED_OPTION_LABEL: Record<'recordings' | 'live' | 'mentorship', string> = {
  recordings: 'Записи · $249',
  live: 'Live-занятия · $349',
  mentorship: 'Менторство 1:1 · $2 500',
};

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: 'Дорого',
  no_time: 'Нет времени',
  no_laptop: 'Нет ноутбука',
  trust: 'Нет доверия',
  other_topic: 'Нужно другое (например, видео)',
  later: 'Не сейчас',
  other: 'Другое',
};

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

/** A lead that is ready to buy and still open: shown with the glowing fire. Matches the 80+ alert threshold. */
export const HOT_ALERT_SCORE = 80;
export function isHotAlert(c: Conversation): boolean {
  return !c.contacts?.is_internal && !c.outcome && c.lead_score !== null && c.lead_score >= HOT_ALERT_SCORE;
}

/** The bot asked for a sales manager and no manager has opened the chat since. */
export function needsManager(c: Conversation): boolean {
  if (!c.manager_needed_at || c.outcome) return false;
  if (!c.manager_last_read_at) return true;
  return Date.parse(c.manager_last_read_at) < Date.parse(c.manager_needed_at);
}

/** Minutes a hot lead has been waiting for a person (null = not a hot lead waiting for a human). */
export function hotWaitingMin(c: Conversation, now: number = Date.now()): number | null {
  if (!c.hot_alerted_at || c.outcome || c.contacts?.is_internal) return null;
  const alerted = Date.parse(c.hot_alerted_at);
  if (c.last_manager_message_at && Date.parse(c.last_manager_message_at) >= alerted) return null;
  return Math.max(0, Math.floor((now - alerted) / 60_000));
}
export function formatWait(min: number): string {
  return min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60} мин`;
}

export function isUnread(c: Conversation): boolean {
  if (!c.last_inbound_at) return false;
  if (!c.manager_last_read_at) return true;
  return Date.parse(c.last_inbound_at) > Date.parse(c.manager_last_read_at);
}

/** Number shown on the unread badge: the real count when the backend knows it, otherwise at least 1. */
export function unreadBadge(c: Conversation): number {
  if (!isUnread(c)) return 0;
  return Math.max(1, c.unread_count ?? 1);
}

/** Counts customer messages newer than the manager's last read time, per conversation. */
export function countUnread(
  convs: Pick<Conversation, 'id' | 'manager_last_read_at'>[],
  inbound: { conversation_id: string; message_timestamp: string }[],
): Map<string, number> {
  const readAt = new Map(convs.map((c) => [c.id, c.manager_last_read_at ? Date.parse(c.manager_last_read_at) : 0]));
  const counts = new Map<string, number>();
  for (const m of inbound) {
    const r = readAt.get(m.conversation_id);
    if (r === undefined || Date.parse(m.message_timestamp) <= r) continue;
    counts.set(m.conversation_id, (counts.get(m.conversation_id) ?? 0) + 1);
  }
  return counts;
}

/** Voice notes arrive as a placeholder line, then the transcript after a microphone emoji (when it was recognised). */
export function splitVoice(body: string): { transcript: string | null } {
  const i = body.indexOf('🎤');
  const t = i >= 0 ? body.slice(i + 2).trim() : '';
  return { transcript: t || null };
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
  return dateTimeFmt.format(new Date(iso)).replace(',', '');
}
/** Chat list time: "только что", "5 мин назад", "3 ч назад" for the last 24 hours, then the date. */
export function formatListTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (now - t < 86_400_000 && now >= t - 60_000) return formatAgo(iso, now);
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

export const ROLE_LABEL: Record<'owner' | 'director' | 'manager', string> = {
  owner: 'Владелец',
  director: 'Директор по продажам',
  manager: 'Менеджер по продажам',
};

export function memberName(m: { display_name: string | null; email: string | null } | undefined): string {
  return m?.display_name?.trim() || m?.email || 'Сотрудник';
}

/** Chat-list preview: media placeholders become a short label with an icon. */
export function previewText(p: string | null): string {
  if (!p) return '—';
  if (p.startsWith('[Изображение')) return '📷 Фото';
  if (p.startsWith('[Видео')) return '🎥 Видео';
  if (p.startsWith('[Документ')) return '📄 Документ';
  if (p.startsWith('[Голосовое')) return '🎤 Голосовое сообщение';
  return p;
}

/** Open lead that went quiet for 3+ days and nobody marked the result (bought / won't buy). */
export const NO_OUTCOME_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export function needsOutcome(c: Conversation, now: number): boolean {
  if (c.contacts?.is_internal || c.outcome || !c.last_message_at) return false;
  return now - Date.parse(c.last_message_at) >= NO_OUTCOME_AFTER_MS;
}
