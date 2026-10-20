# ff-grades

A tiny Cloudflare Worker with two jobs for the fantasy app: it lets everyone's "Would they?" trade
grades inform the trade odds for every user, and it holds the link previews for shared Power Ranks. The
site stays static; without this worker (or without `FF_GRADES_URL`) the app behaves exactly as before,
with grades kept in the browser and shared rankings falling back to a plain link.

What it stores: roster ids, the grade, the reason, the model's log-odds, the ask, a price-scale
number, a timestamp and a random per-browser id. No names, usernames or accounts. It runs on
Cloudflare's free tier.

How it keeps count: each browser writes only its own KV key (`c:<league>:<client>`), so there is no
shared counter to corrupt when two people grade at once. A read adds the keys up, and the sums are
cached in KV (`snap:l:<league>` for 10 minutes, `snap:g` for 30), so most reads cost two KV gets.

## Setup

1. Make a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. Install and sign in, from this folder:
   ```
   cd workers/grades
   npm ci
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

### Deploying from GitHub

`.github/workflows/deploy-worker.yml` runs `npx wrangler deploy` whenever a push to main touches
`workers/grades/**` (or by hand: Actions > Deploy shared-link worker > Run workflow). It needs a token:

1. In the Cloudflare dashboard open My Profile > API Tokens > Create Token, and use the "Edit
   Cloudflare Workers" template. Scope it to your account (and, if you like, only this worker).
2. In the GitHub repo go to Settings > Secrets and variables > Actions > Secrets, and add
   `CLOUDFLARE_API_TOKEN` with that token.
3. If the token can see more than one Cloudflare account, also add `CLOUDFLARE_ACCOUNT_ID` (the
   account id is on the right of the dashboard's Workers & Pages page).

The workflow installs from `package-lock.json` (`npm ci`), and wrangler is pinned to an exact version in
`package.json`; to move it, change that version and run `npm install` here to refresh the lockfile.
Without `CLOUDFLARE_API_TOKEN` the workflow skips with a notice instead of failing. The KV namespace
id stays in `wrangler.toml`; the deploy does not create it.

To try it locally: `npx wrangler dev` serves the worker on http://localhost:8787 (with a local KV);
run the app with `NEXT_PUBLIC_FF_GRADES_URL=http://localhost:8787 npm run dev`.

## Endpoints

- `POST /grades` with `{ league, client, grades: [...], remove: [...] }`. Validated, at most 40 KB,
  60 grades a post, 400 per browser per league. One grade per deal per browser: a regrade replaces.
- `GET /prior?league=<id>&client=<id>&v=<price scale>` returns everyone else's lessons: a global
  residual total across leagues, and per team in that league the residual total, count, how many
  browsers marked the manager dormant, players said to be untouchable, and the smallest premium
  balked at. The caller's own grades are left out, so the app never counts them twice.

### Shared Power Rank links

The app uploads a 1200x630 preview card and a few facts about a ranking, and gets back a short link,
`https://<worker>/s/<id>`. Pasted into a message, the link unfurls to the card; opened by a person, it
sends them to `https://sujeff.com/fantasy?league=<id>&season=<year>&reveal=<week>#power`, where the app asks for their
fantasy name (as any visit does) and then opens that week.

- `POST /share` with `multipart/form-data` (`meta` as JSON, `png` as the file) or JSON
  `{ meta, png }` with `png` in base64. `meta` is `{ league, leagueId, week, season, title,
  description, provider, top: [{ rank, name, score, move }] }`. Every field is checked and
  length-capped, the picture must be a PNG of exactly 1200x630 (read from its header) and at most
  400 KB, the request must declare its length (411 without, 413 over the cap) and is read in bounded
  chunks, and a post is limited per IP (6 a minute, 40 an hour). Answers `{ id, url }`. CORS as below.
- `GET /s/<id>`: link-preview bots (iMessage, Slack, Discord, WhatsApp, Telegram, LinkedIn, X...)
  get a page of Open Graph and Twitter tags with no redirect (matched by name: facebookexternalhit,
  Facebot, Twitterbot, Slackbot, Discordbot, WhatsApp, TelegramBot, LinkedInBot, Applebot, and a few
  more); anyone else gets a private, uncached 302 to the app. The
  page also carries a script redirect and an "Open Power Rank" link, and no meta refresh.
- `GET /s/<id>.png`: the card, cached for a year.

Each is stored in KV (`s:<id>` and `s:<id>:png`) for 120 days. The ids are 14 random letters and digits.
These two GET routes are open to any site; everything else keeps the CORS rule below. Each shared
ranking costs two KV writes, so the free tier's 1,000 writes a day is roughly 500 shares (the app
remembers the link it made for an unchanged ranking, so a repeat share costs nothing).

CORS allows only https://sujeff.com and http://localhost (any port). The per-IP rate limit lives in
the isolate's memory, so it is a speed bump and not a hard cap. To get a hard cap, add a Cloudflare
rate limiting rule on the worker's route in the dashboard.

## Free-tier limits

KV's free tier allows 1,000 writes, 1,000 list operations, and 100,000 reads a day.

- A grade post costs one write (plus one read of the browser's own key), so about 1,000 posts a day
  (the app batches changes, so that is more grades than it sounds).
- A cold read rebuilds a snapshot: one list operation per 1,000 browsers for the league and for
  everyone, one get per browser in the league, and one write per snapshot. With the caching that is
  at most about 144 league rebuilds and 48 global rebuilds a day per active league, so list
  operations are the limit to watch: roughly 5 busy leagues a day fits. Idle leagues cost nothing.
- Per request the worker reads at most 30 browsers per league and the first 5,000 browsers overall,
  to stay inside the free plan's 50 subrequests.

## Resetting

Delete the KV namespace in the dashboard (Storage & Databases > KV) and make a new one, or delete
single keys: `c:<league>:<client>`, `snap:l:<league>`, `snap:g`.
