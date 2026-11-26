import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Bot, Flame, Hand, Heart, MessageSquare, MessagesSquare, QrCode, ThumbsDown, Timer, UserCheck, UserX, Users, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LOST_REASON_LABEL } from '@/lib/format';
import type { FunnelStats, InboxBackend, LostReason, Me, SalesReport, TeamStats } from '@/lib/types';

const PERIODS = [{ days: 7, label: '7 дней' }, { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' }];

function Card({ label, value, tone, Icon, iconTone = 'text-slate-500' }: { label: string; value: number | string; tone?: 'hot'; Icon: LucideIcon; iconTone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5" title={label}>
      <p className="flex items-center gap-1.5 text-[12px] font-medium leading-tight text-muted-foreground"><Icon className={`size-4 shrink-0 ${iconTone}`} aria-hidden />{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === 'hot' ? 'text-red-700' : ''}`}>{value}</p>
    </div>
  );
}

const FUNNEL_STEPS: { key: keyof FunnelStats; label: string; hint: string; Icon: LucideIcon; tone: string }[] = [
  { key: 'leads', label: 'Лиды', hint: 'Новые диалоги за период', Icon: Users, tone: 'text-slate-500' },
  { key: 'dialog', label: 'Диалог', hint: 'Клиент написал 3 раза и больше', Icon: MessagesSquare, tone: 'text-sky-500' },
  { key: 'interested', label: 'Интересуются', hint: 'Оценка AI 40 и выше', Icon: Heart, tone: 'text-pink-500' },
  { key: 'hot', label: 'Горячие', hint: 'Оценка AI 80 и выше', Icon: Flame, tone: 'text-orange-500' },
  { key: 'qr', label: 'Получили QR', hint: 'Бот отправил QR для оплаты', Icon: QrCode, tone: 'text-violet-500' },
  { key: 'won', label: 'Купили', hint: 'Отмечено «Купил»', Icon: BadgeCheck, tone: 'text-emerald-500' },
];

function FunnelSection({ backend, days }: { backend: InboxBackend; days: number }) {
  const [f, setF] = useState<FunnelStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF(null); backend.funnelStats(days).then((r) => { setF(r); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : 'ошибка')); }, [backend, days]);
  if (err) return <p className="text-[13px] text-red-700">Воронка не загрузилась: {err}</p>;
  if (!f) return null;
  const pct = (n: number) => (f.leads > 0 ? Math.round((n / f.leads) * 100) : 0);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold">Воронка</h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {FUNNEL_STEPS.map((s) => {
          const n = f[s.key] as number;
          return (
            <div key={s.key} title={s.hint} className="rounded-lg border bg-card p-2.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium leading-tight text-muted-foreground"><s.Icon className={`size-4 shrink-0 ${s.tone}`} aria-hidden />{s.label}</p>
              <p className="mt-1 text-xl font-bold leading-none">{n}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{s.key === 'leads' ? 'все' : `${pct(n)}% от лидов`}</p>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ThumbsDown className="size-4" aria-hidden />Не купили: <b className="text-foreground">{f.lost}</b></span>
        <span className="inline-flex items-center gap-1.5" title="Сколько минут проходит до первого сообщения человека горячему лиду"><Timer className="size-4" aria-hidden />Горячие: первое касание человека: <b className="text-foreground">{f.hot_first_touch_min === null ? 'нет данных' : `${f.hot_first_touch_min} мин`}</b></span>
        <span className="inline-flex items-center gap-1.5" title="Горячие лиды (80+), которым ещё не написал человек"><Flame className="size-4 text-orange-500" aria-hidden />Горячие без человека: <b className={f.hot_waiting_now > 0 ? 'text-red-600' : 'text-foreground'}>{f.hot_waiting_now}</b></span>
      </p>
    </div>
  );
}

function ReportsSection({ backend }: { backend: InboxBackend }) {
  const [reports, setReports] = useState<SalesReport[] | null>(null);
  useEffect(() => { backend.listReports().then(setReports).catch(() => setReports([])); }, [backend]);
  if (reports === null) return null;
  const [latest, ...older] = reports;
  const when = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">Еженедельный отчёт по продажам</h2>
      {!latest && <p className="rounded-md border bg-card p-3 text-[13px] text-muted-foreground">Первый отчёт появится в понедельник утром.</p>}
      {latest && (
        <article className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-[12px] text-muted-foreground">Отчёт от {when(latest.created_at)}</p>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{latest.body}</p>
        </article>
      )}
      {older.map((r) => (
        <details key={r.id} className="rounded-md border bg-card px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-muted-foreground">Отчёт от {when(r.created_at)}</summary>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{r.body}</p>
        </details>
      ))}
    </section>
  );
}

/** Sales analytics page: funnel, manager statistics and the weekly report. */
export function AnalyticsPanel({ backend, me }: { backend: InboxBackend; me: Me }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, number>>({});
  useEffect(() => { backend.lostReasons().then(setReasons).catch(() => setReasons({})); }, [backend, stats]);
  const isOwner = me.role === 'owner';
  const sees = me.role === 'manager' ? 'Моя статистика' : 'Эффективность менеджеров';

  const load = useCallback(async () => {
    try { setStats(await backend.teamStats(days)); setStatsError(null); } catch (e) { setStatsError(e instanceof Error ? e.message : 'ошибка'); }
  }, [backend, days]);
  useEffect(() => { setStats(null); void load(); }, [load]);

  return (
    <div className="scroll-thin h-full min-h-0 overflow-y-auto bg-background px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">{sees}</h2>
            <div className="flex gap-1.5" role="group" aria-label="Период">
              {PERIODS.map((p) => (
                <button key={p.days} onClick={() => setDays(p.days)} aria-pressed={days === p.days}
                  className={`rounded-full border px-3 py-1 text-[13px] font-medium ${days === p.days ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {isOwner && <FunnelSection backend={backend} days={days} />}
          {statsError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить статистику: {statsError}</p>}
          {!stats && !statsError && <p className="py-6 text-center text-sm text-muted-foreground">Загрузка…</p>}
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Card label="Диалогов" value={stats.summary.total} Icon={MessageSquare} iconTone="text-sky-500" />
                <Card label="AI отвечает" value={stats.summary.ai_active} Icon={Bot} iconTone="text-emerald-500" />
                <Card label="Нужен человек" value={stats.summary.human_requested} Icon={Hand} iconTone="text-amber-500" />
                <Card label="У менеджера" value={stats.summary.human_handling} Icon={UserCheck} iconTone="text-blue-500" />
                {me.role !== 'manager' && <Card label="Не назначены" value={stats.summary.unassigned} Icon={UsersRound} />}
                <Card label="Горячие (открытые)" value={stats.summary.hot_open} tone="hot" Icon={Flame} iconTone="text-orange-500" />
                <Card label="Купили" value={stats.summary.won} Icon={BadgeCheck} iconTone="text-emerald-500" />
                <Card label="Не купили" value={stats.summary.lost} Icon={UserX} />
              </div>
              {Object.keys(reasons).length > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  <b className="text-foreground">Причины отказов:</b>{' '}
                  {Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k === 'none' ? 'без причины' : LOST_REASON_LABEL[k as LostReason] ?? k} ${n}`).join(' · ')}
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="border-b bg-muted/60 text-[12px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Сотрудник</th>
                      <th className="px-3 py-2 font-medium" title="Сколько лидов назначено человеку за выбранный период">Лидов за период</th>
                      <th className="px-3 py-2 font-medium" title="Все лиды, закреплённые за человеком сейчас">Всего назначено</th>
                      <th className="px-3 py-2 font-medium">В работе</th>
                      <th className="px-3 py-2 font-medium" title="Сообщений клиентам, отправленных этим сотрудником из приложения за выбранный период">Сообщений отправлено</th>
                      <th className="px-3 py-2 font-medium" title="Среднее время от сообщения клиента до ответа менеджера">Ср. ответ, мин</th>
                      <th className="px-3 py-2 font-medium">Купили</th>
                      <th className="px-3 py-2 font-medium">Не купили</th>
                      <th className="px-3 py-2 font-medium">Конверсия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.managers.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Сотрудников пока нет.</td></tr>}
                    {stats.managers.map((m) => {
                      const done = m.won + m.lost;
                      return (
                        <tr key={m.user_id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{m.name ?? '—'}</td>
                          <td className="px-3 py-2 font-bold">{m.assigned_period}</td>
                          <td className="px-3 py-2">{m.assigned_total}</td>
                          <td className="px-3 py-2">{m.open_now}</td>
                          <td className="px-3 py-2 font-bold">{m.replies}</td>
                          <td className="px-3 py-2">{m.avg_response_min ?? '—'}</td>
                          <td className="px-3 py-2">{m.won}</td>
                          <td className="px-3 py-2">{m.lost}</td>
                          <td className="px-3 py-2">{done > 0 ? `${Math.round((m.won / done) * 100)}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold">Активность в приложении</h3>
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <table className="w-full min-w-[460px] text-left text-sm">
                    <thead className="border-b bg-muted/60 text-[12px] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Сотрудник</th>
                        <th className="px-3 py-2 font-medium">Последняя активность</th>
                        <th className="px-3 py-2 font-medium" title="Заходил ли сегодня в приложение (по времени Бишкека)">Сегодня</th>
                        <th className="px-3 py-2 font-medium" title="В скольких из последних 7 дней человек открывал приложение">Дней из 7</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.managers.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Сотрудников пока нет.</td></tr>}
                      {[...stats.managers].sort((x, y) => (y.logins_7d - x.logins_7d) || String(y.last_login ?? '').localeCompare(String(x.last_login ?? ''))).map((m) => (
                        <tr key={m.user_id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{m.name ?? '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{m.last_login ? new Date(m.last_login).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                          <td className="px-3 py-2 font-bold">{m.logins_today > 0 ? <span className="text-emerald-600">✓ был</span> : <span className="font-normal text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2 font-bold">{m.logins_7d}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">Считаем, когда приложение было открыто (оно обновляет сессию примерно раз в час), а не только вход по паролю: так видно и тех, кто не выходит из системы. Время показано в вашем часовом поясе.</p>
              </div>
              <p className="text-xs text-muted-foreground">Итоги («Купили» / «Не купили») ставят менеджеры вручную в диалоге. Конверсия = купили / (купили + не купили).</p>
            </>
          )}
        </section>

        {isOwner && <ReportsSection backend={backend} />}
      </div>
    </div>
  );
}
