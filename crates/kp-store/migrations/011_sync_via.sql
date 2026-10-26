-- Which remote a received change came through, so a copy can pass changes on to the
-- other remotes it syncs with (moving from a shared folder to a server, for example)
-- without sending them back where they came from. Empty for changes made here, and for
-- changes received before this column existed.
ALTER TABLE change_log ADD COLUMN via TEXT;
ALTER TABLE sync_pending ADD COLUMN via TEXT;
