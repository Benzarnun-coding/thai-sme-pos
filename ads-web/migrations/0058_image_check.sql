-- ห้องฝึก: Claude's look at each image (JSON: product match, readable text, style match, looks fake, verdict),
-- compared with the real product photo and the style card's references. Shown after the judges vote.
ALTER TABLE creative_candidates ADD COLUMN ai_check TEXT;
