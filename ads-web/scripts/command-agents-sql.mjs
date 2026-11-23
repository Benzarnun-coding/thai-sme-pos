// Turn the team's agents JSON (a file OUTSIDE the repo) into SQL for the local D1 table command_sources, after checking it.
// Writes a file and prints how to load it. It never runs wrangler and never touches --remote.
//
//   node scripts/command-agents-sql.mjs <agents.json> [--out <file.sql>] [--expect total=10,active=2,...] [--check]
//
//   --check    validate and print the counters only, write nothing
//   --expect   fail unless each counter equals the number (keys: total active paused pkAuto vacant staffed pending
//              pendingEvidenced pendingDraft approved proposals evidenced draft)
//   --out      default .wrangler/command-agents.sql (that folder is git-ignored). Keep real data out of the repo.
//
// Format of the input: see web/src/agents/README.md. Spec: worker/agentsStore.ts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildSql, byteLength, checkExpected, splitAgents, validateAgents } from '../worker/agentsStore.ts';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2); return v ?? ''; };
const check = args.includes('--check'); if (check) args.splice(args.indexOf('--check'), 1);
const out = flag('--out') ?? '.wrangler/command-agents.sql';
const expectArg = flag('--expect');
const file = args[0];
const die = (m) => { console.error(m); process.exit(1); };
if (!file || file.startsWith('--')) die('usage: node scripts/command-agents-sql.mjs <agents.json> [--out file.sql] [--expect k=v,...] [--check]');

let data;
try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { die(`cannot read ${file} as JSON: ${e.message}`); }

const v = validateAgents(data);
for (const w of v.warnings) console.warn(`warning: ${w}`);
if (v.errors.length) { for (const e of v.errors) console.error(`error: ${e}`); die(`${v.errors.length} error(s): nothing written`); }
const c = v.counts;
console.log(`positions ${c.total}: active ${c.active} · paused ${c.paused} · pk-auto ${c.pkAuto} · vacant ${c.vacant} · staffed ${c.staffed}`);
console.log(`proposals waiting ${c.pending} (evidence ${v.evidenced} · drafted from title ${v.draft}) · approved ${c.approved}`);
if (expectArg) {
  const expect = Object.fromEntries(expectArg.split(',').map((kv) => { const [k, n] = kv.split('='); return [k.trim(), Number(n)]; }));
  const bad = checkExpected(v, expect);
  if (bad.length) { for (const b of bad) console.error(`expected: ${b}`); die('counters differ from --expect: nothing written'); }
  console.log(`--expect ok (${Object.keys(expect).length} counters)`);
}
if (check) process.exit(0);

const split = splitAgents(data, randomUUID());
const stmts = buildSql(split, new Date().toISOString());
const path = resolve(out);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stmts.join('\n') + '\n');
console.log(`\nwrote ${stmts.length} statements to ${out}; biggest ${Math.max(...stmts.map(byteLength))} bytes (limit 90000)`);
console.log(`\nLocal:   npx wrangler d1 execute DB --local --file ${out}`);
console.log('Remote:  this script never does it. เบ๊น/temperance ทำเองหลังอนุมัติ: wrangler d1 execute DB --remote --file <ไฟล์ .sql>');
