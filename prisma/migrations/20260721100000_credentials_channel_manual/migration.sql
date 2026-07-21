-- P1-3 (truth-in-UI): the admin "Send credentials" button never dispatched
-- anything — it only stamped credentialsSentAt/credentialsChannel while the UI
-- claimed an email went out. The action is now "Mark as delivered": the admin
-- hands credentials over out-of-band and records the fact. MANUAL is the honest
-- channel value for that record; EMAIL/TELEGRAM/BOTH stay reserved for a future
-- real dispatch pipeline (Stage-1.5 decision: creds delivery deferred).
ALTER TYPE "CredentialsChannel" ADD VALUE 'MANUAL';
