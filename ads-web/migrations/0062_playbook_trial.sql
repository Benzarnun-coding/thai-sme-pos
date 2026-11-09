-- Playbook trial (Benz 2026-11-09): a new playbook can be saved as a draft that has to beat the live one before it is
-- used. The room writes captions with both (same products), judges pick blind, and at 20 decided pairs the draft goes
-- live by itself if it won >= 55% (worker/playbookTrial.ts). trial: running | won | lost | stopped; base_id = the
-- live version it was tested against (NULL = the built-in default); trial_result = {"pairs":n,"wins":n}.
ALTER TABLE playbook_versions ADD COLUMN trial TEXT;
ALTER TABLE playbook_versions ADD COLUMN base_id INTEGER;
ALTER TABLE playbook_versions ADD COLUMN trial_result TEXT;
CREATE INDEX creative_candidates_playbook ON creative_candidates (playbook_id, code, status);
