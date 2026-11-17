import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SUPABASE_URL = url ?? '';
export const SUPABASE_ANON_KEY = anonKey ?? '';

/** null when the project is not configured: the UI then shows "Не подключено". */
export const supabase =
  url && anonKey && !url.includes('YOUR-PROJECT-REF')
    ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
