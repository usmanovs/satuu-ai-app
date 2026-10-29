// DEMO BACKEND. Entirely in memory: no network calls, no Supabase, no WhatsApp.
// It exists only to show the UI with fictional data and can never send a real message.
import { inServiceWindow } from './format';
import type {
  ActionResult, ChangeEvent, Conversation, ConvState, InboxBackend, IntegrationStatus, Message, Outcome, OutcomeResult, SendInput, SendResult, StateAction,
} from './types';

const MIN = 60_000, HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function conv(id: string, wa: string, name: string | null, state: ConvState, lastInboundAgo: number | null, preview: string, readAgo: number | null, note: string | null = null): Conversation {
  return {
    id, business_id: 'demo', contact_id: `contact-${id}`, state, state_version: 1, state_updated_at: ago(lastInboundAgo ?? 0), state_note: note,
    last_inbound_at: lastInboundAgo === null ? null : ago(lastInboundAgo),
    last_message_at: ago(lastInboundAgo ?? 0), last_message_preview: preview,
    manager_last_read_at: readAgo === null ? null : ago(readAgo),
    lead_score: null, lead_label: null, lead_reason: null, lead_scored_at: null, outcome: null, outcome_at: null,
    contacts: { wa_id: wa, display_name: name },
  };
}

let seq = 0;
function msg(conversationId: string, role: Message['sender_role'], body: string, agoMs: number, status: Message['status'], extra: Partial<Message> = {}): Message {
  seq += 1;
  const t = ago(agoMs);
  return {
    id: `demo-m${seq}`, conversation_id: conversationId, provider_message_id: `demo.wamid.${seq}`, idempotency_key: null,
    sender_role: role, direction: role === 'customer' ? 'inbound' : 'outbound', message_type: 'text', body, is_placeholder: false,
    template_name: null, message_timestamp: t, status, status_updated_at: t, error_code: null, error_message: null, ...extra,
  };
}

function seed(): { convs: Conversation[]; msgs: Record<string, Message[]> } {
  const convs = [
    conv('d1', '996700111222', 'Айгерим', 'human_requested', 4 * MIN, 'Позовите менеджера, хочу обсудить оплату', null, 'Клиент попросил человека (автоопределение по тексту)'),
    conv('d2', '996555333444', 'Бекзат', 'ai_active', 22 * MIN, 'А есть группа на кыргызском?', null),
    conv('d3', '996777555666', null, 'human_handling', 50 * MIN, 'Хорошо, жду звонка', 40 * MIN),
    conv('d4', '996222888999', 'Нурлан (турагентство)', 'ai_active', 30 * HOUR, '[Изображение — ассистент не обрабатывает изображения]', 29 * HOUR),
    conv('d5', '996700999000', 'Динара', 'ai_active', 3 * HOUR, 'Спасибо, всё понятно!', 3 * HOUR - MIN),
  ];
  const score = (c: Conversation, n: number, reason: string) => {
    c.lead_score = n; c.lead_label = n >= 70 ? 'hot' : n >= 40 ? 'warm' : 'cold'; c.lead_reason = reason; c.lead_scored_at = ago(MIN);
  };
  score(convs[0], 84, 'Спросил цену и оплату частями, просит менеджера');
  score(convs[1], 52, 'Интересуется языком группы, цену уже знает');
  score(convs[3], 18, 'Только прислал изображение, вопросов о покупке нет');
  const msgs: Record<string, Message[]> = {
    d1: [
      msg('d1', 'customer', 'Здравствуйте! Сколько стоит курс «SMM с нуля»?', 20 * MIN, 'received'),
      msg('d1', 'ai', 'Здравствуйте! Курс «SMM с нуля» — 12 000 сом за 6 недель. Рассказать про программу?', 19 * MIN, 'read'),
      msg('d1', 'customer', 'Можно оплатить частями?', 8 * MIN, 'received'),
      msg('d1', 'ai', 'Условия оплаты уточнит администратор. Передать ему ваш вопрос?', 7 * MIN, 'delivered'),
      msg('d1', 'customer', 'Позовите менеджера, хочу обсудить оплату', 4 * MIN, 'received'),
    ],
    d2: [
      msg('d2', 'customer', 'Саламатсызбы! Курс канча турат?', 30 * MIN, 'received'),
      msg('d2', 'ai', 'Саламатсызбы! «SMM нөлдөн баштап» курсу — 12 000 сом, 6 жума.', 29 * MIN, 'read'),
      msg('d2', 'customer', 'А есть группа на кыргызском?', 22 * MIN, 'received'),
    ],
    d3: [
      msg('d3', 'customer', 'Здравствуйте, нужна консультация по туру на Иссык-Куль', 2 * HOUR, 'received'),
      msg('d3', 'ai', 'Здравствуйте! Подскажу по турам. Сколько вас человек и на какие даты?', 2 * HOUR - MIN, 'read'),
      msg('d3', 'customer', 'Лучше поговорю с менеджером', 55 * MIN, 'received'),
      msg('d3', 'manager', 'Добрый день! Меня зовут Азамат, я менеджер. Давайте обсудим детали.', 52 * MIN, 'read'),
      msg('d3', 'customer', 'Хорошо, жду звонка', 50 * MIN, 'received'),
      msg('d3', 'manager', 'Позвоню вам в течение 10 минут.', 48 * MIN, 'failed', { error_message: 'Ошибка отправки (демо)', error_code: 'demo_failed' }),
    ],
    d4: [
      msg('d4', 'customer', 'Вот скан договора', 30 * HOUR, 'received', { message_type: 'image', is_placeholder: true, body: '[Изображение — ассистент не обрабатывает изображения]' }),
    ],
    d5: [
      msg('d5', 'customer', 'Есть доставка по Бишкеку?', 3 * HOUR + 2 * MIN, 'received'),
      msg('d5', 'ai', 'Да, доставляем по Бишкеку за 1–2 дня.', 3 * HOUR + MIN, 'delivered'),
      msg('d5', 'customer', 'Спасибо, всё понятно!', 3 * HOUR, 'received'),
    ],
  };
  return { convs, msgs };
}

export function createDemoBackend(): InboxBackend {
  const data = seed();
  const listeners = new Set<(e: ChangeEvent) => void>();
  const emit = (e: ChangeEvent) => listeners.forEach((l) => l(e));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const byId = (id: string) => data.convs.find((c) => c.id === id);
  const sorted = () => [...data.convs].sort((a, b) => Date.parse(b.last_message_at ?? '0') - Date.parse(a.last_message_at ?? '0'));

  return {
    mode: 'demo',
    async listConversations() { return structuredClone(sorted()); },
    async listMessages(id) { return structuredClone(data.msgs[id] ?? []); },
    subscribe(onChange, onStatus) {
      listeners.add(onChange); onStatus('on');
      return () => { listeners.delete(onChange); };
    },
    async action(id, action: StateAction): Promise<ActionResult> {
      await sleep(600); // visible "pending" state, like a real round trip
      const c = byId(id);
      if (!c) return { ok: false, error: 'Диалог не найден.' };
      if (action === 'takeover' && c.state !== 'human_handling') { c.state = 'human_handling'; c.state_version += 1; c.state_note = null; c.state_updated_at = new Date().toISOString(); }
      if (action === 'resume' && c.state !== 'ai_active') { c.state = 'ai_active'; c.state_version += 1; c.state_note = null; c.state_updated_at = new Date().toISOString(); }
      if (action === 'mark_read' || action === 'takeover') c.manager_last_read_at = new Date().toISOString();
      emit({ table: 'conversations', conversationId: id });
      return { ok: true, state: c.state };
    },
    async setOutcome(id, outcome: Outcome | 'open'): Promise<OutcomeResult> {
      await sleep(300);
      const c = byId(id);
      if (!c) return { ok: false, error: 'Диалог не найден.' };
      c.outcome = outcome === 'open' ? null : outcome;
      c.outcome_at = outcome === 'open' ? null : new Date().toISOString();
      emit({ table: 'conversations', conversationId: id });
      return { ok: true, outcome: c.outcome };
    },
    async sendReply(input: SendInput): Promise<SendResult> {
      await sleep(400);
      const c = byId(input.conversationId);
      if (!c) return { kind: 'rejected', error: 'Диалог не найден.', code: 'not_found' };
      if (c.state !== 'human_handling') return { kind: 'rejected', error: 'Отправка возможна только в режиме «У менеджера».', code: 'not_human_handling' };
      if (!inServiceWindow(c.last_inbound_at) && !input.useTemplate) return { kind: 'rejected', error: 'Окно 24 часа закрыто: нужен одобренный шаблон.', code: 'window_closed' };
      const list = (data.msgs[c.id] ??= []);
      const existing = list.find((m) => m.idempotency_key === input.idempotencyKey);
      if (existing) return { kind: 'accepted', message: structuredClone(existing) };
      const body = input.useTemplate ? '[Шаблон: demo_template]' : (input.text ?? '').trim();
      const m = msg(c.id, 'manager', body, 0, 'accepted', { idempotency_key: input.idempotencyKey, message_type: input.useTemplate ? 'template' : 'text', template_name: input.useTemplate ? 'demo_template' : null });
      list.push(m);
      c.last_message_at = m.message_timestamp; c.last_message_preview = body;
      emit({ table: 'messages', conversationId: c.id });
      // Simulated receipts. Nothing leaves the browser.
      setTimeout(() => { m.status = 'sent'; m.status_updated_at = new Date().toISOString(); emit({ table: 'messages', conversationId: c.id }); }, 1800);
      return { kind: 'accepted', message: structuredClone(m) };
    },
    async integrationStatus(): Promise<IntegrationStatus> {
      return { send_configured: true, template_configured: true, last_ai_check_at: new Date().toISOString(), last_ingest_at: new Date().toISOString() };
    },
  };
}
