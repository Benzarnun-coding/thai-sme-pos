#!/usr/bin/env node
/**
 * Build the shareable single-file demo.
 *
 *   node scripts/build-artifact.mjs [out.html]
 *
 * The published demo has no server behind it, so this bundles three things into
 * one HTML file:
 *   1. the real app bundle (vite build) — same code that runs against the API
 *   2. a frozen snapshot of every GET the app makes (server/scripts/snapshot.ts)
 *   3. a fetch shim that answers from the snapshot and replays the
 *      connect-account flow in the browser, including a stand-in consent screen
 *
 * Everything the page shows is demo data. Nothing here talks to Facebook.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'docs/mockup/demo.html'));
const isWin = process.platform === 'win32';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], shell: isWin });
  if (r.status !== 0) { console.error(`✖ ${cmd} ${args.join(' ')} failed`); process.exit(r.status ?? 1); }
}

const snapshotFile = path.join(os.tmpdir(), `loopdesk-snapshot-${process.pid}.json`);
console.log('▶ snapshotting the API');
run(isWin ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsx', 'scripts/snapshot.ts', snapshotFile], path.join(root, 'server'));
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
fs.rmSync(snapshotFile);

console.log('▶ building the app');
run(isWin ? 'npx.cmd' : 'npx', ['vite', 'build'], root);

const dist = path.join(root, 'dist');
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const assetOf = (re) => {
  const m = indexHtml.match(re);
  if (!m) throw new Error(`could not find ${re} in dist/index.html`);
  return fs.readFileSync(path.join(dist, m[1].replace(/^\//, '')), 'utf8');
};
const css = assetOf(/href="([^"]+\.css)"/);
const js = assetOf(/src="([^"]+\.js)"/);

const html = `<title>LoopDesk Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
${css}
${fs.readFileSync(path.join(root, 'scripts/artifact/demo.css'), 'utf8')}
</style>
<script>
window.__LOOPDESK_DEMO__ = ${JSON.stringify(snapshot)};
${fs.readFileSync(path.join(root, 'scripts/artifact/shim.js'), 'utf8')}
</script>
<div id="root"></div>
<div class="demo-bar">DEMO · Climax by PKjeans · ข้อมูลตัวอย่างทั้งหมด ไม่ได้ต่อ Facebook จริง</div>
<script type="module">${js}</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`✔ ${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
