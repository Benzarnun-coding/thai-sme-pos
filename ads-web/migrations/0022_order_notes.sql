-- The admins' order note in the chat ("501/1/2 32 / cod 449"), read from the page's own Messenger messages
-- (echoes). Phase 0 of filling Page365 orders automatically: compared with the Page365 export, nothing written
-- back. Only messages that are nothing but an order note are kept — no names, addresses or other chat text.
CREATE TABLE order_notes (
  mid TEXT PRIMARY KEY,        -- Messenger message id
  psid TEXT NOT NULL,          -- the customer the page was writing to
  at TEXT NOT NULL,            -- ISO
  text TEXT NOT NULL,          -- the note as typed
  name_hash TEXT               -- same salted hash as p365_orders.name_hash, to find the order it became
);
CREATE INDEX order_notes_at ON order_notes (at);
