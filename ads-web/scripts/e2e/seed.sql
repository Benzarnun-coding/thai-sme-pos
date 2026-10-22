-- Made-up data for the browser check (scripts/e2e/run.mjs): a few catalog rows and two posts. Local D1 only.
INSERT OR REPLACE INTO catalog (tab, sku, pos, spu, code, name, size, price) VALUES
 ('PK','801-BL-30',1,'801-BL','801','ยีนส์กระบอกเล็กผ้ายืด สีบลู','30',189),
 ('PK','801-BL-32',2,'801-BL','801','ยีนส์กระบอกเล็กผ้ายืด สีบลู','32',189),
 ('PK','5011-BK-30',3,'5011-BK','5011','ยีนส์ขาตรง REV สีดำ','30',369);
INSERT OR REPLACE INTO settings (key, value) VALUES ('catalog_version', 'e2e');
INSERT OR REPLACE INTO meta_posts (key, story_id, message, post_read, ads, spend, impressions, purchases, purchase_value, messages, code, active, first_seen, fetched_at, tags) VALUES
 ('p1','p1','ยีนส์กระบอก 801 1 ตัว 189 3 ตัว 549',1,'[{"ad_id":"a1","ad_name":"a1","campaign_id":"c1","campaign_name":"โพสผี : 801 1 ตัว 189"}]',2500,50000,40,9000,120,'801',1,'2026-10-22','2026-10-22','{"subject":"worn","text":"price_big"}'),
 ('p2','p2','REV 5011 ขาตรง 369',1,'[{"ad_id":"a2","ad_name":"a2","campaign_id":"c2","campaign_name":"REV 5011"}]',1800,30000,10,3600,60,'',1,'2026-10-22','2026-10-22',NULL);
