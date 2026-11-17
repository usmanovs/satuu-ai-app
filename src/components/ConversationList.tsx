import { ArrowDownWideNarrow, Search, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { previewText, displayName, formatListTime, formatWait, hotWaitingMin, isHotAlert, isUnread, memberName, needsManager, STATE_LABEL, unreadBadge } from '@/lib/format';
import type { Conversation, ConvState, LeadLabel, Member, WaNumber } from '@/lib/types';

export type Filter = 'all' | 'needs_manager' | ConvState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'needs_manager', label: '🙋 Нужен менеджер' },
  { id: 'ai_active', label: 'AI активен' },
  { id: 'human_requested', label: 'Нужен человек' },
  { id: 'human_handling', label: 'У менеджера' },
];

export const LEAD_LABEL: Record<LeadLabel, string> = { hot: 'Горячий', warm: 'Тёплый', cold: 'Холодный' };
export const leadTone = { hot: 'red', warm: 'amber', cold: 'neutral' } as const;

/** What the manager sees: the real outcome wins over the AI estimate. */
export function LeadBadge({ c }: { c: Conversation }) {
  if (c.contacts?.is_internal) return <Badge tone="neutral" title="Ваш собственный чат: не считается лидом">Мой чат</Badge>;
  if (c.outcome === 'won') return <Badge tone="emerald">Купил</Badge>;
  if (c.outcome === 'lost') return <Badge tone="neutral">Не купит</Badge>;
  if (c.lead_score === null || c.lead_label === null) return null;
  return <Badge tone={leadTone[c.lead_label]} title={c.lead_reason ?? undefined}>{LEAD_LABEL[c.lead_label]} · {c.lead_score}</Badge>;
}

/** Short status labels for the crowded chat-list row (the full text is in the tooltip). */
const STATE_SHORT: Record<ConvState, string> = { ai_active: 'AI', human_requested: 'Человек', human_handling: 'Менеджер' };

export const stateTone = { ai_active: 'emerald', human_requested: 'amber', human_handling: 'blue' } as const;

function initials(name: string) {
  const parts = name.replace(/^\+/, '').trim().split(/\s+/);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

interface Props {
  conversations: Conversation[] | null;
  loadError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  query: string;
  onQuery: (q: string) => void;
  now: number;
  sortByLead: boolean;
  onSortByLead: (v: boolean) => void;
  members: Member[];
  numbers: WaNumber[];
  /** owner/director only: filter by the responsible sales manager ('all' | 'none' | user id) */
  canFilterByAssignee: boolean;
  assignee: string;
  onAssignee: (v: string) => void;
}

export function ConversationList({ conversations, loadError, selectedId, onSelect, filter, onFilter, query, onQuery, now, sortByLead, onSortByLead, members, numbers, canFilterByAssignee, assignee }: Props) {
  const all = conversations ?? [];
  const q = query.trim().toLowerCase();
  const filtered = all.filter((c) => {
    if (filter === 'needs_manager' ? !needsManager(c) : filter !== 'all' && c.state !== filter) return false;
    if (assignee === 'none' && c.assigned_to) return false;
    if (assignee !== 'all' && assignee !== 'none' && c.assigned_to !== assignee) return false;
    if (!q) return true;
    return (
      displayName(c).toLowerCase().includes(q) ||
      c.contacts.wa_id.includes(q.replace(/^\+/, '')) ||
      (c.last_message_preview ?? '').toLowerCase().includes(q)
    );
  });
  // open leads with the highest buying signal first; finished chats (won/lost) and unscored ones go last
  const rank = (c: Conversation) => (c.contacts?.is_internal ? -3 : c.outcome ? -2 : (needsManager(c) ? 1000 : 0) + (c.lead_score ?? -1));
  const visible = sortByLead ? [...filtered].sort((a, b) => rank(b) - rank(a)) : filtered;
  const count = (f: Filter) => (f === 'all' ? all.length : f === 'needs_manager' ? all.filter(needsManager).length : all.filter((c) => c.state === f).length);

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-card">
      <div className="space-y-3 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Поиск по имени, номеру, тексту" className="pl-9" aria-label="Поиск" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => onSortByLead(!sortByLead)}
            aria-pressed={sortByLead}
            title="Сначала диалоги с самой высокой вероятностью покупки (оценка AI)"
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors', sortByLead ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-muted')}
          >
            <ArrowDownWideNarrow className="size-3.5" />По вероятности покупки
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Фильтр по статусу">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
                filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
              )}
            >
              {f.label} <span className={cn('ml-0.5 text-[11px]', filter === f.id ? 'opacity-80' : 'text-muted-foreground')}>{count(f.id)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {loadError && <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить диалоги: {loadError}</div>}
        {conversations === null && !loadError && (
          <ul aria-busy="true" aria-label="Загрузка диалогов">
            {Array.from({ length: 7 }, (_, i) => (
              <li key={i} className="flex items-start gap-3 border-b px-3 py-3">
                <span className="skeleton mt-0.5 size-10 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="flex justify-between gap-6"><span className="skeleton h-3.5 w-1/3 rounded" /><span className="skeleton h-3 w-10 rounded" /></span>
                  <span className="skeleton block h-3 w-4/5 rounded" />
                  <span className="skeleton block h-4 w-1/4 rounded-full" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {conversations !== null && visible.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {all.length === 0 ? 'Диалогов пока нет. Они появятся, когда n8n начнёт передавать входящие сообщения.' : 'Ничего не найдено.'}
          </div>
        )}
        <ul>
          {visible.map((c) => {
            const unread = isUnread(c);
            const name = displayName(c);
            const waiting = hotWaitingMin(c, now);
            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  aria-current={selectedId === c.id}
                  className={cn('flex w-full items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/70', selectedId === c.id && 'bg-accent hover:bg-accent')}
                >
                  <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">{initials(name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('min-w-[7ch] max-w-full truncate text-[15px]', unread ? 'font-bold' : 'font-medium')}>{name}</span>
                        {isHotAlert(c) && <span className="fire shrink-0 text-base" role="img" aria-label="Горячий лид" title={`Горячий лид · ${c.lead_score}/100${c.lead_reason ? ` — ${c.lead_reason}` : ''}`}>🔥</span>}
                      </span>
                      <span className={cn('shrink-0 text-xs', unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>{formatListTime(c.last_message_at, now)}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {(() => {
                          const who = c.assigned_to ? memberName(members.find((m) => m.user_id === c.assigned_to)) : null;
                          const label = who && c.state === 'human_handling' ? `${STATE_SHORT[c.state]}: ${who}` : STATE_SHORT[c.state];
                          return (
                            <>
                              <Badge tone={stateTone[c.state]} className="max-w-[10rem] shrink-0" title={who ? `${STATE_LABEL[c.state]} · ${who}` : STATE_LABEL[c.state]}><span className="truncate">{label}</span></Badge>
                              {who && c.state !== 'human_handling' && <span className="inline-flex max-w-[8rem] shrink-0 items-center gap-1 rounded-full border border-blue-500/50 bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-foreground" title="Ответственный менеджер"><UserCheck className="size-3 shrink-0 text-blue-500" aria-hidden /><span className="truncate">{who}</span></span>}
                            </>
                          );
                        })()}
                        <span className="shrink-0"><LeadBadge c={c} /></span>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className={cn('truncate text-[13px]', unread ? 'text-foreground' : 'text-muted-foreground')}>{previewText(c.last_message_preview)}</span>
                      {unread && <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-none text-primary-foreground" aria-label={`Непрочитано: ${unreadBadge(c)}`}>{unreadBadge(c)}</span>}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">{waiting !== null && <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold', waiting >= 15 ? 'border-red-300 bg-red-50 text-red-800' : 'border-orange-300 bg-orange-50 text-orange-800')} title="Горячий лид ждёт человека: напишите или отправьте голосовое">⏱ ждёт {formatWait(waiting)}</span>}{needsManager(c) && <span className="manager-flag inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-800" title={c.manager_needed_reason ?? 'AI просит подключить менеджера'}><span className="wave" role="img" aria-label="Нужен менеджер">🙋</span>Нужен менеджер</span>}{canFilterByAssignee && numbers.length > 1 && <span className="text-[11px] text-muted-foreground" title="Номер WhatsApp, на который написал клиент">☎ {numbers.find((n) => n.id === c.wa_number_id)?.label ?? '—'}</span>}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
