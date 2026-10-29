import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { memberName, ROLE_LABEL } from '@/lib/format';
import type { InboxBackend, Me, Member, TeamStats } from '@/lib/types';

interface Props {
  backend: InboxBackend;
  me: Me;
  members: Member[];
  onMembersChanged: () => void;
  onChangePassword?: (password: string) => Promise<string | null>;
}

const PERIODS = [{ days: 7, label: '7 дней' }, { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' }];

function Card({ label, value, tone }: { label: string; value: number | string; tone?: 'hot' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${tone === 'hot' ? 'text-red-700' : ''}`}>{value}</p>
    </div>
  );
}

export function TeamPanel({ backend, me, members, onMembersChanged, onChangePassword }: Props) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
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
          {statsError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Не удалось загрузить статистику: {statsError}</p>}
          {!stats && !statsError && <p className="py-6 text-center text-sm text-muted-foreground">Загрузка…</p>}
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Card label="Диалогов" value={stats.summary.total} />
                <Card label="AI отвечает" value={stats.summary.ai_active} />
                <Card label="Нужен человек" value={stats.summary.human_requested} />
                <Card label="У менеджера" value={stats.summary.human_handling} />
                {me.role !== 'manager' && <Card label="Не назначены" value={stats.summary.unassigned} />}
                <Card label="Горячие (открытые)" value={stats.summary.hot_open} tone="hot" />
                <Card label="Купили" value={stats.summary.won} />
                <Card label="Не купили" value={stats.summary.lost} />
              </div>
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

        {isOwner && <MembersSection backend={backend} members={members} onChanged={onMembersChanged} />}
        {onChangePassword && <PasswordSection onChangePassword={onChangePassword} />}
      </div>
    </div>
  );
}

function MembersSection({ backend, members, onChanged }: { backend: InboxBackend; members: Member[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'manager' as 'director' | 'manager', password: '' });
  const [adding, setAdding] = useState(false);

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
    setAdding(true); setError(null);
    const r = await backend.addMember({ email: form.email.trim(), name: form.name.trim(), role: form.role, password: form.password });
    setAdding(false);
    if (!r.ok) { setError(r.error); return; }
    setForm({ email: '', name: '', role: 'manager', password: '' });
    onChanged();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">Команда</h2>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
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
        <div className="grid gap-2 sm:grid-cols-2">
          <Input type="email" required placeholder="Email для входа" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
          <Input placeholder="Имя" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select aria-label="Роль" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'director' | 'manager' })} className="h-10 rounded-md border bg-card px-3 text-sm">
            <option value="manager">{ROLE_LABEL.manager}</option>
            <option value="director">{ROLE_LABEL.director}</option>
          </select>
          <Input type="password" required minLength={8} placeholder="Временный пароль (от 8 символов)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </div>
        <p className="text-xs text-muted-foreground">Передайте сотруднику email и временный пароль лично. Он сможет сменить пароль в разделе «Команда» после входа.</p>
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
