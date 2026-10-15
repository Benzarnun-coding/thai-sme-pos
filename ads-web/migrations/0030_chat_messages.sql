-- Chat text for learning what sells (Benz + Max agreed 2026-10-15): every Messenger message the webhook sees
-- (customer messages and the page's replies), with phone numbers, e-mails, long numbers and addresses removed
-- before storage, no names, kept 30 days. Linked to ads through ad_referrals.psid and to orders through order_notes.
CREATE TABLE chat_messages (
  mid TEXT PRIMARY KEY,          -- Messenger message id
  psid TEXT NOT NULL,            -- the customer (page-scoped id)
  at TEXT NOT NULL,              -- ISO
  from_page INTEGER NOT NULL,    -- 1 = the page (admin or app), 0 = the customer
  text TEXT,                     -- redacted text, null for attachment-only messages
  attachments TEXT               -- attachment types, e.g. "image,image"
);
CREATE INDEX chat_messages_psid ON chat_messages (psid, at);
CREATE INDEX chat_messages_at ON chat_messages (at);
