-- GRIND PLAY cleanup: removes ONLY uploaded video payload rows.
-- It preserves scene/creator shorts, PLAY likes, dislikes, comments, views,
-- earnings, follows, donations, premium requests, accounts, coins and all other data.
-- Review the target count before running the DELETE.

SELECT count(*) AS uploaded_play_video_rows
FROM public.premium_requests
WHERE reason LIKE '__PLAY_VID__:%'
  AND position('"kind":"video"' in reason) > 0;

-- Run this DELETE only after reviewing the count above.
DELETE FROM public.premium_requests
WHERE reason LIKE '__PLAY_VID__:%'
  AND position('"kind":"video"' in reason) > 0;

-- Run separately after the DELETE if you want Postgres to reclaim reusable space:
-- VACUUM (ANALYZE) public.premium_requests;
