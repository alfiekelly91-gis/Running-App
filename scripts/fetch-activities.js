// fetch-activities.js
//
// Step 3 of the daily sync (after refresh-token.js, and after the
// workflow has rotated the refresh token secret). Reads the access
// token that refresh-token.js stashed on disk, asks Strava for
// anything new since the last run, and merges it into
// docs/data/activities.json - the file the static dashboard reads.

const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN_PATH = path.join(__dirname, '.access-token');
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'activities.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    return { activities: [], lastSyncedAt: null };
  }
}

// Strava's activity objects have far more fields than the dashboard
// needs - keep the cache file small and readable by only storing these.
function pickFields(activity) {
  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    sport_type: activity.sport_type,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    start_date: activity.start_date,
    start_date_local: activity.start_date_local,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_heartrate: activity.average_heartrate ?? null,
    max_heartrate: activity.max_heartrate ?? null,
    kudos_count: activity.kudos_count,
    summary_polyline: activity.map ? activity.map.summary_polyline : null,
    start_latlng: activity.start_latlng || null,
  };
}

async function fetchNewActivities(accessToken, after) {
  const results = [];
  let page = 1;
  const perPage = 100;

  // Cap at 50 pages (5000 activities) per run as a sanity limit.
  while (page <= 50) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after) params.set('after', String(after));

    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429) {
      throw new Error('Rate limited by Strava - the next scheduled run will pick up where this left off.');
    }
    if (!res.ok) {
      throw new Error(`Activities request failed with status ${res.status}`);
    }

    const batch = await res.json();
    results.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return results;
}

async function main() {
  const accessToken = fs.readFileSync(ACCESS_TOKEN_PATH, 'utf8').trim();
  const cache = readCache();

  // Look a couple of hours further back than the last sync, in case an
  // activity was still uploading/processing on Strava's side last time.
  const SAFETY_BUFFER_SECONDS = 2 * 60 * 60;
  const after = cache.lastSyncedAt
    ? Math.floor(cache.lastSyncedAt / 1000) - SAFETY_BUFFER_SECONDS
    : undefined;

  const fetched = await fetchNewActivities(accessToken, after);

  const existingById = new Map(cache.activities.map((a) => [a.id, a]));
  for (const activity of fetched) {
    existingById.set(activity.id, pickFields(activity));
  }

  const activities = Array.from(existingById.values()).sort(
    (a, b) => new Date(b.start_date) - new Date(a.start_date)
  );

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(
    DATA_PATH,
    JSON.stringify({ activities, lastSyncedAt: Date.now() }, null, 2)
  );

  console.log(`Fetched ${fetched.length} activities from Strava; ${activities.length} total cached.`);
}

main().catch((err) => {
  console.error('Fetch failed:', err.message);
  process.exit(1);
});
