// Load a Meta data snapshot (pulled by Claude through the meta-ads MCP) into the LOCAL D1 database,
// so the dashboard shows real campaigns before a System User token exists. Dev only; never touches --remote.
//
//   npm run snapshot:load                      uses .dev-snapshot/pkjeans.json
//   npm run snapshot:load -- path/to/file.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = process.argv[2] ?? '.dev-snapshot/pkjeans.json';
const snapshot = JSON.parse(readFileSync(file, 'utf8'));
if (!snapshot.taken_at || !Array.isArray(snapshot.campaigns_30d)) throw new Error(`${file} is not a snapshot`);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = [
  'CREATE TABLE IF NOT EXISTS dev_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), taken_at TEXT NOT NULL, data TEXT NOT NULL);',
  `INSERT OR REPLACE INTO dev_snapshot (id, taken_at, data) VALUES (1, ${q(snapshot.taken_at)}, ${q(JSON.stringify(snapshot))});`,
].join('\n');

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/load-snapshot.sql', sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', '.wrangler/load-snapshot.sql'], { stdio: 'inherit' });
console.log(`\nloaded ${snapshot.campaigns_30d.length} campaigns, ${snapshot.adsets_7d?.length ?? 0} ad sets (taken ${snapshot.taken_at})`);
