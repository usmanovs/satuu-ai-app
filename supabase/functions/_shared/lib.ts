// Deno-side helpers shared by the `n8n` and `inbox` functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { bearerToken, HttpError, mapDbError, sha256Hex } from './pure.ts';

export { HttpError, mapDbError };

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

let _admin: SupabaseClient | null = null;
/** Service-role client. Never exposed to the browser. */
export function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/** Calls a SQL function and converts its machine-coded errors to HttpError. */
export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) {
    const mapped = mapDbError(error.message);
    if (mapped.status === 500) console.error(`rpc ${fn} failed:`, error.message);
    throw mapped;
  }
  return data as T;
}

/** n8n authentication: the bearer key maps to ONE business. The payload's business_id must match it. */
export async function requireIntegration(req: Request, body: Record<string, unknown>): Promise<string> {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) throw new HttpError(401, 'unauthorized', 'Требуется ключ интеграции.');
  const businessId = await rpc<string | null>('resolve_integration_key', { p_hash: await sha256Hex(token) });
  if (!businessId) throw new HttpError(401, 'unauthorized', 'Неверный или отозванный ключ интеграции.');
  const claimed = body.business_id;
  if (typeof claimed !== 'string' || claimed !== businessId) {
    throw new HttpError(403, 'business_mismatch', 'business_id не соответствует ключу интеграции.');
  }
  return businessId;
}

/** Manager authentication: identity and business come from the verified JWT + membership, never from the body. */
export type Role = 'owner' | 'director' | 'manager';

export async function requireManager(req: Request): Promise<{ userId: string; businessId: string; role: Role; email: string | null; displayName: string | null }> {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) throw new HttpError(401, 'unauthorized', 'Требуется вход в систему.');
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized', 'Сессия недействительна. Войдите снова.');
  const { data: rows, error: mErr } = await admin()
    .from('business_memberships')
    .select('business_id, role, email, display_name')
    .eq('user_id', data.user.id)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (mErr) {
    console.error('membership lookup failed:', mErr.message);
    throw new HttpError(500, 'internal_error', 'Внутренняя ошибка сервера.');
  }
  if (!rows || rows.length === 0) throw new HttpError(403, 'forbidden', 'У вас нет доступа к бизнесу.');
  return {
    userId: data.user.id, businessId: rows[0].business_id as string, role: rows[0].role as Role,
    email: (rows[0].email as string | null) ?? data.user.email ?? null, displayName: (rows[0].display_name as string | null) ?? null,
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new HttpError(400, 'invalid_json', 'Тело запроса должно быть JSON-объектом.');
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
  console.error('unhandled error:', e);
  return json({ error: { code: 'internal_error', message: 'Внутренняя ошибка сервера.' } }, 500);
}
