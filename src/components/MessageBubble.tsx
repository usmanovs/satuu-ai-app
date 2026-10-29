import { AlertTriangle, Bot, Check, CheckCheck, Clock, ImageOff, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime, statusView } from '@/lib/format';
import type { Message } from '@/lib/types';

const ROLE = {
  customer: { label: 'Клиент', wrap: 'items-start', bubble: 'bg-card border rounded-tl-sm', Icon: UserRound },
  ai: { label: 'AI', wrap: 'items-end', bubble: 'bg-sky-50 border border-sky-200 rounded-tr-sm', Icon: Bot },
  manager: { label: 'Менеджер', wrap: 'items-end', bubble: 'bg-primary text-primary-foreground rounded-tr-sm', Icon: UserRound },
} as const;

export function MessageBubble({ m, now, local }: { m: Message; now: number; local?: boolean }) {
  const r = ROLE[m.sender_role];
  const outbound = m.direction === 'outbound';
  const sv = outbound ? statusView(m, now) : null;
  const onDark = m.sender_role === 'manager';
  const toneClass =
    sv?.tone === 'error' ? 'text-red-600' : sv?.tone === 'warn' ? 'text-amber-700' : sv?.tone === 'read' ? 'text-sky-500' : onDark ? 'text-white/80' : 'text-muted-foreground';
  const failed = m.status === 'failed';

  return (
    <div className={cn('pop flex flex-col gap-1', r.wrap)}>
      <span className={cn('flex items-center gap-1 px-1 text-[11px] font-semibold', m.sender_role === 'ai' ? 'text-sky-700' : m.sender_role === 'manager' ? 'text-primary' : 'text-muted-foreground')}>
        <r.Icon className="size-3" /> {r.label}
      </span>
      <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[14.5px] shadow-sm sm:max-w-[72%]', r.bubble, failed && 'border-red-300 bg-red-50 text-red-950')}>
        {m.is_placeholder && <ImageOff className="mr-1.5 mb-0.5 inline size-4 opacity-60" aria-hidden />}
        <span className={cn('whitespace-pre-wrap break-words', m.is_placeholder && 'italic opacity-80')}>{m.body}</span>
        <span className={cn('mt-1 flex items-center justify-end gap-1.5 text-[11px]', failed ? 'text-red-600' : toneClass)}>
          <span>{formatTime(m.message_timestamp)}</span>
          {outbound && sv && (
            <span className="inline-flex items-center gap-1" title={sv.label}>
              {sv.tone === 'error' ? <AlertTriangle className="size-3.5" />
                : sv.tone === 'warn' || sv.label === 'Отправляется…' ? <Clock className="size-3.5" />
                : sv.ticks === 2 ? <CheckCheck className="size-3.5" />
                : sv.ticks === 1 ? <Check className="size-3.5" /> : null}
              <span className="max-w-[16rem] truncate">{local ? 'Отправляется…' : sv.label}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
