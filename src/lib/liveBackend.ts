import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActionResult, ChangeEvent, Conversation, InboxBackend, IntegrationStatus, Message, SendInput, SendResult, StateAction,
} from './types';

interface FnResponse { status: number; json: any }

/**
 * Reads go straight to Postgres under row-level security. Every write goes through the `inbox`
 * Edge Function, which derives the business and manager identity from the session token.
 */
export function createLiveBackend(supabase: SupabaseClient, functionsBaseUrl: string, anonKey: string): InboxBackend {
  async function callFn(path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<FnResponse> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { status: 401, json: { error: { code: 'unauthorized', message: 'Сессия истекла. Войдите снова.' } } };
    const res = await fetch(`${functionsBaseUrl}/functions/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${token}` },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  }

  return {
    mode: 'live',

    async listConversations() {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, contacts(wa_id, display_name)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Conversation[];
    },

    async listMessages(conversationId) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('message_timestamp', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Message[];
    },

    subscribe(onChange, onStatus) {
      const channel = supabase.channel('inbox-live');
      for (const table of ['conversations', 'messages', 'contacts'] as const) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as Record<string, unknown>;
          const e: ChangeEvent = {
            table,
            conversationId: table === 'messages' ? (row?.conversation_id as string | undefined) : table === 'conversations' ? (row?.id as string | undefined) : undefined,
          };
          onChange(e);
        });
      }
      channel.subscribe((s) => onStatus(s === 'SUBSCRIBED' ? 'on' : 'off'));
      return () => { void supabase.removeChannel(channel); };
    },

    async action(conversationId, action: StateAction): Promise<ActionResult> {
      try {
        const r = await callFn('inbox/conversation-action', { conversation_id: conversationId, action });
        if (r.status === 200 && r.json?.state) return { ok: true, state: r.json.state };
        return { ok: false, error: r.json?.error?.message ?? `Ошибка сервера (${r.status})` };
      } catch {
        return { ok: false, error: 'Нет связи с сервером. Действие не подтверждено.' };
      }
    },

    async sendReply(input: SendInput): Promise<SendResult> {
      let r: FnResponse;
      try {
        r = await callFn('inbox/send-reply', {
          conversation_id: input.conversationId,
          idempotency_key: input.idempotencyKey,
          text: input.text,
          use_template: input.useTemplate === true,
        });
      } catch {
        return { kind: 'network', error: 'Нет связи с сервером. Неизвестно, было ли сообщение отправлено.' };
      }
      const j = r.json;
      if (r.status === 200 && j?.status === 'accepted') return { kind: 'accepted', message: j.message };
      if (r.status === 200 && j?.created === false) {
        // Idempotent replay of an earlier attempt: report the stored truth, never a fresh success.
        const st = j.message?.status;
        if (st === 'failed') return { kind: 'failed', message: j.message, error: j.message.error_message ?? 'Не отправлено' };
        if (st === 'pending') return { kind: 'unconfirmed', message: j.message };
        return { kind: 'accepted', message: j.message };
      }
      if (r.status === 202 && j?.unconfirmed) return { kind: 'unconfirmed', message: j.message };
      if (r.status === 502 && j?.message) return { kind: 'failed', message: j.message, error: j.message.error_message ?? 'Не отправлено' };
      return { kind: 'rejected', error: j?.error?.message ?? `Ошибка сервера (${r.status})`, code: j?.error?.code ?? 'error' };
    },

    async integrationStatus(): Promise<IntegrationStatus> {
      const r = await callFn('inbox/status', undefined, 'GET');
      if (r.status !== 200) throw new Error(r.json?.error?.message ?? 'status unavailable');
      return r.json as IntegrationStatus;
    },
  };
}
