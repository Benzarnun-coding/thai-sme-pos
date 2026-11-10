-- The 3-hourly look at each running "(Grok)" ad (worker/grokLoop.ts): JSON {at, action graduate|stop|wait, why, spend,
-- real_orders, real_value, meta_purchases}. With studio_ads.review = 'dry' it is only shown; 'on' acts on it.
ALTER TABLE grok_ads ADD COLUMN review TEXT;
