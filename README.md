# My Strava Dashboard

A personal Strava dashboard with no server to run or pay for: a static
site (hosted free on GitHub Pages) showing your stats, a distance-per-week
chart, a map of your routes, and an activity list - kept up to date by a
GitHub Action that runs once a day, refreshes your Strava token, and
commits the latest data into this repo.

This README assumes you're fairly new to GitHub Actions and API tokens,
so it explains a bit more than usual.

## How it fits together

- **`.github/workflows/sync.yml`** - a workflow GitHub runs on a schedule
  (once a day, plus any time you trigger it manually). It's the only
  place that ever talks to Strava or touches your Client Secret.
- **`scripts/refresh-token.js`** and **`scripts/fetch-activities.js`** -
  the two steps that workflow runs: get a fresh access token, then fetch
  any new activities.
- **`docs/`** - the static site itself, published by GitHub Pages.
  `docs/data/activities.json` is the file the Action updates every day;
  the dashboard just reads it with `fetch()`.

Nothing here ever asks you to log in in the browser, because there's no
server behind the site to receive a login. Instead, the Action
authenticates on your behalf using secrets stored in GitHub, which are
encrypted and never visible in logs or to site visitors.

## The one tricky part: refresh tokens rotate

Strava's refresh tokens are single-use - every time one is redeemed for
a new access token, Strava invalidates it and issues a new refresh token
in its place. That means after every sync, the refresh token stored in
GitHub has to be updated, or the *next* run will fail permanently.

To let the workflow update its own secret, it needs a GitHub **personal
access token (PAT)** with permission to manage this repo's secrets - a
separate, narrowly-scoped credential from your Strava keys. Steps 3 and 4
below set that up. It sounds like a lot of moving parts, but you only do
this setup once.

## 1. Get your Strava credentials ready

From [strava.com/settings/api](https://www.strava.com/settings/api) you
need your **Client ID** and **Client Secret**.

You also need a **refresh token** for your own account. If you've
already been through Strava's login/approval flow once (for example, if
you ran an earlier local version of this project and clicked "Connect
with Strava"), use the refresh token currently saved from that - it's
the most recent one, since Strava only invalidates it once it's actually
been redeemed for a new one. If you've never completed that flow, you'll
need to do it once to get an initial refresh token - ask if you'd like a
hand generating one.

## 2. Push this project to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

(Skip whichever of these you've already done.)

## 3. Add your Strava secrets

In your repo on GitHub: **Settings → Secrets and variables → Actions →
New repository secret**. Add three:

| Name | Value |
|---|---|
| `STRAVA_CLIENT_ID` | your Client ID |
| `STRAVA_CLIENT_SECRET` | your Client Secret |
| `STRAVA_REFRESH_TOKEN` | your current refresh token |

These are encrypted at rest and never shown again once saved - if you
ever need to check one, you can only overwrite it, not view it.

## 4. Create a personal access token so the workflow can rotate its own secret

1. GitHub (top-right avatar) → **Settings → Developer settings → Personal
   access tokens → Fine-grained tokens → Generate new token**.
2. Give it a name like `strava-dashboard-secrets`.
3. **Repository access** → "Only select repositories" → pick this repo.
4. Under **Permissions → Repository permissions**, find **Secrets** and
   set it to **Read and write**. Leave everything else as default.
5. Generate the token and copy it immediately - GitHub only shows it once.
6. Back in this repo's secrets (same place as step 3), add a fourth
   secret named `GH_PAT` with that token as the value.

## 5. Turn on GitHub Pages

**Settings → Pages** → under "Build and deployment", set **Source** to
"Deploy from a branch", **Branch** to `main`, folder to `/docs`, then
**Save**. GitHub will give you a URL like
`https://<your-username>.github.io/<repo-name>/` - that's your dashboard.

## 6. Run it

Go to the **Actions** tab, choose **Sync Strava data** on the left, and
click **Run workflow** to trigger the first sync manually rather than
waiting for the schedule. Check the run's logs - if it finishes green,
open your Pages URL and you should see your data. After this, it runs
automatically once a day (05:00 UTC by default - see below to change
that).

## Changing the schedule

Edit the `cron` line in `.github/workflows/sync.yml`. Cron schedules on
GitHub Actions always run in UTC, regardless of where you live. For
example, `cron: '0 5 * * *'` means 05:00 UTC every day. A couple of
things worth knowing:

- GitHub doesn't guarantee the exact minute - scheduled workflows can run
  a few minutes (occasionally longer, during busy periods) after the
  time you set.
- If you want it to line up with a specific local time, convert to UTC
  yourself and remember the UK shifts between GMT and BST across the
  year, so a fixed UTC time will drift by an hour relative to your local
  clock twice a year.

## Rate limits

Strava limits any single app to 200 requests per 15 minutes and 2,000
per day, shared across everything this app does. One sync uses at most a
handful of requests (one to refresh the token, plus one per 100
activities fetched), so a daily schedule stays far under that.

## Project structure

```
strava-dashboard/
├── .github/workflows/
│   └── sync.yml               - the daily Action
├── scripts/
│   ├── refresh-token.js       - gets a fresh access token, rotates the refresh token
│   └── fetch-activities.js    - fetches new activities, updates docs/data/activities.json
├── docs/                      - published by GitHub Pages
│   ├── index.html
│   ├── style.css
│   ├── app.js                 - dashboard logic (stats, chart, map, table)
│   ├── polyline.js            - decodes Strava's route data for the map
│   └── data/
│       └── activities.json    - updated by the Action; the dashboard reads this
└── package.json
```

## Troubleshooting

- **The workflow fails on "Refresh Strava access token"** - double-check
  the three Strava secrets are correct and haven't got extra spaces. If
  it worked before and just started failing, your stored refresh token
  may be out of sync with Strava's - see "The one tricky part" above.
- **The workflow fails on "Rotate the stored refresh token"** - almost
  always means the `GH_PAT` secret is missing, expired, or doesn't have
  "Secrets: Read and write" permission on this repo. Regenerate it (step
  4) and update the secret.
- **Pages shows a 404 or an old version** - GitHub Pages can take a
  minute or two to publish after a commit; also double check Settings →
  Pages is set to the `main` branch, `/docs` folder.
- **The dashboard loads but says "No data yet"** - the workflow hasn't
  produced `docs/data/activities.json` with any activities in it yet;
  check the Actions tab for a successful run.
- **Map is empty for some activities** - indoor activities (treadmill,
  indoor trainer, etc.) have no GPS route, so there's nothing to draw for
  those - that's expected.
