-- GRIND PLAY cleanup: removes ONLY uploaded video payload rows.
-- It preserves scene/creator shorts, PLAY likes, dislikes, comments, views,
-- earnings, follows, donations, premium requests, accounts, coins and all other data.
-- Review the target count before running the DELETE.

SELECT count(*) AS uploaded_play_video_rows
FROM public.premium_requests
WHERE reason LIKE '__PLAY_VID__:%'
  AND CASE
    WHEN substring(reason FROM 14) ~ '^\\s*\\{'
    THEN (substring(reason FROM 14)::jsonb ->> 'kind') = 'video'
    ELSE false
  END;

-- Run this DELETE only after reviewing the count above.
DELETE FROM public.premium_requests
WHERE reason LIKE '__PLAY_VID__:%'
  AND CASE
    WHEN substring(reason FROM 14) ~ '^\\s*\\{'
    THEN (substring(reason FROM 14)::jsonb ->> 'kind') = 'video'
    ELSE false
  END;

-- Run separately after the DELETE if you want Postgres to reclaim reusable space:
-- VACUUM (ANALYZE) public.premium_requests;
