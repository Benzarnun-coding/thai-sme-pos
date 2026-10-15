-- Order notes in the chat name products by code ("501/1", "Ni9-3"); look them up without scanning 17k rows.
CREATE INDEX catalog_code ON catalog (code COLLATE NOCASE, size);
CREATE INDEX catalog_web_code ON catalog_web (code COLLATE NOCASE, size);
