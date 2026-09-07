/**
 * Knowledge base seeding: a brand document is a folder of markdown files,
 * one per key (voice.md, usp.md, forbidden.md, policy.md, sizes.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client.js';

export async function loadBrandFolder(db: Db, storeId: string, folder: string, updatedBy = 'seed') {
  const keys: string[] = [];
  for (const f of fs.readdirSync(folder)) {
    if (!f.endsWith('.md')) continue;
    const key = f.replace(/\.md$/, '');
    const content = fs.readFileSync(path.join(folder, f), 'utf8');
    await db.query(
      `insert into brand_doc(store_id, key, content, updated_by) values ($1,$2,$3,$4)
       on conflict (store_id, key) do update set content=excluded.content, updated_by=excluded.updated_by, updated_at=now()`,
      [storeId, key, content, updatedBy],
    );
    keys.push(key);
  }
  return keys;
}

export async function getBrandDocs(db: Db, storeId: string) {
  return db.query<{ key: string; content: string; updated_at: string }>('select key, content, updated_at::text from brand_doc where store_id=$1 order by key', [storeId]);
}
