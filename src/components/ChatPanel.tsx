import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Hand, Loader2, Send, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { MessageBubble } from '@/components/MessageBubble';
import { stateTone } from '@/components/ConversationList';
import { displayName, formatAgo, formatDay, inServiceWindow, newIdempotencyKey, sameDay, STATE_LABEL, windowRemaining } from '@/lib/format';
import type { Conversation, IntegrationStatus, Message, SendInput, SendResult } from '@/lib/types';

interface Props {
  conv: Conversation;
  messages: Message[] | null;
  integration: IntegrationStatus | null;
  demo: boolean;
  now: number;
  pendingAction: 'takeover' | 'resume' | undefined;
  actionError: string | undefined;
  onTakeover: () => void;
  onResume: () => void;
  onSend: (input: SendInput) => Promise<SendResult>;
  onBack: () => void;
}

type Notice = { tone: 'error' | 'warn'; text: string };
interface Attempt { key: string; text: string; template: boolean }

export function ChatPanel({ conv, messages, integration, demo, now, pendingAction, actionError, onTakeover, onResume, onSend, onBack }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Attempt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null); // kept only after an ambiguous network failure
  const [notice, setNotice] = useState<Notice | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length, conv.id, sending]);

  const handling = conv.state === 'human_handling';
  const inWindow = inServiceWindow(conv.last_inbound_at, now);
  const sendConnected = demo || integration?.send_configured === true;
  const templateConnected = demo || integration?.template_configured === true;
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
    : demo ? 'Демо: бот не подключён, это только пример интерфейса.'
    : aiChecked ? `Статус сохранён. n8n запрашивал разрешение для AI ${formatAgo(aiChecked, now)}.`
    : 'Статус сохранён, но n8n ещё ни разу не запрашивал разрешение — переключение здесь пока НЕ останавливает бота.';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Назад к списку"><ArrowLeft /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{displayName(conv)}</h2>
            <Badge tone={stateTone[conv.state]}>{STATE_LABEL[conv.state]}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">+{conv.contacts.wa_id}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {conv.state !== 'ai_active' && (
            <Button variant={handling ? 'default' : 'outline'} size="sm" onClick={onResume} disabled={!!pendingAction}>
              {pendingAction === 'resume' ? <Loader2 className="animate-spin" /> : <Bot />}
              <span>{pendingAction === 'resume' ? 'Подтверждаем…' : 'Вернуть AI'}</span>
            </Button>
          )}
          {!handling && (
            <Button size="sm" onClick={onTakeover} disabled={!!pendingAction}>
              {pendingAction === 'takeover' ? <Loader2 className="animate-spin" /> : <Hand />}
              <span>{pendingAction === 'takeover' ? 'Подтверждаем…' : 'Взять диалог'}</span>
            </Button>
          )}
        </div>
      </header>

      {(pendingAction || actionError || pauseNote || conv.state_note) && (
        <div className="space-y-1 border-b bg-card px-4 py-2 text-[13px]">
          {pendingAction && <p className="flex items-center gap-2 text-amber-800"><Loader2 className="size-3.5 animate-spin" />Ожидаем подтверждения от сервера. Статус не изменён, пока он не ответит.</p>}
          {actionError && <p className="flex items-start gap-2 text-red-700"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Не удалось выполнить действие: {actionError} Статус диалога не изменился.</p>}
          {conv.state_note && <p className="text-muted-foreground">{conv.state_note}</p>}
          {pauseNote && <p className={aiChecked || demo ? 'text-muted-foreground' : 'text-amber-800'}>{pauseNote}</p>}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6">
        {messages === null && <p className="py-10 text-center text-sm text-muted-foreground">Загрузка переписки…</p>}
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

        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void doSend(false); }}>
          <Textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2}
            disabled={!!composerLock || !inWindow || !!sending}
            placeholder={composerLock ?? (inWindow ? 'Ответ клиенту от имени менеджера' : 'Окно закрыто — только шаблон')}
            aria-label="Ответ клиенту"
            maxLength={4096}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void doSend(false); } }}
          />
          <Button type="submit" size="icon" disabled={!!composerLock || !inWindow || !!sending || !text.trim()} aria-label="Отправить">
            {sending && !sending.template ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
        {composerLock && <p className="mt-1.5 text-xs text-muted-foreground">{composerLock}</p>}
      </footer>
    </div>
  );
}
