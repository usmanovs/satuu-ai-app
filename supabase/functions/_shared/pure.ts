// Pure helpers: no Deno or Supabase imports, so they are unit-tested with vitest.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Machine codes raised by the SQL functions -> HTTP status + operator-readable text.
const DB_ERRORS: Record<string, [number, string]> = {
  not_a_message: [422, 'Квитанция статуса не является сообщением. Отправляйте её на /message-status.'],
  invalid_sender_id: [422, 'Не указан sender_id.'],
  invalid_provider_message_id: [422, 'Не указан provider_message_id.'],
  invalid_status: [422, 'Недопустимый статус.'],
  invalid_stage: [422, 'stage должен быть before_generate или before_send.'],
  invalid_action: [422, 'Недопустимое действие.'],
  invalid_outcome: [422, 'outcome должен быть won, lost или open.'],
  invalid_text: [422, 'Текст сообщения пуст или слишком длинный.'],
  invalid_idempotency_key: [422, 'Недопустимый ключ идемпотентности.'],
  unknown_conversation: [404, 'Диалог не найден.'],
  unknown_message: [404, 'Сообщение не найдено.'],
  unknown_trigger: [404, 'trigger_message_id не найден среди входящих сообщений клиента этого бизнеса.'],
  stale_trigger: [409, 'trigger_message_id слишком старый (допустимо до 15 минут).'],
  not_found: [404, 'Диалог не найден.'],
  not_human_handling: [409, 'Отправка возможна только в режиме «Диалог у менеджера». Сначала возьмите диалог.'],
  window_closed: [422, 'Окно 24 часа закрыто: свободный текст отправить нельзя, нужен одобренный шаблон.'],
  template_not_configured: [503, 'Шаблон не подключён.'],
};

export function mapDbError(raw: string | undefined | null): HttpError {
  const code = (raw ?? '').trim();
  const hit = DB_ERRORS[code];
  if (hit) return new HttpError(hit[0], code, hit[1]);
  // Never leak SQL error text to callers.
  return new HttpError(500, 'internal_error', 'Внутренняя ошибка сервера.');
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bearerToken(authHeader: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? '');
  return m ? m[1] : null;
}

/** ISO string, unix seconds (WhatsApp style), or unix ms. Returns null when absent. */
export function parseTimestamp(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  let ms: number;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
    const n = Number(v);
    ms = String(Math.trunc(n)).length <= 11 ? n * 1000 : n;
  } else if (typeof v === 'string') {
    ms = Date.parse(v);
  } else {
    throw new HttpError(422, 'invalid_timestamp', 'Недопустимый формат timestamp.');
  }
  if (!Number.isFinite(ms)) throw new HttpError(422, 'invalid_timestamp', 'Недопустимый формат timestamp.');
  return new Date(ms).toISOString();
}

export function reqStr(b: Record<string, unknown>, key: string, max = 512): string {
  const v = b[key];
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(422, 'missing_field', `Поле «${key}» обязательно.`);
  }
  const s = String(v).trim();
  if (!s || s.length > max) throw new HttpError(422, 'invalid_field', `Поле «${key}» пустое или слишком длинное.`);
  return s;
}

export function optStr(b: Record<string, unknown>, key: string, max = 4096): string | null {
  const v = b[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(422, 'invalid_field', `Поле «${key}» должно быть строкой.`);
  }
  const s = String(v);
  if (s.length > max) throw new HttpError(422, 'invalid_field', `Поле «${key}» слишком длинное.`);
  return s;
}

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp customer-service window: free-form replies only within 24h of the customer's last message. */
export function isWithinServiceWindow(lastInboundAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && now - t < SERVICE_WINDOW_MS;
}

export type SendOutcome =
  | { status: 'accepted' }
  | { status: 'failed'; errorCode: string; errorMessage: string }
  // Unknown result: n8n may or may not have sent it. NEVER retry automatically.
  | { status: 'pending'; reason: string };

/**
 * Interprets n8n's answer to a human-reply request.
 *  2xx          -> n8n accepted the job (NOT delivered).
 *  4xx (not 408)-> n8n refused before sending: definite failure.
 *  5xx/408/network error/timeout -> ambiguous: stays pending, no automatic retry.
 */
export function classifyN8nResponse(r: { httpStatus: number } | { networkError: string }): SendOutcome {
  if ('networkError' in r) return { status: 'pending', reason: `network:${r.networkError}` };
  const s = r.httpStatus;
  if (s >= 200 && s < 300) return { status: 'accepted' };
  if (s === 408 || s >= 500) return { status: 'pending', reason: `http_${s}` };
  return { status: 'failed', errorCode: `n8n_http_${s}`, errorMessage: `n8n отклонил запрос (HTTP ${s})` };
}
