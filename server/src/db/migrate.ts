import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type Db } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'migrations');

export async function migrate(db?: Db): Promise<string[]> {
  const d = db ?? (await getDb());
  await d.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`);
  const applied = new Set((await d.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    await d.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    await d.query('insert into schema_migrations(name) values ($1)', [f]);
    ran.push(f);
  }
  return ran;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then((ran) => {
    console.log(ran.length ? `applied: ${ran.join(', ')}` : 'up to date');
    process.exit(0);
  });
}
