-- Which app wrote a page message (Messenger echo app_id): tells the admins (Page365 / Meta inbox) apart from
-- Meta's Business AI, so the nightly read can judge the bot's answers on their own.
ALTER TABLE chat_messages ADD COLUMN sender_app TEXT;
