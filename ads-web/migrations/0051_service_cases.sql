-- Customer-service cases (Benz 2026-10-20): a customer complains, asks for a refund, or got the wrong item / an item
-- not as pictured → the bot posts to Discord "service ลูกค้า", tags Fear, and the case stays open until someone
-- presses "จัดการจบแล้ว". One open case per customer; the customer's name is only in the Discord message, not here.
CREATE TABLE service_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psid TEXT NOT NULL,
  opened_at TEXT NOT NULL,       -- the customer's message that triggered it
  reason TEXT NOT NULL,          -- ร้องเรียน | ขอคืนเงิน | ส่งผิด/ไม่ตรงปก | ...
  text TEXT,                     -- that message, redacted like chat_messages
  status TEXT NOT NULL,          -- open | done
  channel_id TEXT,
  message_id TEXT,
  closed_by TEXT,
  closed_at TEXT
);
CREATE INDEX service_cases_open ON service_cases (psid, status);
