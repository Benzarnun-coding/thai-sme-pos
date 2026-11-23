// Which Facebook post each campaign advertises: picture + link, read-only from Meta (GET only), cached 6 h in meta_cache.

export interface AdPost { ad_id: string; name: string; active: boolean; image: string | null; text: string | null; link: string | null }

const TTL_MS = 6 * 3_600_000;

/** Meta's page post id is "<pageId>_<postId>"; facebook.com/<that> opens the post. */
export function postLink(storyId: string | null | undefined): string | null {
  return storyId && /^\d+_\d+$/.test(storyId) ? `https://www.facebook.com/${storyId}` : null;
}

export function toAdPosts(rows: any[]): AdPost[] {
  const out = rows.map((a): AdPost => {
    const c = a.creative ?? {};
    return {
      ad_id: String(a.id),
      name: String(a.name ?? ''),
      active: a.effective_status === 'ACTIVE',
      image: c.image_url ?? c.thumbnail_url ?? null,
      text: (c.body ?? c.title ?? null) ? String(c.body ?? c.title).slice(0, 160) : null,
      link: postLink(c.effective_object_story_id ?? c.object_story_id),
    };
  });
  // Active ads first; ads that share one post are shown once.
  out.sort((a, b) => Number(b.active) - Number(a.active));
  const seen = new Set<string>();
  return out.filter((p) => { const k = p.link ?? p.ad_id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

export async function campaignPosts(
  db: D1Database, env: { META_ACCESS_TOKEN?: string; META_API_VERSION?: string }, campaignId: string,
): Promise<AdPost[]> {
  const key = `posts:${campaignId}`;
  const row = await db.prepare('SELECT fetched_at, data FROM meta_cache WHERE key = ?').bind(key).first<{ fetched_at: string; data: string }>();
  if (row && Date.now() - Date.parse(row.fetched_at) < TTL_MS) return JSON.parse(row.data);
  if (!env.META_ACCESS_TOKEN) return row ? JSON.parse(row.data) : [];
  try {
    const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION ?? 'v21.0'}/${campaignId}/ads`);
    url.searchParams.set('fields', 'id,name,effective_status,creative{thumbnail_url,image_url,effective_object_story_id,object_story_id,title,body}');
    url.searchParams.set('limit', '25');
    url.searchParams.set('access_token', env.META_ACCESS_TOKEN);
    const res = await fetch(url);
    const body: any = await res.json();
    if (!res.ok || body.error) throw new Error(body?.error?.message ?? res.statusText);
    const posts = toAdPosts(body.data ?? []);
    await db.prepare('INSERT INTO meta_cache (key, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data')
      .bind(key, new Date().toISOString(), JSON.stringify(posts)).run();
    return posts;
  } catch (err) {
    if (row) return JSON.parse(row.data);
    throw err;
  }
}
