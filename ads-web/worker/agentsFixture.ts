// Made-up agents data for tests (worker/agents.test.ts, command.test.ts). Every title, name and agent is a placeholder;
// nothing here is copied from the team's real file, which never goes into the repo.

const DEPTS = [{ id: 'sales', name: 'Dept One', name_th: null }, { id: 'ops-x', name: 'Dept Two', name_th: null }, { id: 'new-dept', name: 'Dept Three', name_th: null }];
const STATUSES = ['active', 'paused', 'pk-auto', 'vacant'] as const;

export interface FixtureOpts {
  /** rows */ n?: number;
  /** proposals 1..evidenced have basis 'gap-report-v2', the rest 'suggested-from-title' */ evidenced?: number;
  /** extra characters in each proposal duty, to make the file big */ pad?: number;
}

/** Row i: status cycles active, paused, pk-auto, vacant. Vacant rows (and every 8th other row) carry a proposal; priority = 1, 2, 3 ... in row order. */
export function makeAgents({ n = 24, evidenced = 3, pad = 0 }: FixtureOpts = {}) {
  let next = 0;
  const positions = Array.from({ length: n }, (_, i) => {
    const status = STATUSES[i % 4];
    const dept = DEPTS[i % 3];
    const hasProposal = status === 'vacant' || i % 8 === 1;
    const priority = hasProposal ? ++next : 0;
    return {
      id: `${dept.id}-${String(i + 1).padStart(3, '0')}`, department: dept.id, title: `[ตัวอย่าง] ตำแหน่ง ${i + 1}`, title_th: null, source: 'skilltree',
      agent: status === 'active' || status === 'paused' ? `agent-${i + 1}` : null, team: status === 'vacant' ? null : 'ทีม ตัวอย่าง',
      status, coverage: null, pk_auto: status === 'pk-auto', businesses: ['ธุรกิจ ตัวอย่าง'], evidence: null,
      proposal: hasProposal ? {
        label: 'ข้อเสนอ', approved: false, kind: 'unassigned', name: `proposal-${i + 1}`, duty: `[ตัวอย่าง] หน้าที่ ${i + 1}${'ก'.repeat(pad)}`,
        businesses: [], inputs: ['input-x'], outputs: ['output-y'], team: null, priority, priority_reason: 'ตัวอย่าง',
        basis: priority <= evidenced ? 'gap-report-v2' : 'suggested-from-title',
        scope: { draft_only: true, sends_to_customers: false, pays_money: false, notes: null },
      } : null,
    };
  });
  return {
    schema_version: 1, updated: '2026-11-10', capacity_target: { year: 2027, positions: 300 }, goal_note: 'ตัวอย่าง',
    departments: DEPTS.map((d) => ({ ...d, skilltree_count: positions.filter((p) => p.department === d.id).length })),
    positions,
  };
}
