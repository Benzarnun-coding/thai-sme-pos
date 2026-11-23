import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NO_FILTER, approvalProblem, awaitingApproval, countRows, filterRows, groupByDept, isApproved, isDraftFromTitle, isEvidenced, isIsoDate, loadAgents,
  proposalChipCounts, scopeLines, sortRows, statusChipCounts, thaiDate, visibleRows,
} from '../web/src/agents/agentsView.ts';
import { assembleAgents, buildSql, byteLength, checkExpected, splitAgents, validateAgents, STATEMENT_MAX_BYTES } from './agentsStore.ts';
import { makeAgents } from './agentsFixture.ts';

// The "ทีม Agent" view of /command and its data. Pure logic (web/src/agents/agentsView.ts), the validator and the
// split/assemble of worker/agentsStore.ts. All data is made up (worker/agentsFixture.ts): the real file is not in the repo.
// The API itself (auth, 401/403/200) is tested in command.test.ts.

const TODAY = '2026-11-23';
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
const fx = makeAgents({ n: 24, evidenced: 3 });
const loaded = loadAgents(fx);
/** One vacant row whose proposal is `proposal` (raw JSON shape). */
const one = (proposal: Record<string, unknown>) => loadAgents({ positions: [{ id: 'a-1', department: 'x', title: 'A', status: 'vacant', proposal }] }).rows[0];

// ---------- "ข้อเสนอ" label (the 7 tests of the plan, section 3) ----------

test('label 1: approved=true without approved_by is not approved: still a proposal', () => {
  const r = one({ approved: true, approved_on: '2026-11-20' });
  assert.equal(isApproved(r.proposal!, TODAY), false);
  assert.equal(awaitingApproval(r, TODAY), true);
  assert.equal(countRows([r], TODAY).pending, 1);
  assert.equal(isApproved(one({ approved: true, approved_by: '   ', approved_on: '2026-11-20' }).proposal!, TODAY), false);
});

test('label 2: approved=true with no approved_on, a wrong format, an impossible date or a future date is not approved', () => {
  for (const on of [undefined, null, '', '20/11/2026', '2026-11-20T00:00:00Z', '2026-02-30', '2026-13-01', '2026-11-24', 20261120]) {
    const p = one({ approved: true, approved_by: 'owner', approved_on: on }).proposal!;
    assert.equal(isApproved(p, TODAY), false, String(on));
    assert.ok(approvalProblem(p, TODAY), String(on));
  }
});

test('label 3: all three conditions → approved, and the detail has the name and the date to show', () => {
  const r = one({ approved: true, approved_by: 'owner', approved_on: '2026-11-23' });
  assert.equal(isApproved(r.proposal!, TODAY), true);
  assert.equal(approvalProblem(r.proposal!, TODAY), null);
  assert.equal(awaitingApproval(r, TODAY), false);
  assert.equal(r.proposal!.approvedBy, 'owner');
  assert.equal(thaiDate(r.proposal!.approvedOn), '23 พ.ย. 2569');
  const c = countRows([r], TODAY);
  assert.deepEqual([c.pending, c.approved], [0, 1]);
  // approved=false stays a proposal even when the other two are filled in
  assert.equal(isApproved(one({ approved: false, approved_by: 'owner', approved_on: '2026-11-20' }).proposal!, TODAY), false);
  // anything but a literal true
  assert.equal(isApproved(one({ approved: 'yes', approved_by: 'owner', approved_on: '2026-11-20' }).proposal!, TODAY), false);
});

test('label 4: the whole-file validator reports an error for every approved proposal that is incomplete', () => {
  const d = makeAgents({ n: 24 });
  const vac = d.positions.filter((p) => p.proposal);
  Object.assign(vac[0].proposal!, { approved: true });                                           // no name, no date
  Object.assign(vac[1].proposal!, { approved: true, approved_by: 'owner' });                      // no date
  Object.assign(vac[2].proposal!, { approved: true, approved_by: 'owner', approved_on: '2999-01-01' }); // future
  Object.assign(vac[3].proposal!, { approved: true, approved_by: 'owner', approved_on: '2026-11-20' }); // fine
  const v = validateAgents(d, TODAY);
  assert.equal(v.errors.length, 3, v.errors.join('\n'));
  for (const p of vac.slice(0, 3)) assert.ok(v.errors.some((e) => e.endsWith(`: ${p.id}`)), p.id);
  assert.deepEqual(validateAgents(makeAgents({ n: 24 }), TODAY).errors, []);
});

test('label 5: every proposal in the data is not approved; the two sources add up and come from the data, not from a constant', () => {
  const c = countRows(loaded.rows, TODAY);
  assert.equal(loaded.rows.filter((r) => r.proposal).length, c.pending);
  assert.equal(loaded.rows.filter((r) => r.proposal && isApproved(r.proposal, TODAY)).length, 0);
  assert.deepEqual([c.pending, c.pendingEvidenced, c.pendingDraft], [9, 3, 6]);
  assert.equal(loaded.rows.filter((r) => r.proposal && isDraftFromTitle(r.proposal)).length, 6);
  assert.equal(loaded.rows.filter((r) => r.proposal && isEvidenced(r.proposal)).length, 3);
  // other sizes give other numbers
  const big = countRows(loadAgents(makeAgents({ n: 40, evidenced: 5 })).rows, TODAY);
  assert.deepEqual([big.pending, big.pendingEvidenced, big.pendingDraft], [15, 5, 10]);
});

test('label 6: the old shape (only approved=false, no approved_by/on, no basis) still loads and shows as a proposal', () => {
  const l = loadAgents({ positions: [{ id: 'a-1', department: 'x', title: 'A', status: 'vacant', proposal: { approved: false, name: 'n', duty: 'd' } }] });
  assert.equal(l.skipped.length, 0);
  assert.equal(awaitingApproval(l.rows[0], TODAY), true);
  assert.equal(l.rows[0].proposal!.basis, null);
  const c = countRows(l.rows, TODAY);
  assert.deepEqual([c.pending, c.pendingEvidenced, c.pendingDraft], [1, 0, 0]);
  assert.deepEqual(validateAgents({ positions: [{ id: 'a-1', department: 'x', title: 'A', status: 'vacant', proposal: { approved: false, scope: { draft_only: true, sends_to_customers: false, pays_money: false } } }] }, TODAY).errors, []);
});

test('label 7: the state and source filters give the same numbers as the counters, and the chips follow the other filters', () => {
  const c = countRows(loaded.rows, TODAY);
  const f = (o: object) => filterRows(loaded.rows, { ...NO_FILTER, ...o }, undefined, TODAY);
  assert.equal(f({ prop: 'pending' }).length, c.pending);
  assert.equal(f({ prop: 'approved' }).length, c.approved);
  assert.equal(f({ basis: 'evidenced' }).length, c.pendingEvidenced);
  assert.equal(f({ basis: 'draft' }).length, c.pendingDraft);
  assert.deepEqual(proposalChipCounts(loaded.rows, NO_FILTER, TODAY), { pending: 9, approved: 0, evidenced: 3, draft: 6 });
  // vacant only: the chips count the vacant rows, and the source chips ignore themselves
  const chips = proposalChipCounts(loaded.rows, { ...NO_FILTER, status: 'vacant', basis: 'draft' }, TODAY);
  assert.equal(chips.pending, f({ status: 'vacant', basis: 'draft' }).length);
  assert.equal(chips.evidenced + chips.draft, f({ status: 'vacant' }).length);
  // an approved proposal moves from 'pending' to 'approved' and its source badge stays
  const d = makeAgents({ n: 24 });
  Object.assign(d.positions.find((p) => p.proposal)!.proposal!, { approved: true, approved_by: 'owner', approved_on: '2026-11-20', basis: 'suggested-from-title' });
  const l = loadAgents(d);
  const cc = countRows(l.rows, TODAY);
  assert.deepEqual([cc.pending, cc.approved], [8, 1]);
  assert.equal(filterRows(l.rows, { ...NO_FILTER, prop: 'approved' }, undefined, TODAY).length, 1);
  assert.equal(isDraftFromTitle(filterRows(l.rows, { ...NO_FILTER, prop: 'approved' }, undefined, TODAY)[0].proposal!), true);
});

test('isIsoDate: real calendar dates only', () => {
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2028-02-29'), true);
  for (const x of ['2026-02-29', '2026-2-3', '', null, undefined, 5]) assert.equal(isIsoDate(x), false, String(x));
});

// ---------- counters, search, filter ----------

test('counters come from the rows: statuses add up, staffed = active + paused + pk-auto', () => {
  const c = countRows(loaded.rows, TODAY);
  assert.deepEqual([c.total, c.active, c.paused, c.pkAuto, c.vacant, c.staffed], [24, 6, 6, 6, 6, 18]);
  assert.deepEqual([c.pendingVacant, c.pendingStaffed], [6, 3]);
});

test('search: Thai and English, case-insensitive, every word must match, order and spacing do not matter', () => {
  assert.deepEqual(ids(filterRows(loaded.rows, { ...NO_FILTER, query: 'PROPOSAL-4' })), [loaded.rows.find((r) => r.proposal?.name === 'proposal-4')!.id]);
  assert.equal(filterRows(loaded.rows, { ...NO_FILTER, query: 'ตำแหน่ง   ตัวอย่าง' }).length, 24);
  assert.equal(filterRows(loaded.rows, { ...NO_FILTER, query: 'ตัวอย่าง xxxnotaword' }).length, 0);
  assert.equal(filterRows(loaded.rows, { ...NO_FILTER, query: '   ' }).length, 24);
  const rows = loadAgents({ positions: [{ id: 'a-1', department: 'x', title: 'café', status: 'vacant' }] }).rows;
  assert.equal(filterRows(rows, { ...NO_FILTER, query: 'café' }).length, 1);
});

test('filter by department and status; status chip counts follow department + search but not the status chip', () => {
  const dept = filterRows(loaded.rows, { ...NO_FILTER, department: 'sales' });
  assert.equal(dept.length, 8);
  const chips = statusChipCounts(loaded.rows, { ...NO_FILTER, department: 'sales', status: 'vacant' });
  assert.equal(chips.all, 8);
  assert.equal(chips.active + chips.paused + chips['pk-auto'] + chips.vacant, 8);
  assert.equal(chips.vacant, filterRows(loaded.rows, { ...NO_FILTER, department: 'sales', status: 'vacant' }).length);
});

test('counters ignore filters (they are computed from all the rows)', () => {
  const before = countRows(loaded.rows, TODAY);
  filterRows(loaded.rows, { query: 'zzz', department: 'sales', status: 'active' });
  assert.deepEqual(countRows(loaded.rows, TODAY), before);
});

test('order: department, then active < pk-auto < paused < vacant, vacant by proposal priority', () => {
  const sorted = sortRows(loaded.rows, loaded.departments);
  const di = new Map(loaded.departments.map((d, i) => [d.id, i]));
  for (let i = 1; i < sorted.length; i++) assert.ok(di.get(sorted[i - 1].department)! <= di.get(sorted[i].department)!);
  const order = ['active', 'pk-auto', 'paused', 'vacant'];
  const first = sorted.filter((r) => r.department === sorted[0].department).map((r) => r.status);
  assert.deepEqual(first, [...first].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  for (const d of loaded.departments) {
    const vac = visibleRows(loaded.rows, loaded.departments, { ...NO_FILTER, department: d.id, status: 'vacant' }).map((r) => r.proposal!.priority!);
    assert.ok(vac.length > 0);
    assert.deepEqual(vac, [...vac].sort((a, b) => a - b));
  }
});

test('order: a vacant row without a priority sorts after those with one', () => {
  const l = loadAgents({ positions: [
    { id: 'a-1', department: 'x', title: 'A', status: 'vacant', proposal: null },
    { id: 'a-2', department: 'x', title: 'B', status: 'vacant', proposal: { priority: 9 } },
    { id: 'a-3', department: 'x', title: 'C', status: 'vacant', proposal: { priority: 2 } },
  ] });
  assert.deepEqual(ids(sortRows(l.rows, l.departments)), ['a-3', 'a-2', 'a-1']);
});

test('unknown status is shown as paused (never vacant) and listed; bad rows skipped; duplicate id keeps the first', () => {
  const l = loadAgents({ positions: [
    { id: 'a-1', department: 'x', title: 'A', status: 'weird' },
    { id: 'a-2', department: 'x', title: 'B' },
    { id: 'a-3', title: 'C', status: 'active' },
    { id: 'a-3', title: 'dup', status: 'vacant' },
    null,
  ] });
  assert.equal(l.rows.find((r) => r.id === 'a-1')!.status, 'paused');
  assert.deepEqual(l.unknownStatus, ['a-1']);
  assert.deepEqual(l.skipped, ['a-2', 'a-3', '#4']);
  assert.equal(l.rows.find((r) => r.id === 'a-3')!.title, 'C');
  assert.equal(countRows(l.rows, TODAY).vacant, 0);
});

test('scope: object flags, codes, string; a limit that does not hold is said out loud', () => {
  assert.deepEqual(scopeLines({ draft_only: true, sends_to_customers: false, pays_money: false, notes: 'ร่างเท่านั้น' }),
    ['ทำได้แค่ร่าง ไม่ส่งออกเอง', 'ไม่ส่งอะไรถึงลูกค้า', 'ไม่จ่ายเงิน ไม่สั่งซื้อ', 'ร่างเท่านั้น']);
  assert.deepEqual(scopeLines('no-payment'), ['ไม่จ่ายเงิน ไม่สั่งซื้อ']);
  assert.deepEqual(scopeLines({ draft_only: true, sends_to_customers: true, pays_money: false }), ['ทำได้แค่ร่าง ไม่ส่งออกเอง', 'ไม่จ่ายเงิน ไม่สั่งซื้อ', 'อาจส่งถึงลูกค้า']);
  assert.deepEqual(scopeLines(null), []);
});

test('300 rows and a department outside the usual seven: counts, search, groups all work', () => {
  const l = loadAgents(makeAgents({ n: 300 }));
  assert.equal(l.rows.length, 300);
  const c = countRows(l.rows, TODAY);
  assert.equal(c.active + c.paused + c.pkAuto + c.vacant, 300);
  assert.equal(l.departments.length, 3);
  const groups = groupByDept(visibleRows(l.rows, l.departments, NO_FILTER), l.rows, l.departments);
  assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), 300);
  assert.deepEqual(ids(filterRows(l.rows, { ...NO_FILTER, query: 'ตำแหน่ง 299' })), [l.rows[298].id]);
});

test('empty or broken data: no rows, no crash', () => {
  for (const bad of [null, undefined, {}, { positions: 'x' }, { positions: [] }, []]) {
    const l = loadAgents(bad);
    assert.equal(l.rows.length, 0);
    assert.equal(countRows(l.rows, TODAY).total, 0);
  }
});

test('thaiDate: ISO dates only', () => {
  assert.equal(thaiDate('2026-11-16'), '16 พ.ย. 2569');
  assert.equal(thaiDate('16/11/2026'), null);
  assert.equal(thaiDate(undefined), null);
});

// ---------- validator ----------

test('validator: errors for the things that would mislead, nothing for a good file', () => {
  assert.deepEqual(validateAgents(makeAgents(), TODAY).errors, []);
  assert.ok(validateAgents(null).errors.length);
  assert.ok(validateAgents({ positions: 'x' }).errors.length);
  assert.ok(validateAgents({ positions: [] }).errors.length); // an empty file must not load as "0 positions"
  const bad = makeAgents();
  (bad.positions[1] as { status: string }).status = 'weird';
  bad.positions.push({ ...bad.positions[0] });                       // duplicate id
  const noProposal = bad.positions.find((p) => p.status === 'vacant')!; noProposal.proposal = null;
  const dupPrio = bad.positions.filter((p) => p.proposal);
  dupPrio[1].proposal!.priority = dupPrio[0].proposal!.priority;
  dupPrio[2].proposal!.scope.pays_money = true;
  bad.departments[0].skilltree_count += 1;
  const e = validateAgents(bad, TODAY).errors.join('\n');
  for (const want of ['unknown status', 'duplicate id', 'vacant row without a proposal', 'priority', 'scope', 'skilltree_count']) assert.match(e, new RegExp(want), want);
});

test('validator: --expect style check of the counters', () => {
  const v = validateAgents(makeAgents({ n: 24, evidenced: 3 }), TODAY);
  assert.deepEqual(checkExpected(v, { total: 24, active: 6, vacant: 6, proposals: 9, evidenced: 3, draft: 6 }), []);
  assert.equal(checkExpected(v, { total: 25, nope: 1 }).length, 2);
});

// ---------- split / assemble / sql ----------

const rows = (s: ReturnType<typeof splitAgents>, at = '2026-11-23T01:00:00.000Z') => [s.meta, ...s.parts].map((r) => ({ source: r.source, updated_at: at, data: r.data }));

test('split: parts stay under the size, every row is in exactly one part, and assembling gives the same data back', () => {
  const d = makeAgents({ n: 60, pad: 2000 });
  const s = splitAgents(d, 'rev-1', 20_000);
  assert.ok(s.parts.length >= 5);
  for (const p of s.parts) assert.ok(byteLength(p.data) <= 20_000, p.source);
  assert.deepEqual(s.parts.map((p) => p.source), s.parts.map((_, i) => `agents:${String(i + 1).padStart(3, '0')}`));
  const a = assembleAgents(rows(s));
  assert.ok(a.ok);
  if (a.ok) { assert.deepEqual(a.data, d); assert.equal(a.as_of, '2026-11-23T01:00:00.000Z'); }
  assert.throws(() => splitAgents(makeAgents({ n: 2, pad: 5000 }), 'r', 1000), /bigger/);
});

test('assemble: no rows is "missing"; a lost part, a part from another load, a wrong count or broken JSON is an error, never partial data', () => {
  const s = splitAgents(makeAgents({ n: 60, pad: 2000 }), 'rev-1', 20_000);
  assert.deepEqual(assembleAgents([]), { ok: false, missing: true });
  assert.deepEqual(assembleAgents(rows(s).filter((r) => r.source !== 'agents')), { ok: false, missing: true }); // parts without meta
  const lost = assembleAgents(rows(s).filter((r) => r.source !== 'agents:002'));
  assert.ok(!lost.ok && !lost.missing && /missing/.test(lost.reason));
  const other = splitAgents(makeAgents({ n: 60, pad: 2000 }), 'rev-2', 20_000);
  const mixed = rows(s).map((r) => (r.source === 'agents:002' ? rows(other).find((x) => x.source === 'agents:002')! : r));
  const m = assembleAgents(mixed);
  assert.ok(!m.ok && !m.missing && /another load/.test(m.reason));
  const cut = rows(s).map((r) => (r.source === 'agents:001' ? { ...r, data: JSON.stringify({ rev: 'rev-1', positions: [] }) } : r));
  assert.ok(!assembleAgents(cut).ok);
  const broken = rows(s).map((r) => (r.source === 'agents:001' ? { ...r, data: '{nope' } : r));
  assert.ok(!assembleAgents(broken).ok);
  assert.ok(!assembleAgents(rows(s).map((r) => (r.source === 'agents' ? { ...r, data: '[]' } : r))).ok);
  // extra parts left over from an older load are ignored
  const stale = assembleAgents([...rows(s), { source: 'agents:009', updated_at: 'x', data: '{"rev":"old","positions":[1]}' }]);
  assert.ok(stale.ok);
});

test('sql: parts first, meta last, old parts deleted after; every statement under 90000 bytes; quotes are escaped', () => {
  const d = makeAgents({ n: 200, pad: 900 });
  d.positions[0].title = "it's a ' test";
  const s = splitAgents(d, 'rev-1');
  const sql = buildSql(s, '2026-11-23T01:00:00.000Z');
  assert.equal(sql.length, s.parts.length + 2);
  assert.ok(s.parts.length >= 2);
  assert.match(sql[0], /^INSERT INTO command_sources[\s\S]*'agents:001'/);
  assert.match(sql[s.parts.length], /VALUES \('agents',/);
  assert.match(sql.at(-1)!, /^DELETE FROM command_sources WHERE source LIKE 'agents:%' AND source NOT IN \('agents:001'/);
  for (const x of sql) assert.ok(byteLength(x) < STATEMENT_MAX_BYTES, `${byteLength(x)}`);
  assert.match(sql[0], /it''s a '' test/);
  // a part limit that is too big for one statement is refused
  assert.throws(() => buildSql(splitAgents(makeAgents({ n: 40, pad: 3000 }), 'r', 100_000), 'x'), /limit/);
});

// ---------- routing and what the page is allowed to do ----------

test('routing: /command?view=agents is picked by CommandApp; main.tsx is untouched; the page loads its data by API, not from the bundle', () => {
  const src = (f: string): string => readFileSync(join(import.meta.dirname, '../web/src', f), 'utf8');
  const cmd = src('CommandPage.tsx');
  assert.match(cmd, /get\('view'\) === 'agents' \? <AgentsEntry \/>/);
  assert.match(cmd, /href="\/command\?view=agents"/);
  assert.doesNotMatch(src('main.tsx'), /Agents|agents/);
  assert.doesNotMatch(cmd, /from '\.\/AgentsPage/); // only AgentsShell, which lazy()-imports the page
  assert.match(src('AgentsShell.tsx'), /lazy\(\(\) => import\('\.\/AgentsPage\.tsx'\)\)/);
  const page = src('AgentsPage.tsx');
  assert.match(page, /fetch\('\/api\/command\/agents'/);
  assert.doesNotMatch(page, /\.json'|SiteNav|dangerouslySetInnerHTML/);
  const params = (q: string) => new URLSearchParams(q).get('view') === 'agents';
  assert.ok(params('?view=agents') && !params('') && !params('?view=other'));
});

test('no agents data file in the web source tree', () => {
  const dir = join(import.meta.dirname, '../web/src/agents');
  assert.throws(() => readFileSync(join(dir, 'agents.json')), /ENOENT/);
});
