import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, MessageSquareText, Radio, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/ChatPanel';
import { ConversationList, type Filter } from '@/components/ConversationList';
import { formatAgo, isUnread } from '@/lib/format';
import type { Conversation, InboxBackend, IntegrationStatus, Message, SendInput, SendResult } from '@/lib/types';

interface Props {
  backend: InboxBackend;
  businessName?: string;
  onSignOut?: () => void;
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'неизвестная ошибка');

export function Inbox({ backend, businessName, onSignOut }: Props) {
  const demo = backend.mode === 'demo';
  const now = useNow(15_000);
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [live, setLive] = useState<'connecting' | 'on' | 'off'>('connecting');
  const [pending, setPending] = useState<Record<string, 'takeover' | 'resume'>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const refreshList = useCallback(async () => {
    try { setConvs(await backend.listConversations()); setLoadError(null); } catch (e) { setLoadError(errText(e)); }
  }, [backend]);

  const refreshMessages = useCallback(async (id: string) => {
    try {
      const rows = await backend.listMessages(id);
      if (selectedRef.current === id) setMessages(rows);
    } catch { /* keep what we have; realtime/next refresh will retry */ }
  }, [backend]);

  const refreshStatus = useCallback(async () => {
    try { setIntegration(await backend.integrationStatus()); } catch { setIntegration(null); }
  }, [backend]);

  // initial load + realtime + slow polling as a safety net
  useEffect(() => {
    void refreshList(); void refreshStatus();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = backend.subscribe(
      (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refreshList();
          if (e.table === 'messages' && e.conversationId && e.conversationId === selectedRef.current) void refreshMessages(e.conversationId);
        }, 200);
      },
      (s) => setLive(s),
    );
    const poll = setInterval(() => { void refreshList(); void refreshStatus(); if (selectedRef.current) void refreshMessages(selectedRef.current); }, 30_000);
    return () => { unsubscribe(); clearInterval(poll); clearTimeout(timer); };
  }, [backend, refreshList, refreshMessages, refreshStatus]);

  const selected = useMemo(() => convs?.find((c) => c.id === selectedId) ?? null, [convs, selectedId]);

  // opening a chat loads history and marks it read. Reading never changes the AI state.
  useEffect(() => {
    setMessages(null);
    if (!selectedId) return;
    void refreshMessages(selectedId);
  }, [selectedId, refreshMessages]);

  const needsRead = selected ? isUnread(selected) : false;
  useEffect(() => {
    if (selectedId && needsRead) void backend.action(selectedId, 'mark_read').then(refreshList);
  }, [selectedId, needsRead, backend, refreshList]);

  async function runAction(id: string, action: 'takeover' | 'resume') {
    setPending((p) => ({ ...p, [id]: action }));
    setActionError((e) => { const { [id]: _drop, ...rest } = e; return rest; });
    const r = await backend.action(id, action);
    setPending((p) => { const { [id]: _drop, ...rest } = p; return rest; });
    if (!r.ok) setActionError((e) => ({ ...e, [id]: r.error }));
    await refreshList(); // the UI shows only what the server confirms
    if (selectedRef.current === id) await refreshMessages(id);
  }

  async function send(input: SendInput): Promise<SendResult> {
    const r = await backend.sendReply(input);
    await Promise.all([refreshMessages(input.conversationId), refreshList()]);
    return r;
  }

  const unreadCount = (convs ?? []).filter(isUnread).length;
  const aiChecked = integration?.last_ai_check_at ?? null;

  return (
    <div className="flex h-dvh flex-col">
      {demo && (
        <div className="bg-fuchsia-700 px-3 py-1.5 text-center text-xs font-semibold text-white" role="status">
          ДЕМО · данные вымышлены · сообщения WhatsApp не отправляются
        </div>
      )}
      <header className={`${selectedId ? 'hidden md:flex' : 'flex'} items-center gap-3 border-b bg-card px-4 py-2.5`}>
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><MessageSquareText className="size-4" /></span>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold leading-tight">Satuu AI · Входящие</h1>
          <p className="truncate text-xs text-muted-foreground">{businessName ?? 'Демо-бизнес'}{unreadCount > 0 && ` · непрочитано: ${unreadCount}`}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!demo && (
            <>
              <Badge tone={live === 'on' ? 'emerald' : 'amber'} title="Обновления в реальном времени">
                <Radio className="size-3" />{live === 'on' ? 'Онлайн' : live === 'connecting' ? 'Подключение…' : 'Нет связи'}
              </Badge>
              <Badge tone={aiChecked ? 'neutral' : 'amber'} className="hidden sm:inline-flex" title="Когда n8n последний раз спрашивал, можно ли AI отвечать">
                <Unplug className="size-3" />{aiChecked ? `n8n: проверка ${formatAgo(aiChecked, now)}` : 'n8n: не подключено'}
              </Badge>
            </>
          )}
          {onSignOut && <Button variant="ghost" size="sm" onClick={onSignOut}><LogOut />Выйти</Button>}
        </div>
      </header>

      <main className="min-h-0 flex-1 md:grid md:grid-cols-[minmax(320px,380px)_1fr]">
        <div className={`${selectedId ? 'hidden md:block' : 'block'} h-full min-h-0`}>
          <ConversationList
            conversations={convs} loadError={loadError} selectedId={selectedId} onSelect={setSelectedId}
            filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} now={now}
          />
        </div>
        <section className={`${selectedId ? 'block' : 'hidden md:block'} h-full min-h-0`}>
          {selected ? (
            <ChatPanel
              key={selected.id}
              conv={selected} messages={messages} integration={integration} demo={demo} now={now}
              pendingAction={pending[selected.id]} actionError={actionError[selected.id]}
              onTakeover={() => runAction(selected.id, 'takeover')}
              onResume={() => runAction(selected.id, 'resume')}
              onSend={send}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="hidden h-full place-items-center text-center text-muted-foreground md:grid">
              <div><MessageSquareText className="mx-auto mb-3 size-10 opacity-40" /><p className="text-sm">Выберите диалог слева</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
