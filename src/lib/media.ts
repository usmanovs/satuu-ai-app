// Signed links to customer files (photos, videos, documents). The resolver is registered by the live backend.
type Resolver = (path: string) => Promise<string | null>;
let resolver: Resolver | null = null;
const cache = new Map<string, { url: string; at: number }>();

export function registerMediaResolver(r: Resolver) { resolver = r; }

/** A link that works for 50 minutes; reused while fresh. */
export async function mediaUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 50 * 60_000) return hit.url;
  if (!resolver) return null;
  const url = await resolver(path);
  if (url) cache.set(path, { url, at: Date.now() });
  return url;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
