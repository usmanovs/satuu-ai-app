import { useState } from 'react';
import { Loader2, MessageSquareText } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Login({ supabase, notice = null }: { supabase: SupabaseClient; notice?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message.toLowerCase().includes('invalid') ? 'Неверная почта или пароль.' : 'Не удалось войти. Попробуйте позже.');
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><MessageSquareText className="size-5" /></span>
          <div>
            <h1 className="text-lg font-bold leading-tight">Satuu AI</h1>
            <p className="text-sm text-muted-foreground">Входящие · вход для менеджера</p>
          </div>
        </div>
        <label className="block space-y-1.5 text-sm font-medium">Почта
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">Пароль
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {notice && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{notice}</p>}
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Войти</Button>
        <p className="text-center text-xs text-muted-foreground">Регистрации нет. Доступ выдаёт владелец аккаунта.</p>
      </form>
    </div>
  );
}
