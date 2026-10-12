-- Indexes for the lookups that join Page365 orders to ad chats (a missing one used up D1's daily reads).
CREATE INDEX IF NOT EXISTS p365_orders_name_hash ON p365_orders (name_hash, created_at);
CREATE INDEX IF NOT EXISTS ad_referrals_name_hash ON ad_referrals (name_hash, at);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
