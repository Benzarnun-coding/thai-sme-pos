-- ห้องฝึก (creative training room, docs/creative.md): materials the staff give the caption/image agents, what the
-- agents produce, and the staff's A/B judgements. Nothing here reaches Meta.

-- Style cards: a named look with reference pictures (staff's own ChatGPT results they liked, competitors' posts).
CREATE TABLE style_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',          -- "what we like about it", 1–2 lines
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Reference pictures of a style card (resized in the browser, ~100 KB each, at most a handful per card).
CREATE TABLE style_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES style_cards(id) ON DELETE CASCADE,
  thumb BLOB NOT NULL,
  full BLOB NOT NULL,
  mime TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX style_refs_card ON style_refs(card_id);

-- Caption examples the team likes or dislikes; the reason is required (a bare example teaches nothing).
CREATE TABLE caption_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  liked INTEGER NOT NULL,                 -- 1 like, 0 dislike
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Per product (catalog code): selling points and the promo wording the agents may use.
CREATE TABLE product_notes (
  code TEXT PRIMARY KEY,
  selling_points TEXT NOT NULL DEFAULT '',
  promo TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The playbook (brand voice, banned / required phrases): every version kept, the latest approved one is used.
CREATE TABLE playbook_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL
);

-- What the agents (or staff, for images made in ChatGPT) produced.
CREATE TABLE creative_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                     -- caption | image
  code TEXT NOT NULL,                     -- catalog product code
  product_name TEXT NOT NULL DEFAULT '',
  promo TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',          -- caption: price | promo_math | durability | sizes | review | scarcity | lifestyle | problem
  style_id INTEGER,                       -- image: style card
  text TEXT,                              -- caption text
  thumb BLOB, full BLOB, mime TEXT,       -- image
  prompt TEXT NOT NULL DEFAULT '',        -- what the agent / staff were asked
  playbook_id INTEGER,
  batch TEXT NOT NULL,                    -- one generation = one batch id
  created_by TEXT NOT NULL,               -- 'ai' or the staff email
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'     -- open | approved | rejected
);
CREATE INDEX creative_candidates_code ON creative_candidates(kind, code, status);

-- One A/B judgement: which of two candidates of the same kind and product won, why, and an optional edit.
CREATE TABLE creative_judgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  winner_id INTEGER,                      -- NULL = both bad
  reason TEXT NOT NULL DEFAULT '',
  edited_text TEXT,                       -- caption: the judge's own version of the winner (gold)
  judge TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX creative_judgements_pair ON creative_judgements(a_id, b_id);
