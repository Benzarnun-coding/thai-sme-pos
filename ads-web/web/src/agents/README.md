# Agents data: format and loading (read-only page)

The real positions file is **not in this repo** (it is public). It lives outside git and is loaded into D1 with
`scripts/command-agents-sql.mjs`; the page reads it from `GET /api/command/agents` after the Command login.
Design and decisions: `docs/command-center/agents-design.md` §0. Code: `worker/agentsStore.ts`, `agentsView.ts` (this folder).
All names below are placeholders.

## Shape

```json
{
  "schema_version": 1,
  "updated": "2026-11-10",
  "capacity_target": { "year": 2027, "positions": 300 },
  "departments": [{ "id": "dept-a", "name": "Dept A", "name_th": null, "skilltree_count": 1 }],
  "positions": [
    {
      "id": "dept-a-001", "department": "dept-a", "title": "Example position", "title_th": null,
      "source": "skilltree", "agent": null, "team": null, "status": "vacant", "coverage": null,
      "pk_auto": false, "businesses": [], "evidence": null,
      "proposal": {
        "label": "ข้อเสนอ", "approved": false, "approved_by": null, "approved_on": null,
        "kind": "unassigned", "basis": "suggested-from-title",
        "name": "example-agent", "duty": "...", "inputs": [], "outputs": [], "businesses": [], "team": null,
        "scope": { "draft_only": true, "sends_to_customers": false, "pays_money": false, "notes": null },
        "priority": 1, "priority_reason": "..."
      }
    }
  ]
}
```

- No counters in the file: the page counts the rows itself.
- `status`: `active` | `paused` | `pk-auto` (no agent, only PK JEANS automation) | `vacant`. Unknown = shown as paused and reported.
- `pk_auto: true` also on a row that has an agent when automation covers it too.
- `source`: `skilltree` or another source name; `id` is stable and unique.
- A `vacant` row must have a `proposal`; every proposal is draft-only, sends nothing to customers, pays nothing, and has a unique `priority`.

## "ข้อเสนอ" and approval

A proposal is shown as **ข้อเสนอ** until `isApproved` (agentsView.ts) says otherwise: `approved === true` **and** a non-empty
`approved_by` **and** `approved_on` a real `YYYY-MM-DD` date not in the future. Anything else stays a proposal, and the validator
reports an incomplete `approved: true` as an error. `basis: "suggested-from-title"` adds the badge "ร่างจากชื่อตำแหน่ง" (kept after
approval); any other `basis` adds "มีหลักฐาน". Files of the older shape (only `approved: false`, no `approved_by`, `approved_on`
or `basis`) still load and show as proposals.

## Load (local)

```
node scripts/command-agents-sql.mjs <path/to/agents.json> --check                 # validate, print counters, write nothing
node scripts/command-agents-sql.mjs <path/to/agents.json> --expect total=N,vacant=N  # fail if a counter differs
node scripts/command-agents-sql.mjs <path/to/agents.json>                         # writes .wrangler/command-agents.sql
npx wrangler d1 execute DB --local --file .wrangler/command-agents.sql
```

The script never runs wrangler and never uses `--remote`; the remote load is done by Benz or temperance after approval.
Each SQL statement stays under 90000 bytes (the file is split over rows `agents`, `agents:001`, ...).
