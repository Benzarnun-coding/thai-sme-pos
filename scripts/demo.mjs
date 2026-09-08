#!/usr/bin/env node
/**
 * One-command local demo:
 *   npm run demo
 *
 * 1. installs server deps if missing
 * 2. seeds the embedded database (store "climax", 52 SKUs, 30 days of sample sales, brand docs)
 * 3. starts the LoopDesk API on :3001 and the POS web app on :5173
 * 4. prints the URL to open
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server');
const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';
const npx = isWin ? 'npx.cmd' : 'npx';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) { console.error(`\n✖ ${cmd} ${args.join(' ')} failed`); process.exit(r.status ?? 1); }
}

if (spawnSync(pnpm, ['--version'], { shell: isWin }).status !== 0) {
  console.log('▶ installing pnpm (one time)');
  run(isWin ? 'npm.cmd' : 'npm', ['install', '-g', 'pnpm'], root);
}
if (!fs.existsSync(path.join(server, 'node_modules'))) {
  console.log('▶ installing server dependencies');
  run(pnpm, ['install'], server);
}
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('▶ installing web app dependencies');
  run(isWin ? 'npm.cmd' : 'npm', ['install'], root);
}
if (!fs.existsSync(path.join(server, 'data', 'pglite'))) {
  console.log('▶ seeding demo database');
  run(pnpm, ['seed'], server);
}

console.log('▶ starting API (:3001) and web app (:5173)');
const api = spawn(pnpm, ['start'], { cwd: server, stdio: 'inherit', shell: isWin, env: { ...process.env, PORT: '3001' } });
const web = spawn(npx, ['vite', '--open', '/#Marketing'], { cwd: root, stdio: 'inherit', shell: isWin });

const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

setTimeout(() => {
  console.log('\n──────────────────────────────────────────────');
  console.log('  LoopDesk demo');
  console.log('  Web app   → http://localhost:5173/#Marketing');
  console.log('  API       → http://localhost:3001/api/stores/climax/signals');
  console.log('  Ctrl+C to stop');
  console.log('──────────────────────────────────────────────\n');
}, 2500);
