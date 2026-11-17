import { useEffect, useState } from 'react';
import { Download, FileText, ImageOff } from 'lucide-react';
import { formatBytes, mediaUrl } from '@/lib/media';
import type { Message } from '@/lib/types';

/** Photo, video or document the customer sent. Shows the real file when it was saved. */
export function MediaView({ m }: { m: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const path = m.media_path ?? null;

  useEffect(() => {
    let alive = true;
    setUrl(null); setFailed(false);
    if (path) mediaUrl(path).then((u) => { if (!alive) return; if (u) setUrl(u); else setFailed(true); }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [path]);

  if (!path) return null;
  if (failed) return <p className="mb-1 flex items-center gap-1.5 text-[13px] italic opacity-70"><ImageOff className="size-4" aria-hidden />Файл не удалось загрузить</p>;
  if (!url) return <div className="skeleton mb-1 h-40 w-56 max-w-full rounded-lg" aria-busy="true" />;

  const mime = m.media_mime ?? '';
  if (mime.startsWith('image/')) {
    return <a href={url} target="_blank" rel="noreferrer" className="mb-1 block"><img src={url} alt={m.media_name ?? 'Фото'} loading="lazy" className="max-h-80 max-w-full rounded-lg object-contain" /></a>;
  }
  if (mime.startsWith('video/')) {
    return <video src={url} controls preload="metadata" className="mb-1 max-h-80 max-w-full rounded-lg bg-black" />;
  }
  const label = m.media_name ?? 'Документ';
  return (
    <a href={url} target="_blank" rel="noreferrer" download={m.media_name ?? undefined} className="mb-1 flex items-center gap-2.5 rounded-lg border border-current/20 bg-black/5 px-3 py-2 no-underline">
      <FileText className="size-6 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{label}</span><span className="block text-[11px] opacity-70">{formatBytes(m.media_size)}</span></span>
      <Download className="size-4 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}
