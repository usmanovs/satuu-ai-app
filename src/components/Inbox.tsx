import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, MessageSquareText, Moon, Radio, Sun, Unplug, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/ChatPanel';
import { ConversationList, type Filter } from '@/components/ConversationList';
import { TeamPanel } from '@/components/TeamPanel';
import { formatAgo, isHotAlert, isUnread, memberName, needsManager, ROLE_LABEL } from '@/lib/format';
import type { BotAlert, Conversation, InboxBackend, IntegrationStatus, Me, Member, Message, Outcome, SendInput, SendResult, WaNumber } from '@/lib/types';

interface Props {
  backend: InboxBackend;
  businessName?: string;
  onSignOut?: () => void;
  onChangePassword?: (password: string) => Promise<string | null>;
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

type Theme = 'light' | 'dark';
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem('theme', next); } catch { /* private mode: the choice just is not remembered */ }
      return next;
    });
  }, []);
  return [theme, toggle];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'неизвестная ошибка');

export function Inbox({ backend, businessName, onSignOut, onChangePassword }: Props) {
  const now = useNow(15_000);
  const [theme, toggleTheme] = useTheme();
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sortByLead, setSortByLead] = useState(false);
  const [view, setView] = useState<'inbox' | 'team'>('inbox');
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [assignee, setAssignee] = useState('all');
  const [outcomeBusy, setOutcomeBusy] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<Record<string, string>>({});
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [live, setLive] = useState<'connecting' | 'on' | 'off'>('connecting');
  const [botAlerts, setBotAlerts] = useState<BotAlert[]>([]);
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

  const refreshMembers = useCallback(async () => {
    try { setMembers(await backend.listTeam()); } catch { /* names fall back to "Сотрудник" */ }
  }, [backend]);

  const refreshNumbers = useCallback(async () => {
    try { setNumbers(await backend.listNumbers()); } catch { /* the chat list works without numbers */ }
  }, [backend]);

  const refreshStatus = useCallback(async () => {
    try { setIntegration(await backend.integrationStatus()); } catch { setIntegration(null); }
    try { setBotAlerts(await backend.listBotAlerts()); } catch { /* the banner just stays as it was */ }
  }, [backend]);

  // initial load + realtime + slow polling as a safety net
  useEffect(() => {
    void refreshList(); void refreshStatus(); void refreshMembers(); void refreshNumbers();
    backend.me().then(setMe).catch(() => setMe(null));
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
  }, [backend, refreshList, refreshMembers, refreshNumbers, refreshMessages, refreshStatus]);

  // phones: opening a chat adds a history step, so the system Back gesture returns to the list instead of leaving the app
  useEffect(() => {
    if (selectedId) {
      if (window.history.state?.chat !== selectedId) window.history.pushState({ chat: selectedId }, '');
    }
  }, [selectedId]);
  useEffect(() => {
    const onPop = () => setSelectedId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const closeChat = useCallback(() => {
    if (window.history.state?.chat) window.history.back(); else setSelectedId(null);
  }, []);

  const selected = useMemo(() => convs?.find((c) => c.id === selectedId) ?? null, [convs, selectedId]);

  // opening a chat loads history and marks it read. Reading never changes the AI state.
  useEffect(() => {
    setMessages(null);
    if (!selectedId) return;
    void refreshMessages(selectedId);
  }, [selectedId, refreshMessages]);

  const needsRead = selected ? isUnread(selected) || needsManager(selected) : false;
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

  async function assignTo(id: string, userId: string | null): Promise<string | null> {
    const r = await backend.assign(id, userId);
    await refreshList(); // the UI shows only what the server confirms
    return r.ok ? null : r.error;
  }

  async function runOutcome(id: string, outcome: Outcome | 'open') {
    setOutcomeBusy(id);
    setOutcomeError((e) => { const { [id]: _drop, ...rest } = e; return rest; });
    const r = await backend.setOutcome(id, outcome);
    setOutcomeBusy(null);
    if (!r.ok) setOutcomeError((e) => ({ ...e, [id]: r.error }));
    await refreshList(); // shown only after the server confirms
  }

  async function send(input: SendInput): Promise<SendResult> {
    const r = await backend.sendReply(input);
    await Promise.all([refreshMessages(input.conversationId), refreshList()]);
    return r;
  }

  const unreadCount = (convs ?? []).filter(isUnread).length;
  const hotCount = (convs ?? []).filter(isHotAlert).length;
  const managerCount = (convs ?? []).filter(needsManager).length;
  const aiChecked = integration?.last_ai_check_at ?? null;

  return (
    <div className="flex h-dvh flex-col">
      {botAlerts.length > 0 && me?.role !== 'manager' && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900" role="alert">
          {botAlerts.map((a) => (
            <p key={a.id} className="flex flex-wrap items-baseline gap-x-2">
              <span aria-hidden>{a.kind === 'tests_failed' ? '🧪' : '⚠️'}</span>
              <b>{a.title}</b>
              {a.detail && <span className="text-red-800/90">{a.detail}</span>}
              <span className="text-xs text-red-700/80">
                {a.occurrences > 1 ? `${a.occurrences} раз · ` : ''}последний раз {formatAgo(a.last_seen_at, now)}
              </span>
            </p>
          ))}
          <p className="mt-0.5 text-xs text-red-700/80">Предупреждение исчезнет само: когда бот снова ответит клиенту или автотесты пройдут.</p>
        </div>
      )}
      <header className={`${selectedId ? 'hidden md:flex' : 'flex'} items-center gap-3 border-b bg-card px-4 py-2.5`}>
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><MessageSquareText className="size-4" /></span>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold leading-tight">Satuu AI · Входящие</h1>
          <p className="truncate text-xs text-muted-foreground">{businessName ?? 'Демо-бизнес'}{unreadCount > 0 && ` · непрочитано: ${unreadCount}`}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {managerCount > 0 && (
            <button
              onClick={() => { setFilter('needs_manager'); setView('inbox'); setSelectedId(null); }}
              title="AI просит подключить менеджера: нажмите, чтобы показать такие диалоги"
              className="manager-pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800"
            >
              <span className="wave text-sm" role="img" aria-label="Нужен менеджер">🙋</span>
              {managerCount}<span className="hidden lg:inline"> {managerCount === 1 ? 'нужен менеджер' : 'нужны менеджеру'}</span>
            </button>
          )}
          {hotCount > 0 && (
            <button
              onClick={() => { setSortByLead(true); setView('inbox'); setSelectedId(null); }}
              title="Горячие лиды готовы купить: нажмите, чтобы показать их первыми"
              className="fire-pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-800"
            >
              <span className="fire text-sm" role="img" aria-label="Горячие лиды">🔥</span>
              {hotCount}<span className="hidden lg:inline"> {hotCount === 1 ? 'горячий лид' : 'горячих'}</span>
            </button>
          )}
          <Badge tone={live === 'on' ? 'emerald' : 'amber'} title="Обновления в реальном времени">
            <Radio className="size-3" />{live === 'on' ? 'Онлайн' : live === 'connecting' ? 'Подключение…' : 'Нет связи'}
          </Badge>
          <Badge tone={aiChecked ? 'neutral' : 'amber'} className="hidden sm:inline-flex" title="Когда n8n последний раз спрашивал, можно ли AI отвечать">
            <Unplug className="size-3" />{aiChecked ? `n8n: проверка ${formatAgo(aiChecked, now)}` : 'n8n: не подключено'}
          </Badge>
          {me && (
            <>
              <Badge tone="neutral" className="hidden md:inline-flex" title={me.email ?? undefined}>{ROLE_LABEL[me.role]} · {memberName(me)}</Badge>
              <Button variant={view === 'team' ? 'default' : 'outline'} size="sm" onClick={() => setView(view === 'team' ? 'inbox' : 'team')}>
                <Users />{view === 'team' ? 'К диалогам' : me.role === 'manager' ? 'Моя статистика' : 'Команда'}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          {onSignOut && <Button variant="ghost" size="sm" onClick={onSignOut}><LogOut />Выйти</Button>}
        </div>
      </header>

      {view === 'team' && me ? (
        <main className="min-h-0 flex-1">
          <TeamPanel backend={backend} me={me} members={members} onMembersChanged={() => { void refreshMembers(); void refreshList(); void refreshNumbers(); }} numbers={numbers} onNumbersChanged={() => { void refreshNumbers(); void refreshList(); }} onChangePassword={onChangePassword} />
        </main>
      ) : (
      <main className="min-h-0 flex-1 md:grid md:grid-cols-[minmax(320px,380px)_1fr]">
        <div className={`${selectedId ? 'hidden md:block' : 'block'} h-full min-h-0`}>
          <ConversationList
            conversations={convs} loadError={loadError} selectedId={selectedId} onSelect={setSelectedId}
            filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} now={now}
            sortByLead={sortByLead} onSortByLead={setSortByLead}
            members={members} numbers={numbers} canFilterByAssignee={me !== null && me.role !== 'manager'} assignee={assignee} onAssignee={setAssignee}
          />
        </div>
        <section className={`${selectedId ? 'block' : 'hidden md:block'} h-full min-h-0`}>
          {selected ? (
            <ChatPanel
              key={selected.id}
              conv={selected} messages={messages} integration={integration} now={now}
              pendingAction={pending[selected.id]} actionError={actionError[selected.id]}
              onTakeover={() => runAction(selected.id, 'takeover')}
              onResume={() => runAction(selected.id, 'resume')}
              onSend={send}
              role={me?.role ?? 'manager'} members={members} onAssign={(u) => assignTo(selected.id, u)}
              onOutcome={(o) => runOutcome(selected.id, o)}
              outcomeBusy={outcomeBusy === selected.id} outcomeError={outcomeError[selected.id]}
              onBack={closeChat}
            />
          ) : (
            <div className="hidden h-full place-items-center text-center text-muted-foreground md:grid">
              <div><MessageSquareText className="mx-auto mb-3 size-10 opacity-40" /><p className="text-sm">Выберите диалог слева</p></div>
            </div>
          )}
        </section>
      </main>
      )}
    </div>
  );
}
