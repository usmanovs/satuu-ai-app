import { useCallback, useEffect, useState } from 'react';
import { Bot, BadgeCheck, Copy, Flame, Hand, MessageSquare, UserCheck, UserX, UsersRound, Heart, KeyRound, Link2, Loader2, MessagesSquare, QrCode, ThumbsDown, Timer, Trash2, UserPlus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LOST_REASON_LABEL, memberName, ROLE_LABEL } from '@/lib/format';
import { NumbersSection } from '@/components/NumbersPanel';
import type { FunnelStats, InboxBackend, LostReason, Me, Member, SalesReport, TeamStats, WaNumber } from '@/lib/types';

interface Props {
  backend: InboxBackend;
  me: Me;
  members: Member[];
  onMembersChanged: () => void;
  numbers: WaNumber[];
  onNumbersChanged: () => void;
  onChangePassword?: (password: string) => Promise<string | null>;
}

const PERIODS = [{ days: 7, label: '7 дней' }, { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' }];

function Card({ label, value, tone, Icon, iconTone = 'text-slate-500' }: { label: string; value: number | string; tone?: 'hot'; Icon: LucideIcon; iconTone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5" title={label}>
      <Icon className={`size-5 ${iconTone}`} aria-label={label} role="img" />
      <p className={`mt-1.5 text-xl font-bold ${tone === 'hot' ? 'text-red-700' : ''}`}>{value}</p>
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
              <s.Icon className={`size-5 ${s.tone}`} aria-label={s.label} role="img" />
              <p className="mt-1.5 text-xl font-bold leading-none">{n}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{s.key === 'leads' ? 'все' : `${pct(n)}% от лидов`}</p>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" title="Не купили"><ThumbsDown className="size-4" aria-label="Не купили" role="img" /><b className="text-foreground">{f.lost}</b></span>
        <span className="inline-flex items-center gap-1.5" title="Первое касание человека у горячих"><Flame className="size-4 text-orange-500" aria-hidden /><Timer className="size-4" aria-label="Время до первого касания человека" role="img" /><b className="text-foreground">{f.hot_first_touch_min === null ? 'нет данных' : `${f.hot_first_touch_min} мин`}</b></span>
        <span className="inline-flex items-center gap-1.5" title="Горячие, которые сейчас ждут человека"><Flame className="size-4 text-orange-500" aria-hidden /><Users className="size-4" aria-label="Ждут человека" role="img" /><b className={f.hot_waiting_now > 0 ? 'text-red-600' : 'text-foreground'}>{f.hot_waiting_now}</b></span>
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

export function TeamPanel({ backend, me, members, onMembersChanged, numbers, onNumbersChanged, onChangePassword }: Props) {
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
        {me.role !== 'manager' && <OrgChart members={members} stats={stats} />}

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
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b bg-muted/60 text-[12px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Менеджер</th>
                      <th className="px-3 py-2 font-medium">Назначено</th>
                      <th className="px-3 py-2 font-medium">В работе</th>
                      <th className="px-3 py-2 font-medium">Ответов за период</th>
                      <th className="px-3 py-2 font-medium" title="Среднее время от сообщения клиента до ответа менеджера">Ср. ответ, мин</th>
                      <th className="px-3 py-2 font-medium">Купили</th>
                      <th className="px-3 py-2 font-medium">Не купили</th>
                      <th className="px-3 py-2 font-medium">Конверсия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.managers.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Менеджеров пока нет.</td></tr>}
                    {stats.managers.map((m) => {
                      const done = m.won + m.lost;
                      return (
                        <tr key={m.user_id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{m.name ?? '—'}</td>
                          <td className="px-3 py-2">{m.assigned_total}</td>
                          <td className="px-3 py-2">{m.open_now}</td>
                          <td className="px-3 py-2">{m.replies}</td>
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
              <p className="text-xs text-muted-foreground">Итоги («Купили» / «Не купили») ставят менеджеры вручную в диалоге. Конверсия = купили / (купили + не купили).</p>
            </>
          )}
        </section>

        {isOwner && <ReportsSection backend={backend} />}

        <NumbersSection backend={backend} me={me} members={members} numbers={numbers} onChanged={onNumbersChanged} />

        {isOwner && <MembersSection backend={backend} members={members} onChanged={onMembersChanged} />}
        {onChangePassword && <PasswordSection onChangePassword={onChangePassword} />}
      </div>
    </div>
  );
}

function MembersSection({ backend, members, onChanged }: { backend: InboxBackend; members: Member[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'manager' as 'director' | 'manager' });
  const [adding, setAdding] = useState(false);
  /** The most recent one-time link, shown once with a copy button. It is never stored. */
  const [issued, setIssued] = useState<{ who: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(key); setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error);
    onChanged();
    return r.ok;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setError(null); setIssued(null); setCopied(false);
    const r = await backend.addMember({ email: form.email.trim(), name: form.name.trim(), role: form.role });
    setAdding(false);
    if (!r.ok) { setError(r.error); return; }
    setIssued({ who: form.name.trim() || form.email.trim(), link: r.link });
    setForm({ email: '', name: '', role: 'manager' });
    onChanged();
  }

  async function newLink(m: Member) {
    setBusy(m.user_id); setError(null); setIssued(null); setCopied(false);
    const r = await backend.memberLink(m.user_id);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setIssued({ who: memberName(m), link: r.link });
  }

  async function copy() {
    if (!issued) return;
    // 1) the modern clipboard API (needs a secure, focused page that is allowed to use the clipboard)
    try { await navigator.clipboard.writeText(issued.link); setCopied(true); setError(null); return; } catch { /* try the fallback */ }
    // 2) fallback that works where the clipboard API is blocked (embedded browsers, some phones, unfocused tabs)
    try {
      const ta = document.createElement('textarea');
      ta.value = issued.link; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { setCopied(true); setError(null); return; }
    } catch { /* fall through */ }
    // 3) last resort: select the link so it can be copied by hand
    document.querySelector<HTMLInputElement>('input[aria-label="Одноразовая ссылка"]')?.select();
    setError('Автоматически скопировать не получилось: ссылка выделена, нажмите Ctrl+C (на телефоне: удерживайте и «Копировать»).');
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">Команда</h2>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {issued && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">Ссылка для {issued.who}</p>
          <p className="text-emerald-900/80">Отправьте её сотруднику. По ссылке он сам задаст пароль и войдёт. Ссылка одноразовая и действует ограниченное время; в приложении она не сохраняется.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={issued.link} onFocus={(e) => e.currentTarget.select()} aria-label="Одноразовая ссылка" className="h-9 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs text-foreground" />
            <Button size="sm" onClick={copy}><Copy />{copied ? 'Скопировано' : 'Копировать'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Скрыть</Button>
          </div>
        </div>
      )}
      <ul className="divide-y rounded-lg border bg-card">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{memberName(m)}{!m.active && <span className="ml-2 text-xs font-normal text-muted-foreground">(отключён)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            {m.role === 'owner' ? (
              <Badge tone="emerald">{ROLE_LABEL.owner}</Badge>
            ) : (
              <>
                <select
                  aria-label={`Роль: ${memberName(m)}`} value={m.role} disabled={busy === m.user_id}
                  onChange={(e) => void run(m.user_id, () => backend.updateMember(m.user_id, { role: e.target.value as 'director' | 'manager' }))}
                  className="h-8 rounded-md border bg-card px-2 text-[13px]"
                >
                  <option value="manager">{ROLE_LABEL.manager}</option>
                  <option value="director">{ROLE_LABEL.director}</option>
                </select>
                <Button variant="outline" size="sm" disabled={busy === m.user_id} onClick={() => void newLink(m)} title="Новая одноразовая ссылка для входа или смены пароля">
                  <Link2 />Ссылка для входа
                </Button>
                <Button variant="outline" size="sm" disabled={busy === m.user_id}
                  onClick={() => void run(m.user_id, () => backend.updateMember(m.user_id, { active: !m.active }))}>
                  {m.active ? 'Отключить' : 'Включить'}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy === m.user_id} aria-label="Удалить сотрудника"
                  onClick={() => { if (window.confirm(`Удалить ${memberName(m)}? Его диалоги станут неназначенными.`)) void run(m.user_id, () => backend.removeMember(m.user_id)); }}>
                  {busy === m.user_id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="size-4" />Добавить сотрудника</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input type="email" required placeholder="Email для входа" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
          <Input placeholder="Имя" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select aria-label="Роль" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'director' | 'manager' })} className="h-10 rounded-md border bg-card px-3 text-sm">
            <option value="manager">{ROLE_LABEL.manager}</option>
            <option value="director">{ROLE_LABEL.director}</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">Пароль вводить не нужно: после добавления вы получите одноразовую ссылку, по которой сотрудник сам задаст пароль.</p>
        <Button type="submit" disabled={adding}>{adding ? <Loader2 className="animate-spin" /> : <UserPlus />}Добавить</Button>
      </form>
    </section>
  );
}

function PasswordSection({ onChangePassword }: { onChangePassword: (password: string) => Promise<string | null> }) {
  const [pw, setPw] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'busy' });
    const err = await onChangePassword(pw);
    if (err) setState({ kind: 'error', text: err }); else { setPw(''); setState({ kind: 'ok' }); }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">Мой пароль</h2>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-4">
        <Input type="password" required minLength={8} placeholder="Новый пароль (от 8 символов)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className="max-w-xs" />
        <Button type="submit" variant="outline" disabled={state.kind === 'busy'}>{state.kind === 'busy' ? <Loader2 className="animate-spin" /> : <KeyRound />}Сменить</Button>
        {state.kind === 'ok' && <span className="text-sm text-emerald-700">Пароль изменён.</span>}
        {state.kind === 'error' && <span className="text-sm text-red-700">{state.text}</span>}
      </form>
    </section>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function OrgNode({ m, open }: { m: Member; open: number | null }) {
  const tone = m.role === 'owner' ? 'bg-emerald-100 text-emerald-800' : m.role === 'director' ? 'bg-blue-100 text-blue-800' : 'bg-muted text-muted-foreground';
  return (
    <div className={`flex w-44 items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left shadow-sm ${m.active ? '' : 'opacity-50'}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${tone}`}>{initials(memberName(m))}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{memberName(m)}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {ROLE_LABEL[m.role]}{!m.active ? ' · отключён' : open !== null ? ` · в работе: ${open}` : ''}
        </span>
      </span>
    </div>
  );
}

/** A tree level: each node gets a stub up to the bus line; the bus spans first-to-last node. */
function OrgLevel({ children }: { children: React.ReactNode[] }) {
  return (
    <div className="flex justify-center">
      {children.map((c, i) => (
        <div
          key={i}
          className="relative px-1.5 pt-5 before:absolute before:left-1/2 before:top-0 before:h-5 before:w-px before:bg-border after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-border first:after:left-1/2 last:after:right-1/2 only:after:hidden"
        >
          {c}
        </div>
      ))}
    </div>
  );
}

function OrgChart({ members, stats }: { members: Member[]; stats: TeamStats | null }) {
  const owners = members.filter((m) => m.role === 'owner');
  const directors = members.filter((m) => m.role === 'director');
  const managers = members.filter((m) => m.role === 'manager');
  const open = (id: string) => stats?.managers.find((s) => s.user_id === id)?.open_now ?? null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">Структура команды</h2>
      <div className="overflow-x-auto rounded-lg border bg-card p-4">
        <div className="mx-auto flex w-max min-w-full flex-col items-center">
          <div className="flex gap-3">{owners.map((m) => <OrgNode key={m.user_id} m={m} open={null} />)}</div>
          {directors.length > 0 && (
            <OrgLevel>{directors.map((m) => <OrgNode key={m.user_id} m={m} open={null} />)}</OrgLevel>
          )}
          {managers.length > 0 ? (
            <OrgLevel>{managers.map((m) => <OrgNode key={m.user_id} m={m} open={open(m.user_id)} />)}</OrgLevel>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">Менеджеров пока нет. Добавьте их ниже в разделе «Команда».</p>
          )}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">Владелец → директора по продажам → менеджеры по продажам. «В работе» — открытые диалоги, где нужен человек.</p>
      </div>
    </section>
  );
}
