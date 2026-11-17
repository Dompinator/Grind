# GRIND PLAY video storage setup

This change moves uploaded PLAY video binaries out of Postgres and into the
repository's `PLAY/` directory. The PLAY metadata row remains in
`premium_requests`; votes, comments, views, donations, follows, and earnings
remain in Supabase exactly as before.

## 1. GitHub token (keep it secret)

Create a fine-grained GitHub token scoped only to the `Dompinator/Grind`
repository, with **Contents: Read and write** permission.

Never put the token in `app.js`, `index.html`, GitHub Pages, or any public
repository file. Do not send the token in chat.

## 2. Supabase Edge Function secrets

Set these secrets in the Supabase project's Edge Function secrets:

- `GITHUB_TOKEN`: the fine-grained token
- `GITHUB_OWNER`: `Dompinator`
- `GITHUB_REPO`: `Grind`
- `GITHUB_BRANCH`: `main` (for production)

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not expose the service-role
key in the browser.

## 3. Deploy the function

From the repository root, deploy:

```sh
supabase functions deploy play-video-storage
```

The function requires a signed-in Supabase user. It accepts compressed MP4 or
WebM payloads up to 3 MB and writes them beneath `PLAY/<user-id>/` in this
repository. The browser re-encodes uploads with a maximum dimension of 340 px.

## 4. Remove old uploaded video payloads (optional, destructive to PLAY videos)

The migration file
`supabase/migrations/20261117000100_remove_legacy_play_video_payloads.sql`
contains a count query followed by a narrowly scoped DELETE.

Review the count first. Only run the DELETE if the count matches the uploaded
PLAY videos you intend to discard. It deletes rows whose reason starts with
`__PLAY_VID__:` and whose JSON `kind` is `video`.

It does **not** delete premium requests, scene-based PLAY shorts, PLAY votes,
comments, view records, donations, follows, user profiles, accounts, coins,
trades, or any other table rows.

The deletion is irreversible unless you have a database backup. Do not run
the DELETE until the new Edge Function has been deployed and tested.

## Important

- This repository branch is a code change only; it does not deploy the Edge
  Function or change Supabase secrets automatically.
- Existing legacy videos remain in Postgres until the optional SQL cleanup is
  run. New uploads will use GitHub only after the function is deployed and the
  app version containing this change is deployed.
- GitHub raw URLs serve the stored video files. A GitHub repository is not a
  dedicated video CDN; keep the 340p/3 MB limits and monitor repository growth.
