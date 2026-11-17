import { countryOf } from '@/lib/country';
import { useState } from 'react';
import { ChevronDown, Loader2, Phone, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { memberName } from '@/lib/format';
import type { InboxBackend, Me, Member, NumberPatch, WaNumber } from '@/lib/types';

interface Props {
  backend: InboxBackend;
  me: Me;
  members: Member[];
  numbers: WaNumber[];
  onChanged: () => void;
}

const field = 'h-8 px-2 text-[13px]';

function NumberRow({ backend, me, members, n, onChanged }: { backend: InboxBackend; me: Me; members: Member[]; n: WaNumber; onChanged: () => void }) {
  const admin = me.role !== 'manager';
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(n.label);
  const [display, setDisplay] = useState(n.display_phone ?? '');
  const [owner, setOwner] = useState(n.owner_user_id ?? '');
  const [active, setActive] = useState(n.active);
  const [aName, setAName] = useState(n.assistant_name ?? '');
  const [aProfile, setAProfile] = useState(n.assistant_profile ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ownerMember = members.find((m) => m.user_id === n.owner_user_id);
  const dirty =
    aName !== (n.assistant_name ?? '') || aProfile !== (n.assistant_profile ?? '') ||
    (admin && (label !== n.label || display !== (n.display_phone ?? '') || owner !== (n.owner_user_id ?? '') || active !== n.active));

  async function save() {
    const patch: NumberPatch = { assistant_name: aName, assistant_profile: aProfile };
    if (admin) { patch.label = label; patch.display_phone = display; patch.owner_user_id = owner === '' ? null : owner; patch.active = active; }
    setBusy(true); setMsg(null);
    const r = await backend.saveNumber(n.id, patch);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: 'Сохранено' } : { ok: false, text: r.error });
    if (r.ok) onChanged();
  }

  return (
    <li className="rounded-md border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]">
        <Phone className="size-3.5 shrink-0 text-muted-foreground" />
        <b className="truncate">{n.label}</b>
        {n.display_phone && <span className="hidden text-muted-foreground sm:inline">{(() => { const k = countryOf(n.display_phone); return k ? <span title={k.name} className="mr-1">{k.flag}</span> : null; })()}{n.display_phone}</span>}
        <Badge tone={n.owner_user_id ? 'emerald' : 'neutral'} className="shrink-0">{n.owner_user_id ? memberName(ownerMember) : 'Общий'}</Badge>
        {!n.active && <Badge tone="amber" className="shrink-0">отключён</Badge>}
        <ChevronDown className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {admin && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название" aria-label="Название" />
              <Input className={field} value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="+996 700 000 000" aria-label="Номер для людей" />
              <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Чей номер (менеджер)" className="h-8 w-full rounded-md border bg-card px-2 text-[13px]">
                <option value="">Общий, без владельца</option>
                {members.filter((m) => m.role === 'manager' && (m.active || m.user_id === n.owner_user_id)).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{memberName(m)}{m.active ? '' : ' (отключён)'}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />Включён
              </label>
            </div>
          )}

          <details className="text-[13px]" open={Boolean(aName || aProfile)}>
            <summary className="cursor-pointer text-muted-foreground" title="Нужно только для личного номера менеджера. Ассистент остаётся честным: не выдаёт себя за человека.">
              AI-ассистент этого номера (необязательно)
            </summary>
            <div className="mt-1.5 space-y-1.5">
              <Input className={field} value={aName} onChange={(e) => setAName(e.target.value)} maxLength={60} placeholder="Имя в чате, например: Айгерим AI" aria-label="Имя ассистента в чате" />
              <Textarea value={aProfile} onChange={(e) => setAProfile(e.target.value)} maxLength={3000} rows={2}
                placeholder="Стиль и фокус, например: говорит тепло и коротко, упор на живые занятия" aria-label="Стиль и фокус" className="min-h-14 resize-y text-[13px]" />
            </div>
          </details>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={busy || !dirty}>{busy && <Loader2 className="animate-spin" />}Сохранить</Button>
            {msg && <span className={`text-[13px] ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</span>}
            <span className="ml-auto text-[11px] text-muted-foreground" title="Cloud API phone_number_id">ID {n.phone_number_id}</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function NumbersSection({ backend, me, members, numbers, onChanged }: Props) {
  const admin = me.role !== 'manager';
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ phone_number_id: '', display_phone: '', label: '', owner_user_id: '' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setError(null);
    const r = await backend.addNumber({ ...form, phone_number_id: form.phone_number_id.trim(), owner_user_id: form.owner_user_id || null });
    setAdding(false);
    if (!r.ok) { setError(r.error); return; }
    setForm({ phone_number_id: '', display_phone: '', label: '', owner_user_id: '' });
    setShowAdd(false);
    onChanged();
  }

  const title = admin ? 'Номера и AI-ассистенты' : 'Мой номер и мой AI-ассистент';

  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-left">
        <h2 className="text-[13px] font-bold">{title}</h2>
        <span className="text-[13px] text-muted-foreground">{numbers.length}</span>
        <ChevronDown className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {numbers.length === 0 && <p className="rounded-md border bg-card p-3 text-[13px] text-muted-foreground">{admin ? 'Номеров пока нет. Они появятся после первого сообщения клиента.' : 'За вами пока не закреплён номер. Попросите директора назначить его.'}</p>}
          <ul className="space-y-1.5">
            {numbers.map((n) => <NumberRow key={`${n.id}:${n.assistant_name ?? ''}:${n.owner_user_id ?? ''}`} backend={backend} me={me} members={members} n={n} onChanged={onChanged} />)}
          </ul>

          {admin && !showAdd && (
            <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-1 text-[13px] font-medium text-primary"><Plus className="size-3.5" />Добавить номер</button>
          )}
          {admin && showAdd && (
            <form onSubmit={add} className="space-y-2 rounded-md border bg-card p-3">
              {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-[13px] text-red-800">{error}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <Input className={field} required placeholder="phone_number_id из Meta (цифры)" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} inputMode="numeric" />
                <Input className={field} placeholder="Название" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                <Input className={field} placeholder="Номер для людей: +996 …" value={form.display_phone} onChange={(e) => setForm({ ...form, display_phone: e.target.value })} />
                <select aria-label="Чей номер" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} className="h-8 rounded-md border bg-card px-2 text-[13px]">
                  <option value="">Общий, без владельца</option>
                  {members.filter((m) => m.role === 'manager' && m.active).map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" type="submit" disabled={adding}>{adding && <Loader2 className="animate-spin" />}Добавить</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setShowAdd(false)}>Отмена</Button>
                <span className="ml-auto text-[11px] text-muted-foreground">Номер также появится сам после первого сообщения.</span>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
