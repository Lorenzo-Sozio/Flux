-- The visitor chat that was never there (audit rilievo M-06).
--
-- Two tables shipped with the schema and nothing ever wrote to them. The five
-- server actions that could have are gone with this change; searching the whole
-- history of the repository, not one of them was ever called from a page, a widget
-- or a route, and there was no table to keep a message in — the session pointed at
-- a ticket, so the conversation would have been the ticket's.
--
-- Leaving empty tables behind is how `opportunity` survived long enough to
-- constrain orders that had nothing to do with it, so they go.
--
-- ⚠️ The drop is guarded rather than unconditional. Nothing here can look at your
-- database before running, and a statement that cannot be undone should refuse
-- rather than assume: a table with even one row in it stays, and stays readable.
-- Both are checked together because chat_session holds a foreign key into
-- chat_channel, and dropping the second while the first survives would fail.
--
-- Re-running is harmless. Once the tables are gone the exception handler catches
-- the missing table and the block does nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "chat_session" LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM "chat_channel" LIMIT 1) THEN
    DROP TABLE "chat_session";
    DROP TABLE "chat_channel";
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;
