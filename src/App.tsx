import { useEffect, useMemo, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Inbox } from '@/components/Inbox';
import { Login } from '@/components/Login';
import { createDemoBackend } from '@/lib/demoBackend';
import { createLiveBackend } from '@/lib/liveBackend';
import { DEMO_MODE, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-6 text-sm shadow-sm">
        <h1 className="text-lg font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Invite and password-reset links land here with type=invite|recovery in the URL fragment. Captured before supabase-js clears it. */
let linkNeedsPassword = typeof window !== 'undefined' && /(?:[#&?])type=(invite|recovery)\b/.test(window.location.hash + window.location.search);

/**
 * Newer links look like  /?token_hash=...&type=invite|recovery  and are only used when the person presses a button.
 * Opening or previewing the link (for example WhatsApp fetching it to build a preview) therefore cannot use it up.
 */
const initialLink = (() => {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const tokenHash = q.get('token_hash');
  const type = q.get('type');
  return tokenHash && (type === 'invite' || type === 'recovery') ? { tokenHash, type } as const : null;
})();

/** Old-style links that were already used or expired come back with an error in the URL fragment. */
const linkExpired = typeof window !== 'undefined' && /(?:[#&])error(?:_code)?=(access_denied|otp_expired)/.test(window.location.hash);

function ConfirmLink({ client, link, onVerified, onSkip }: { client: SupabaseClient; link: { tokenHash: string; type: 'invite' | 'recovery' }; onVerified: () => void; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    const { error: err } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    setBusy(false);
    if (err) { setError('Ссылка уже использована или устарела. Попросите владельца создать новую.'); return; }
    window.history.replaceState({}, '', window.location.pathname);
    onVerified();
  }
  return (
    <Screen title={link.type === 'invite' ? 'Вас пригласили в Satuu AI' : 'Сброс пароля'}>
      <p>{link.type === 'invite' ? 'Нажмите «Продолжить», чтобы задать пароль и войти в панель.' : 'Нажмите «Продолжить», чтобы задать новый пароль.'}</p>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" role="alert">{error}</p>}
      <Button onClick={go} disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" /> : null}Продолжить</Button>
      {error && <Button variant="outline" onClick={onSkip} className="w-full">Ко входу</Button>}
    </Screen>
  );
}

function SetPassword({ client, onDone }: { client: SupabaseClient; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await client.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) { setError(err.message); return; }
    linkNeedsPassword = false;
    onDone();
  }
  return (
    <Screen title="Задайте пароль">
      <p>Придумайте пароль для входа в панель. Он нужен только вам.</p>
      <form onSubmit={submit} className="space-y-3">
        <Input type="password" required minLength={8} autoFocus placeholder="Пароль (от 8 символов)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        {error && <p className="text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" /> : null}Сохранить и войти</Button>
      </form>
    </Screen>
  );
}

function Authenticated({ client, session }: { client: SupabaseClient; session: Session }) {
  const [business, setBusiness] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const backend = useMemo(() => createLiveBackend(client, SUPABASE_URL, SUPABASE_ANON_KEY), [client]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Row-level security returns only businesses this user is a member of.
      const { data } = await client.from('businesses').select('id, name').limit(1);
      if (!cancelled) setBusiness(data && data.length > 0 ? (data[0] as { id: string; name: string }) : null);
    })();
    return () => { cancelled = true; };
  }, [client, session.user.id]);

  if (business === undefined) return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (business === null) {
    return (
      <Screen title="Нет доступа">
        <p>Аккаунт <b>{session.user.email}</b> не привязан ни к одному бизнесу. Доступ выдаёт владелец (см. docs/PROVISIONING.md).</p>
        <Button variant="outline" onClick={() => client.auth.signOut()}>Выйти</Button>
      </Screen>
    );
  }
  async function changePassword(password: string): Promise<string | null> {
    const { error } = await client.auth.updateUser({ password });
    return error ? error.message : null;
  }
  return <Inbox backend={backend} businessName={business.name} onSignOut={() => client.auth.signOut()} onChangePassword={changePassword} />;
}

function LiveApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [needsPassword, setNeedsPassword] = useState(linkNeedsPassword);
  const [pendingLink, setPendingLink] = useState(initialLink);
  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setNeedsPassword(true); setSession(s); });
    return () => data.subscription.unsubscribe();
  }, [client]);
  if (session === undefined) return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (pendingLink) {
    return (
      <ConfirmLink
        client={client} link={pendingLink}
        onVerified={() => { setNeedsPassword(true); setPendingLink(null); }}
        onSkip={() => { window.history.replaceState({}, '', window.location.pathname); setPendingLink(null); }}
      />
    );
  }
  if (!session) return <Login supabase={client} notice={linkExpired ? 'Ссылка уже использована или устарела. Попросите владельца создать новую.' : null} />;
  if (needsPassword) return <SetPassword client={client} onDone={() => setNeedsPassword(false)} />;
  return <Authenticated client={client} session={session} />;
}

const demoBackend = DEMO_MODE ? createDemoBackend() : null;

export default function App() {
  if (DEMO_MODE && demoBackend) return <Inbox backend={demoBackend} />;
  if (!supabase) {
    return (
      <Screen title="Не подключено">
        <p>Supabase не настроен. Скопируйте <code>.env.example</code> в <code>.env.local</code> и укажите <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code>.</p>
        <p className="text-muted-foreground">Чтобы посмотреть интерфейс на вымышленных данных: <code>npm run dev:demo</code>.</p>
      </Screen>
    );
  }
  return <LiveApp client={supabase} />;
}
