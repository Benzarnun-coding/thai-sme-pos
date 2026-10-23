// Browser check before deploy: runs the site locally (mock Meta, made-up data in a throwaway local D1), opens the
// pages people use and clicks through the training room the way staff do. Fails on any page error, failed /api
// call or missing element. `npm run e2e`; the deploy workflows run it before deploying.
// Things that need real keys (Claude, Meta) aren't exercised — they answer "not set" locally and that's expected.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;
const port = 8799, base = `http://127.0.0.1:${port}`;
const state = mkdtempSync(join(tmpdir(), 'ads-web-e2e-'));
const devVars = join(root, '.dev.vars');
const ownVars = !existsSync(devVars);
if (ownVars) writeFileSync(devVars, 'DEV_BYPASS_AUTH=true\nDEV_MOCK_META=true\n');

const sh = (args) => execFileSync('npx', args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const errors = [];
let dev;
try {
  sh(['vite', 'build']);
  sh(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
  sh(['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--file', 'scripts/e2e/seed.sql']);
  dev = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state], { cwd: root, stdio: 'ignore' });
  for (let i = 0; ; i++) {
    if ((await fetch(`${base}/api/me`).catch(() => null))?.ok) break;
    if (i > 60) throw new Error('local server did not start');
    await new Promise((r) => setTimeout(r, 1000));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(`page error on ${page.url()}: ${e.message}`));
  page.on('response', (r) => {
    // 400s from "no API key here" are expected locally; 500s never are.
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  const step = async (name, f) => { try { await f(); console.log(`ok  ${name}`); } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`ERR ${name}`); } };
  const visible = (sel) => page.locator(sel).first().waitFor({ state: 'visible', timeout: 10_000 });

  // Every page in the link bar loads and shows the bar.
  for (const path of ['/', '/catalog', '/catalog/orders', '/catalog/sales', '/catalog/profit', '/catalog/stock', '/catalog/todo', '/botkb', '/requests', '/studio/posts', '/studio', '/studio/train', '/studio/sets']) {
    await step(`open ${path}`, async () => { await page.goto(base + path); await visible('.site-nav'); });
  }

  await step('วัตถุดิบ: add a style card with a picture, a caption example, open a product', async () => {
    await page.goto(`${base}/studio`);
    await page.fill('input[placeholder^="ชื่อสไตล์"]', 'e2e style');
    await page.click('button:has-text("เพิ่มสไตล์")');
    await visible('.style-card:has-text("e2e style")');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('.style-card input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: png });
    await visible('.style-card .thumb img');
    await page.fill('textarea[placeholder="วางแคปชัน"]', 'e2e caption');
    await page.fill('input[placeholder^="ชอบเพราะ"]', 'short');
    await page.click('.new-example button:has-text("เพิ่ม")');
    await visible('.example:has-text("e2e caption")');
    await page.locator('.product-row [role=button]').first().click();
  });

  await step('โพสต์ที่ยิงอยู่: code box suggests by name and saves', async () => {
    await page.goto(`${base}/studio/posts`);
    const box = page.locator('.post-card:has-text("REV 5011") .code-picker input');
    await box.fill('ขาตรง');
    await page.locator('.suggest li:has-text("5011")').click();
    await page.waitForResponse((r) => r.url().includes('/meta-posts/code'));
  });

  await step('ห้องฝึก ภาพ: prompt, upload two images, judge the pair', async () => {
    await page.goto(`${base}/studio/train`);
    await page.click('button:has-text("🖼 ภาพ")');
    await page.locator('select').first().selectOption('801');
    await page.locator('select').nth(1).selectOption({ label: 'e2e style' });
    await page.click('button:has-text("ขอ prompt สำหรับ ChatGPT")');
    await visible('.kb-paste textarea');
    const jpg = (n) => ({ name: `${n}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.setInputFiles('.image-tools input[type=file]', [jpg('a'), jpg('b')]);
    await visible('.uploaded-row');
    await visible('.pair .cand');
    await page.locator('.pair .cand button:has-text("ดีกว่า")').first().click();
    await page.waitForResponse((r) => r.url().includes('/api/studio/judge'));
  });

  await step('ห้องจับคู่: lists the product with a passed image', async () => {
    await page.goto(`${base}/studio/sets`);
    await visible('button:has-text("801")');
  });

  await step('the manual PDF is served', async () => {
    const r = await fetch(`${base}/studio-guide.pdf`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('pdf')) throw new Error(`HTTP ${r.status}`);
  });

  await browser.close();
} catch (e) {
  errors.push(String(e?.message ?? e));
} finally {
  dev?.kill();
  if (ownVars) rmSync(devVars, { force: true });
  rmSync(state, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('\nbrowser check passed');
