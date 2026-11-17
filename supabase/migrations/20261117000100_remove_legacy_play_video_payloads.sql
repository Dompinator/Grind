-- GRIND PLAY cleanup.
-- Deletes ONLY uploaded PLAY video metadata rows that contain the legacy Base64
-- video payload. It intentionally preserves scene-based shorts and every other
-- PLAY interaction record (votes, comments, views, donations, follows, earnings).
-- It does not touch any other table.
DELETE FROM public.premium_requests
WHERE left(reason, 13) = '__PLAY_VID__:'
  AND position('"kind":"video"' in reason) > 0;
