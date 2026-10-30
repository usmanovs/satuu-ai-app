import { useState } from 'react';
import { Loader2, Phone, Plus } from 'lucide-react';
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

function NumberCard({ backend, me, members, n, onChanged }: { backend: InboxBackend; me: Me; members: Member[]; n: WaNumber; onChanged: () => void }) {
  const admin = me.role !== 'manager';
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
    setMsg(r.ok ? { ok: true, text: 'Сохранено.' } : { ok: false, text: r.error });
    if (r.ok) onChanged();
  }

  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Phone className="size-4 text-muted-foreground" />
        <b className="text-[15px]">{n.label}</b>
        {n.display_phone && <span className="text-sm text-muted-foreground">{n.display_phone}</span>}
        <Badge tone={n.owner_user_id ? 'emerald' : 'amber'}>{n.owner_user_id ? `Менеджер: ${memberName(ownerMember)}` : 'Общий номер'}</Badge>
        {!n.active && <Badge tone="neutral">отключён</Badge>}
        <span className="ml-auto text-[11px] text-muted-foreground" title="Cloud API phone_number_id">ID {n.phone_number_id}</span>
      </div>

      {admin && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">Название
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Номер для людей
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="+996 700 000 000" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Чей номер (менеджер)
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground">
              <option value="">Общий номер, без владельца</option>
              {members.filter((m) => m.role === 'manager' && (m.active || m.user_id === n.owner_user_id)).map((m) => (
                <option key={m.user_id} value={m.user_id}>{memberName(m)}{m.active ? '' : ' (отключён)'}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />Номер включён
          </label>
        </div>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <h4 className="text-sm font-semibold">AI-ассистент этого номера</h4>
        <label className="space-y-1 text-xs text-muted-foreground">Имя ассистента в чате
          <Input value={aName} onChange={(e) => setAName(e.target.value)} maxLength={60} placeholder="Например: Айгерим AI" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Стиль и фокус
          <Textarea value={aProfile} onChange={(e) => setAProfile(e.target.value)} maxLength={3000} rows={4}
            placeholder="Тон общения, на что делать упор, что рассказывать в первую очередь. Например: говорит тепло и коротко, делает упор на живые занятия."
            className="min-h-24 resize-y" />
        </label>
        <p className="text-xs text-muted-foreground">Ассистент всегда остаётся честным: он не выдаёт себя за менеджера или человека и, если клиент спросит, скажет, что это AI-помощник менеджера. Общие правила продаж и конфиденциальности действуют всегда.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>{busy && <Loader2 className="animate-spin" />}Сохранить</Button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
    </li>
  );
}

export function NumbersSection({ backend, me, members, numbers, onChanged }: Props) {
  const admin = me.role !== 'manager';
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
    onChanged();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold">{admin ? 'Номера и AI-ассистенты' : 'Мой номер и мой AI-ассистент'}</h2>
      {numbers.length === 0 && <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">{admin ? 'Номеров пока нет. Они появятся после первого сообщения клиента или добавьте номер ниже.' : 'За вами пока не закреплён номер. Попросите директора назначить его.'}</p>}
      <ul className="space-y-3">
        {numbers.map((n) => <NumberCard key={`${n.id}:${n.assistant_name ?? ''}:${n.owner_user_id ?? ''}`} backend={backend} me={me} members={members} n={n} onChanged={onChanged} />)}
      </ul>

      {admin && (
        <form onSubmit={add} className="space-y-3 rounded-lg border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Plus className="size-4" />Добавить номер</h3>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input required placeholder="phone_number_id из Meta (только цифры)" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} inputMode="numeric" />
            <Input placeholder="Название, например имя менеджера" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <Input placeholder="Номер для людей: +996 …" value={form.display_phone} onChange={(e) => setForm({ ...form, display_phone: e.target.value })} />
            <select aria-label="Чей номер" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} className="h-10 rounded-md border bg-card px-3 text-sm">
              <option value="">Общий номер, без владельца</option>
              {members.filter((m) => m.role === 'manager' && m.active).map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Номер также появится сам, когда на него придёт первое сообщение. Его phone_number_id виден в Meta: WhatsApp Manager → Phone numbers.</p>
          <Button type="submit" disabled={adding}>{adding ? <Loader2 className="animate-spin" /> : <Plus />}Добавить</Button>
        </form>
      )}
    </section>
  );
}
