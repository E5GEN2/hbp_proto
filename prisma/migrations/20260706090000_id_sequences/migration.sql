-- Race-free ID allocation (audit B-5): Postgres sequences replace the
-- table-scan max+1 pattern for the kinds that stay sequential. Each sequence
-- starts from the current maximum numeric suffix so numbering continues
-- seamlessly. (ORD-/PAY- switch to random ids in code — no sequence.)
CREATE SEQUENCE IF NOT EXISTS "invoice_id_seq";
CREATE SEQUENCE IF NOT EXISTS "user_id_seq";
CREATE SEQUENCE IF NOT EXISTS "proxy_id_seq";
CREATE SEQUENCE IF NOT EXISTS "assignment_id_seq";
CREATE SEQUENCE IF NOT EXISTS "ticket_id_seq";

SELECT setval('invoice_id_seq',    GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint), 0) FROM "invoices"), 1));
SELECT setval('user_id_seq',       GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint), 0) FROM "users"), 1));
SELECT setval('proxy_id_seq',      GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint), 0) FROM "proxies"), 1));
SELECT setval('assignment_id_seq', GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint), 0) FROM "assignments"), 1));
SELECT setval('ticket_id_seq',     GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint), 0) FROM "tickets"), 1));
