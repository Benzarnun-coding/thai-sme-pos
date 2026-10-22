-- ห้องภาพเรียนรู้ (docs/creative.md): what each picture shows, as tags from a fixed list (who wears it, text on it,
-- background, …), on the posts running as ads and on the room's images. JSON {dimension: value}.
ALTER TABLE meta_posts ADD COLUMN tags TEXT;
ALTER TABLE creative_candidates ADD COLUMN tags TEXT;
