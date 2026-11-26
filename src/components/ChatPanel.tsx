import { countryOf } from '@/lib/country';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Check, ChevronDown, Hand, Loader2, Phone, RotateCcw, Send, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { MessageBubble } from '@/components/MessageBubble';
import { LeadBadge, stateTone } from '@/components/ConversationList';
import { displayName, formatAgo, LOST_REASON_LABEL, memberName, PURCHASED_OPTION_LABEL, formatDay, inServiceWindow, newIdempotencyKey, sameDay, STATE_LABEL, windowRemaining } from '@/lib/format';
import type { Conversation, IntegrationStatus, LostReason, Member, Message, Outcome, PurchasedOption, Role, SendInput, SendResult } from '@/lib/types';

interface Props {
  conv: Conversation;
  messages: Message[] | null;
  integration: IntegrationStatus | null;
  now: number;
  pendingAction: 'takeover' | 'resume' | undefined;
  actionError: string | undefined;
  onTakeover: () => void;
  onResume: () => void;
  onSend: (input: SendInput) => Promise<SendResult>;
  role: Role;
  members: Member[];
  onAssign: (userId: string | null) => Promise<string | null>;
  onOutcome: (outcome: Outcome | 'open', option?: PurchasedOption) => void;
  onOption: (option: PurchasedOption) => Promise<string | null>;
  onLostReason: (reason: LostReason | null) => Promise<string | null>;
  outcomeBusy: boolean;
  outcomeError: string | undefined;
  onBack: () => void;
}

type Notice = { tone: 'error' | 'warn'; text: string };
interface Attempt { key: string; text: string; template: boolean }

export function ChatPanel({ conv, messages, integration, now, pendingAction, actionError, onTakeover, onResume, onSend, role, members, onAssign, onOutcome, onOption, onLostReason, outcomeBusy, outcomeError, onBack }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Attempt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null); // kept only after an ambiguous network failure
  const [notice, setNotice] = useState<Notice | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [pickingOption, setPickingOption] = useState(false);
  const [showInfo, setShowInfo] = useState(false); // phones: lead details are collapsed by default
  const [assignError, setAssignError] = useState<string | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const canAssign = role !== 'manager';
  const assignee = members.find((m) => m.user_id === conv.assigned_to);

  async function changeAssignee(value: string) {
    setAssignBusy(true); setAssignError(null);
    const err = await onAssign(value === '' ? null : value);
    setAssignBusy(false);
    if (err) setAssignError(err);
  }
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length, conv.id, sending]);

  const phoneDigits = conv.contacts.wa_id.replace(/\D/g, '');
  const handling = conv.state === 'human_handling';
  const inWindow = inServiceWindow(conv.last_inbound_at, now);
  const sendConnected = integration?.send_configured === true;
  const templateConnected = integration?.template_configured === true;
  const aiChecked = integration?.last_ai_check_at ?? null;

  async function doSend(template: boolean) {
    const body = template ? '' : text.trim();
    if (sending || (!template && !body)) return;
    const reuse = attempt && attempt.template === template && attempt.text === body ? attempt : null;
    const a: Attempt = reuse ?? { key: newIdempotencyKey(), text: body, template };
    setSending(a); setNotice(null);
    const r = await onSend({ conversationId: conv.id, idempotencyKey: a.key, text: template ? undefined : body, useTemplate: template });
    setSending(null);
    switch (r.kind) {
      case 'accepted':
        setText(''); setAttempt(null); break;
      case 'unconfirmed':
        setText(''); setAttempt(null);
        setNotice({ tone: 'warn', text: 'Нет подтверждения от n8n. Сообщение осталось «Отправляется…», автоматической повторной отправки нет. Проверьте историю, прежде чем писать снова.' });
        break;
      case 'failed':
        setAttempt(null);
        setNotice({ tone: 'error', text: `Не отправлено: ${r.error}. Сообщение сохранено в истории как неотправленное; текст оставлен в поле.` });
        break;
      case 'rejected':
        setAttempt(null); setNotice({ tone: 'error', text: r.error }); break;
      case 'network':
        setAttempt(a); setNotice({ tone: 'warn', text: `${r.error} Повтор с тем же ключом безопасен: дубликата не будет.` }); break;
    }
  }

  const list = messages ?? [];
  let prevDay: number | null = null;

  let composerLock: string | null = null;
  if (!handling) composerLock = 'Чтобы ответить клиенту, сначала нажмите «Взять диалог».';
  else if (!sendConnected) composerLock = 'Не подключено: отправка через n8n не настроена.';

  const pauseNote =
    conv.state === 'ai_active' ? null
    : aiChecked ? `Статус сохранён. n8n запрашивал разрешение для AI ${formatAgo(aiChecked, now)}.`
    : 'Статус сохранён, но n8n ещё ни разу не запрашивал разрешение — переключение здесь пока НЕ останавливает бота.';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b bg-card px-3 py-2.5">
        <Button variant="ghost" size="sm" className="-ml-1 h-10 gap-1 px-2 md:hidden" onClick={onBack} aria-label="Назад к списку"><ArrowLeft className="size-5" /><span className="text-sm">Назад</span></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{displayName(conv)}</h2>
            <Badge tone={stateTone[conv.state]}>{STATE_LABEL[conv.state]}</Badge>
            <LeadBadge c={conv} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{(() => { const k = countryOf(conv.contacts.wa_id); return k ? <span title={k.name} aria-label={k.name} className="mr-1">{k.flag}</span> : null; })()}+{conv.contacts.wa_id}</p>
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto [&>button]:min-w-0 [&>button]:flex-1 sm:[&>button]:flex-none">
          <a
            href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer"
            title="Откроется чат в WhatsApp: нажмите там на значок звонка"
            aria-label="Позвонить в WhatsApp"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-background text-sm font-medium hover:bg-muted sm:h-8 sm:w-auto sm:px-3"
          >
            <Phone className="size-4" /><span className="hidden sm:inline">Позвонить в WhatsApp</span>
          </a>
          {conv.state !== 'ai_active' && (
            <Button variant={handling ? 'default' : 'outline'} size="sm" className="h-10 sm:h-8" onClick={onResume} disabled={!!pendingAction}>
              {pendingAction === 'resume' ? <Loader2 className="animate-spin" /> : <Bot />}
              <span>{pendingAction === 'resume' ? 'Подтверждаем…' : 'Вернуть AI'}</span>
            </Button>
          )}
          {!handling && (
            <Button size="sm" className="h-10 sm:h-8" onClick={onTakeover} disabled={!!pendingAction}>
              {pendingAction === 'takeover' ? <Loader2 className="animate-spin" /> : <Hand />}
              <span>{pendingAction === 'takeover' ? 'Подтверждаем…' : 'Взять диалог'}</span>
            </Button>
          )}
        </div>
      </header>
      {conv.outcome === 'won' && (
        <div className="flex items-center gap-2 border-b border-emerald-500/40 bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
          <span role="img" aria-label="Купил">💰</span> Клиент купил{conv.purchased_option ? ` · ${PURCHASED_OPTION_LABEL[conv.purchased_option]}` : ''}
        </div>
      )}

      <button
        type="button" onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo}
        className="flex w-full items-center gap-2 border-b bg-card px-4 py-2 text-left text-[13px] md:hidden"
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {conv.lead_score !== null ? <>Оценка AI: <b className="text-foreground">{conv.lead_score}/100</b></> : 'Оценка AI: нет'}
          {' · '}{assignee ? memberName(assignee) : canAssign ? 'не назначен' : 'вы'}
          {conv.outcome ? ` · ${conv.outcome === 'won' ? 'купил' : 'не купит'}` : ''}
        </span>
        <span className="shrink-0 text-xs font-medium text-primary">Детали</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${showInfo ? 'rotate-180' : ''}`} />
      </button>

      <div className={`${showInfo ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-card px-4 py-2 text-[13px]`}>
        <div className="flex basis-full items-center gap-2">
          <span className="text-muted-foreground">Ответственный:</span>
          {canAssign ? (
            <>
              <select
                value={conv.assigned_to ?? ''} onChange={(e) => void changeAssignee(e.target.value)} disabled={assignBusy}
                aria-label="Назначить менеджера" className="h-8 rounded-md border bg-card px-2 text-[13px]"
              >
                <option value="">Не назначен</option>
                {members.filter((m) => m.active || m.user_id === conv.assigned_to).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{memberName(m)}{m.role === 'director' ? ' · директор' : m.role === 'owner' ? ' · владелец' : ''}{m.active ? '' : ' (отключён)'}</option>
                ))}
              </select>
              {assignBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </>
          ) : (
            <b>{assignee ? memberName(assignee) : 'Вы'}</b>
          )}
          {assignError && <span className="text-red-700">Не удалось назначить: {assignError}</span>}
        </div>
        <p className="min-w-0 flex-1 text-muted-foreground">
          {conv.lead_score !== null
            ? <>Оценка AI (не вероятность): <b className="text-foreground">{conv.lead_score}/100</b>{conv.lead_reason ? ` — ${conv.lead_reason}` : ''}</>
            : 'Оценка покупки появится после следующего сообщения клиента.'}
        </p>
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Итог диалога">
          {conv.outcome ? (
            <Button variant="outline" size="sm" onClick={() => onOutcome('open')} disabled={outcomeBusy} title="Снять отметку">
              {outcomeBusy ? <Loader2 className="animate-spin" /> : <RotateCcw />}<span>{conv.outcome === 'won' ? 'Купил — сбросить' : 'Не купит — сбросить'}</span>
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setPickingOption((v) => !v)} aria-expanded={pickingOption} disabled={outcomeBusy}>
                {outcomeBusy ? <Loader2 className="animate-spin" /> : <Check />}<span>Купил</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => onOutcome('lost')} disabled={outcomeBusy}>
                <X /><span>Не купит</span>
              </Button>
            </>
          )}
        </div>
        {!conv.outcome && pickingOption && (
          <div className="flex basis-full flex-wrap items-center gap-1.5" role="group" aria-label="Что купил клиент">
            <span className="text-muted-foreground">Что купил клиент:</span>
            {(Object.keys(PURCHASED_OPTION_LABEL) as PurchasedOption[]).map((k) => (
              <Button key={k} variant="outline" size="sm" disabled={outcomeBusy} onClick={() => { setPickingOption(false); onOutcome('won', k); }}>{PURCHASED_OPTION_LABEL[k]}</Button>
            ))}
            <span className="basis-full text-[12px] text-muted-foreground">После выбора клиенту сами уйдут сообщения: приветствие, чек-лист, напоминание о старте, отзыв после первой недели.</span>
          </div>
        )}
        {conv.outcome === 'won' && (
          <label className="flex basis-full items-center gap-1.5">
            <span className="text-muted-foreground">Тариф (для сообщений после оплаты):</span>
            <select
              value={conv.purchased_option ?? ''} aria-label="Тариф клиента" className="h-8 rounded-md border bg-card px-2 text-[13px]"
              onChange={(e) => { if (e.target.value) void onOption(e.target.value as PurchasedOption).then((err) => setLostError(err)); }}
            >
              <option value="" disabled>не выбран</option>
              {(Object.keys(PURCHASED_OPTION_LABEL) as PurchasedOption[]).map((k) => <option key={k} value={k}>{PURCHASED_OPTION_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {conv.outcome === 'lost' && (
          <label className="flex basis-full items-center gap-1.5">
            <span className="text-muted-foreground">Причина отказа:</span>
            <select
              value={conv.lost_reason ?? ''} aria-label="Причина отказа" className="h-8 rounded-md border bg-card px-2 text-[13px]"
              onChange={(e) => { void onLostReason((e.target.value || null) as LostReason | null).then((err) => setLostError(err)); }}
            >
              <option value="">не указана</option>
              {(Object.keys(LOST_REASON_LABEL) as LostReason[]).map((k) => <option key={k} value={k}>{LOST_REASON_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {lostError && <p className="basis-full text-red-700">{lostError}</p>}
        {outcomeError && <p className="basis-full text-red-700">Не удалось сохранить итог: {outcomeError}</p>}
      </div>

      {(pendingAction || actionError || pauseNote || conv.state_note) && (
        <div className={`${pendingAction || actionError || showInfo ? 'block' : 'hidden md:block'} space-y-1 border-b bg-card px-4 py-2 text-[13px]`}>
          {pendingAction && <p className="flex items-center gap-2 text-amber-800"><Loader2 className="size-3.5 animate-spin" />Ожидаем подтверждения от сервера. Статус не изменён, пока он не ответит.</p>}
          {actionError && <p className="flex items-start gap-2 text-red-700"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Не удалось выполнить действие: {actionError} Статус диалога не изменился.</p>}
          {conv.state_note && <p className="text-muted-foreground">{conv.state_note}</p>}
          {pauseNote && <p className={aiChecked ? 'text-muted-foreground' : 'text-amber-800'}>{pauseNote}</p>}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6">
        {messages === null && (
          <div className="space-y-4" aria-busy="true" aria-label="Загрузка переписки">
            {[['items-start', 'w-3/5'], ['items-end', 'w-2/3'], ['items-start', 'w-2/5'], ['items-end', 'w-1/2']].map(([a, w], i) => (
              <div key={i} className={`flex flex-col ${a}`}><span className={`skeleton h-12 rounded-2xl ${w}`} /></div>
            ))}
          </div>
        )}
        {messages !== null && list.length === 0 && !sending && <p className="py-10 text-center text-sm text-muted-foreground">Сообщений пока нет.</p>}
        {list.map((m) => {
          const t = Date.parse(m.message_timestamp);
          const showDay = prevDay === null || !sameDay(prevDay, t);
          prevDay = t;
          return (
            <div key={m.id} className="space-y-3">
              {showDay && <div className="flex justify-center"><span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">{formatDay(m.message_timestamp, now)}</span></div>}
              <MessageBubble m={m} now={now} />
            </div>
          );
        })}
        {sending && (
          <MessageBubble
            local now={now}
            m={{
              id: 'local', conversation_id: conv.id, provider_message_id: null, idempotency_key: sending.key, sender_role: 'manager', direction: 'outbound', message_type: 'text',
              body: sending.template ? '[Шаблон]' : sending.text, is_placeholder: false, template_name: null, message_timestamp: new Date(now).toISOString(),
              status: 'pending', status_updated_at: new Date(now).toISOString(), error_code: null, error_message: null,
            }}
          />
        )}
        <div ref={endRef} />
      </div>

      <footer className="border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {notice && (
          <div className={`mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>{notice.text}</span>
            {attempt && <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => doSend(attempt.template)} disabled={!!sending}>Повторить</Button>}
          </div>
        )}

        {handling && sendConnected && !inWindow && (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <p className="font-medium">Окно 24 часа закрыто</p>
            <p>Свободный текст отправить нельзя: клиент писал {conv.last_inbound_at ? formatAgo(conv.last_inbound_at, now) : 'давно'}. Допустим только одобренный шаблон WhatsApp.</p>
            <Button size="sm" className="mt-2" onClick={() => doSend(true)} disabled={!templateConnected || !!sending}>
              {sending?.template ? <Loader2 className="animate-spin" /> : <Send />}
              {templateConnected ? 'Отправить шаблон' : 'Не подключено: шаблон не настроен'}
            </Button>
          </div>
        )}
        {handling && sendConnected && inWindow && (
          <p className="mb-1.5 text-[11px] text-muted-foreground">Свободный ответ доступен ещё {windowRemaining(conv.last_inbound_at, now)}</p>
        )}

        <form className="flex items-end gap-2.5" onSubmit={(e) => { e.preventDefault(); void doSend(false); }}>
          <Textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={3}
            className="min-h-[5.5rem] rounded-xl px-3.5 text-base md:min-h-[4.25rem] md:text-sm"
            disabled={!!composerLock || !inWindow || !!sending}
            placeholder={composerLock ?? (inWindow ? 'Ответ клиенту от имени менеджера' : 'Окно закрыто — только шаблон')}
            aria-label="Ответ клиенту"
            maxLength={4096}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void doSend(false); } }}
          />
          <Button type="submit" size="icon" className="size-12 shrink-0 rounded-full md:size-10" disabled={!!composerLock || !inWindow || !!sending || !text.trim()} aria-label="Отправить">
            {sending && !sending.template ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
        {composerLock && <p className="mt-1.5 text-xs text-muted-foreground">{composerLock}</p>}
      </footer>
    </div>
  );
}
