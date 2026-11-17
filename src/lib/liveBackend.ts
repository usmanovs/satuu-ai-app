import type { SupabaseClient } from '@supabase/supabase-js';
import { registerMediaResolver } from '@/lib/media';
import type {
  ActionResult, BotAlert, ChangeEvent, Conversation, FunnelStats, SalesReport, InboxBackend, IntegrationStatus, LinkResult, Me, Member, Message, NumberPatch, WaNumber, Outcome, OutcomeResult, SendInput, SendResult, SimpleResult, StateAction, TeamStats,
} from './types';
import { countUnread } from './format';

interface FnResponse { status: number; json: any }

/**
 * Reads go straight to Postgres under row-level security. Every write goes through the `inbox`
 * Edge Function, which derives the business and manager identity from the session token.
 */
export function createLiveBackend(supabase: SupabaseClient, functionsBaseUrl: string, anonKey: string): InboxBackend {
  registerMediaResolver(async (path) => {
    const { data } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  });
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

  async function simple(path: string, body: unknown): Promise<SimpleResult> {
    try {
      const r = await callFn(path, body);
      if (r.status === 200) return { ok: true };
      return { ok: false, error: r.json?.error?.message ?? `Ошибка сервера (${r.status})` };
    } catch {
      return { ok: false, error: 'Нет связи с сервером. Действие не подтверждено.' };
    }
  }

  async function link(path: string, body: unknown): Promise<LinkResult> {
    try {
      const r = await callFn(path, body);
      if (r.status === 200 && typeof r.json?.link === 'string') return { ok: true, link: r.json.link };
      return { ok: false, error: r.json?.error?.message ?? `Ошибка сервера (${r.status})` };
    } catch {
      return { ok: false, error: 'Нет связи с сервером. Действие не подтверждено.' };
    }
  }

  return {

    async listConversations() {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, contacts(wa_id, display_name, is_internal)')
        .is('hidden_at', null)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      // chats created by the automatic regression tests (numbers 99900...) are never shown
      const convs = ((data ?? []) as unknown as Conversation[]).filter((c) => !c.contacts?.wa_id?.startsWith('99900'));
      // unread badge numbers: customer messages newer than the manager's last read time (best effort; the list works without them)
      try {
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const { data: inbound } = await supabase
          .from('messages')
          .select('conversation_id, message_timestamp')
          .eq('direction', 'inbound').eq('is_placeholder', false).gte('message_timestamp', since)
          .order('message_timestamp', { ascending: false })
          .limit(2000);
        const counts = countUnread(convs, (inbound ?? []) as { conversation_id: string; message_timestamp: string }[]);
        for (const c of convs) c.unread_count = counts.get(c.id) ?? 0;
      } catch { /* badges fall back to a single unread marker */ }
      return convs;
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

    async setOutcome(conversationId, outcome: Outcome | 'open'): Promise<OutcomeResult> {
      try {
        const r = await callFn('inbox/conversation-outcome', { conversation_id: conversationId, outcome });
        if (r.status === 200 && r.json && 'outcome' in r.json) return { ok: true, outcome: r.json.outcome };
        return { ok: false, error: r.json?.error?.message ?? `Ошибка сервера (${r.status})` };
      } catch {
        return { ok: false, error: 'Нет связи с сервером. Результат не сохранён.' };
      }
    },

    async setLostReason(conversationId, reason): Promise<SimpleResult> {
      const { error } = await supabase.rpc('set_lost_reason', { p_conversation: conversationId, p_reason: reason });
      return error ? { ok: false, error: 'Не удалось сохранить причину. Попробуйте ещё раз.' } : { ok: true };
    },

    async setPurchasedOption(conversationId, option): Promise<SimpleResult> {
      const { error } = await supabase.rpc('set_purchased_option', { p_conversation: conversationId, p_option: option });
      return error ? { ok: false, error: 'Не удалось сохранить тариф. Попробуйте ещё раз.' } : { ok: true };
    },

    async funnelStats(days): Promise<FunnelStats> {
      const { data, error } = await supabase.rpc('funnel_stats', { p_days: days });
      if (error) throw new Error(error.message);
      return data as FunnelStats;
    },

    async listReports(): Promise<SalesReport[]> {
      const { data, error } = await supabase.from('sales_reports').select('id, created_at, period_start, period_end, body').order('created_at', { ascending: false }).limit(8);
      if (error) throw new Error(error.message);
      return (data ?? []) as SalesReport[];
    },

    async lostReasons(): Promise<Record<string, number>> {
      const { data, error } = await supabase.from('conversations').select('lost_reason, contacts(wa_id)').eq('outcome', 'lost').is('hidden_at', null);
      if (error) throw new Error(error.message);
      const out: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as { lost_reason: string | null; contacts: { wa_id: string } | null }[]) {
        if (r.contacts?.wa_id?.startsWith('99900')) continue;
        const k = r.lost_reason ?? 'none';
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    },

    async listNumbers(): Promise<WaNumber[]> {
      const { data, error } = await supabase.from('wa_numbers').select('*').order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as WaNumber[];
    },
    saveNumber: (numberId, patch: NumberPatch) => simple('inbox/number-save', { number_id: numberId, ...patch }),
    addNumber: (input) => simple('inbox/number-add', input),

    async me(): Promise<Me> {
      const r = await callFn('inbox/me', undefined, 'GET');
      if (r.status !== 200) throw new Error(r.json?.error?.message ?? 'me unavailable');
      return r.json as Me;
    },

    async listTeam(): Promise<Member[]> {
      const r = await callFn('inbox/team', undefined, 'GET');
      if (r.status !== 200) throw new Error(r.json?.error?.message ?? 'team unavailable');
      return (r.json?.members ?? []) as Member[];
    },

    async teamStats(days: number): Promise<TeamStats> {
      const r = await callFn('inbox/team-stats', { days });
      if (r.status !== 200) throw new Error(r.json?.error?.message ?? 'stats unavailable');
      return r.json as TeamStats;
    },

    assign: (conversationId, userId) => simple('inbox/assign', { conversation_id: conversationId, assigned_to: userId }),
    addMember: (input) => link('inbox/team-add', input),
    memberLink: (userId) => link('inbox/team-link', { user_id: userId }),
    updateMember: (userId, patch) => simple('inbox/team-update', { user_id: userId, ...patch }),
    removeMember: (userId) => simple('inbox/team-remove', { user_id: userId }),

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

    async listBotAlerts() {
      const { data, error } = await supabase
        .from('bot_alerts')
        .select('id, kind, title, detail, workflow, node, occurrences, created_at, last_seen_at')
        .is('resolved_at', null)
        .order('last_seen_at', { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as BotAlert[];
    },

    async integrationStatus(): Promise<IntegrationStatus> {
      const r = await callFn('inbox/status', undefined, 'GET');
      if (r.status !== 200) throw new Error(r.json?.error?.message ?? 'status unavailable');
      return r.json as IntegrationStatus;
    },
  };
}
