-- ห้องฝึก: a playbook version can be a proposal (approved_by NULL) with the findings behind it (AI's read of the
-- posts running as ads, Benz 2026-10-22).
ALTER TABLE playbook_versions ADD COLUMN note TEXT;
