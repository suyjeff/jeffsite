# ff-grades

A tiny Cloudflare Worker that lets everyone's "Would they?" trade grades inform the trade odds for
every user. The site stays static; without this worker (or without `FF_GRADES_URL`) the app behaves
exactly as before, with grades kept in the browser.

What it stores: roster ids, the grade, the reason, the model's log-odds, the ask, a price-scale
number, a timestamp and a random per-browser id. No names, usernames or accounts. It runs on
Cloudflare's free tier (KV free tier allows 1,000 writes a day, about 330 grades a day, since each
grade writes three keys; reads are 100,000 a day).

## Setup

1. Make a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. Install and sign in, from this folder:
   ```
   cd workers/grades
   npm install
   npx wrangler login
   ```
3. Create the KV namespace:
   ```
   npx wrangler kv namespace create GRADES
   ```
   It prints an `id`. Paste it into `wrangler.toml` in place of `REPLACE_WITH_KV_ID`.
4. Deploy:
   ```
   npx wrangler deploy
   ```
   It prints a URL like `https://ff-grades.<your-subdomain>.workers.dev`. Copy it (no trailing slash).
5. In the GitHub repo, go to Settings > Secrets and variables > Actions > Variables, and add a
   repository variable named `FF_GRADES_URL` with that URL.
6. Re-run the deploy workflow (Actions > Deploy to GitHub Pages > Run workflow, or push to main) so
   the build picks the variable up.

To try it locally: `npx wrangler dev` serves the worker on http://localhost:8787 (with a local KV);
run the app with `NEXT_PUBLIC_FF_GRADES_URL=http://localhost:8787 npm run dev`.

## Endpoints

- `POST /grades` with `{ league, client, grades: [...], remove: [...] }`. Validated, at most 40 KB,
  60 grades a post, 400 per browser per league. One grade per deal per browser: a regrade replaces.
- `GET /prior?league=<id>&client=<id>&v=<price scale>` returns everyone else's lessons: a global
  residual total across leagues, and per team in that league the residual total, count, how many
  browsers marked the manager dormant, players said to be untouchable, and the smallest premium
  balked at. The caller's own grades are left out, so the app never counts them twice.

CORS allows only https://sujeff.com and http://localhost (any port). The per-IP rate limit lives in
the isolate's memory, so it is a speed bump and not a hard cap. To get a hard cap, add a Cloudflare
rate limiting rule on the worker's route in the dashboard.

## Resetting

Delete the KV namespace in the dashboard (Storage & Databases > KV) and make a new one, or delete
single keys: `c:<league>:<client>`, `l:<league>`, `g`.
