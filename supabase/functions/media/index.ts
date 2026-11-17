// Customer photos, videos and documents: n8n downloads the file from WhatsApp and posts the raw bytes here.
// Auth: `Authorization: Bearer <integration key>` (same key as the `n8n` function; the business comes from the key).
// Headers: x-provider-message-id, x-media-mime, x-media-name (URL-encoded). Body: the file.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BYTES = 25 * 1024 * 1024;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dec(v: string | null) {
  try { return v ? decodeURIComponent(v) : ''; } catch { return v ?? ''; }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return reply({ error: 'use POST' }, 405);
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
    if (!m) return reply({ error: 'unauthorized' }, 401);
    const { data: business, error: kerr } = await sb.rpc('resolve_integration_key', { p_hash: await sha256Hex(m[1]) });
    if (kerr || !business) return reply({ error: 'unauthorized' }, 401);

    const pmid = dec(req.headers.get('x-provider-message-id')).trim();
    if (!pmid || pmid.length > 256) return reply({ error: 'missing x-provider-message-id' }, 422);
    const mime = (dec(req.headers.get('x-media-mime')).split(';')[0].trim().toLowerCase() || 'application/octet-stream').slice(0, 120);
    const name = dec(req.headers.get('x-media-name')).replace(/[\r\n\\/]/g, '_').slice(0, 160) || null;

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) return reply({ error: 'empty file' }, 422);
    if (bytes.length > MAX_BYTES) return reply({ error: 'too_large', size: bytes.length }, 413);

    const { data: target } = await sb.rpc('message_media_target', { p_business: business, p_provider_message_id: pmid });
    if (!target) return reply({ error: 'message_not_found' }, 404);
    if (target.already) return reply({ ok: true, already: true });

    const fromName = name && /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
    const ext = EXT[mime] ?? fromName ?? 'bin';
    const path = `${business}/${target.conversation_id}/${target.message_id}.${ext}`;

    const { error: uerr } = await sb.storage.from('chat-media').upload(path, bytes, { contentType: mime, upsert: true });
    if (uerr) { console.error('upload failed:', uerr.message); return reply({ error: 'upload_failed' }, 500); }

    const { error: aerr } = await sb.rpc('attach_message_media', {
      p_business: business, p_message: target.message_id, p_path: path, p_mime: mime, p_name: name, p_size: bytes.length,
    });
    if (aerr) { console.error('attach failed:', aerr.message); return reply({ error: 'attach_failed' }, 500); }
    return reply({ ok: true, path, size: bytes.length });
  } catch (e) {
    console.error('media error:', e);
    return reply({ error: 'internal_error' }, 500);
  }
});
