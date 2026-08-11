-- Client ids drop one padding zero: USR-00001 → USR-0001 (owner 2026-08-11).
-- Admin ids (ADM-001 / ADM-SYS) are a different scheme and are untouched.
--
-- Every FK into users(id) is ON UPDATE CASCADE (orders, payments, invoices,
-- notifications, tickets, ticket_replies, entity_notes.authorId, logs.actorId,
-- balance_ledger, payment_methods, proxy_whitelist.addedBy, checkout_drafts,
-- password_reset_tokens, email_verification_tokens), so child rows follow the
-- rename by themselves. Only the POLYMORPHIC columns — which store a user id
-- as plain text with no FK — have to be rewritten by hand, below.
--
-- The `^USR-0[0-9]{4}$` guard makes this idempotent-by-shape: a row already at
-- 4 digits does not match, and no 4-digit id can collide with a 5-digit one.

UPDATE "users"
   SET "id" = 'USR-' || substring("id" from 6)
 WHERE "id" ~ '^USR-0[0-9]{4}$';

-- Audit log + notes point at clients by plain id (objectType CLIENT, and AUTH
-- rows whose objectId is the account that signed up / reset a password).
UPDATE "logs"
   SET "objectId" = 'USR-' || substring("objectId" from 6)
 WHERE "objectType" IN ('CLIENT', 'AUTH')
   AND "objectId" ~ '^USR-0[0-9]{4}$';

UPDATE "entity_notes"
   SET "objectId" = 'USR-' || substring("objectId" from 6)
 WHERE "objectType" = 'CLIENT'
   AND "objectId" ~ '^USR-0[0-9]{4}$';

-- Log prose names the client inline ("Order created via client portal · Demo
-- User (USR-00001)"). Left alone it would read as a dead id next to the renamed
-- row it describes. Word-anchored so a longer id can never be half-rewritten.
UPDATE "logs"
   SET "detail" = regexp_replace("detail", '\mUSR-0([0-9]{4})\M', 'USR-\1', 'g')
 WHERE "detail" ~ '\mUSR-0[0-9]{4}\M';
