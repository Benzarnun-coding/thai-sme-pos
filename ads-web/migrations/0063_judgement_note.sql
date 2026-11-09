-- The AI judge's one-line reason per pair (Benz 2026-11-09): "อีกอันดีกว่าเฉยๆ" told Grok nothing about why a draft
-- lost. Shown with the last playbook trial's result on /studio (worker/playbookTrial.ts lastTrial).
ALTER TABLE creative_judgements ADD COLUMN note TEXT;
