// refresh-token.js
//
// Step 1 of the daily sync. Strava refresh tokens are single-use: every
// time you redeem one, Strava hands back a NEW refresh token and
// immediately invalidates the old one. So this script's most important
// job isn't fetching data - it's making sure the new refresh token gets
// saved somewhere before anything else can go wrong. If it didn't, one
// failed run would permanently break every run after it (the stored
// secret would point at a refresh token Strava no longer recognises).
//
// To keep it out of GitHub's logs, the new refresh token is written to
// a local file - NEVER printed with console.log - and the workflow's
// next step reads that file to update the GH_PAT-protected secret.

const fs = require('fs');
const path = require('path');

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;

const NEW_REFRESH_TOKEN_PATH = path.join(__dirname, '.new-refresh-token');
const ACCESS_TOKEN_PATH = path.join(__dirname, '.access-token');

async function main() {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
    throw new Error(
      'Missing one of STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN.'
    );
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    // Deliberately not logging the response body here - it can echo
    // back request details. The HTTP status is enough to diagnose from.
    throw new Error(`Strava token refresh failed with status ${res.status}`);
  }

  const data = await res.json();

  // Written to disk, not stdout - these never appear in the Action's log.
  fs.writeFileSync(NEW_REFRESH_TOKEN_PATH, data.refresh_token, 'utf8');
  fs.writeFileSync(ACCESS_TOKEN_PATH, data.access_token, 'utf8');

  console.log('Refreshed Strava access token successfully.');
}

main().catch((err) => {
  console.error('Refresh failed:', err.message);
  process.exit(1);
});
