// app.js
//
// This is a static page - there's no server to talk to any more. All
// it does is fetch data/activities.json (a file a GitHub Action updates
// once a day) and render it: stats, a distance-per-week chart, a route
// map, and an activity table.

let allActivities = [];
let map;
let mapLayerGroup;
let chart;
let hasSetInitialFilter = false;

const el = (id) => document.getElementById(id);

async function main() {
  let data;
  try {
    // Cache-bust so you always see the latest committed data, not a
    // stale copy your browser cached from yesterday.
    const res = await fetch(`data/activities.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    data = await res.json();
  } catch (err) {
    showEmptyState();
    return;
  }

  allActivities = data.activities || [];

  if (allActivities.length === 0) {
    showEmptyState(
      'The sync has run, but no activities came back yet - once you have some on Strava, they\'ll show up after the next daily sync.'
    );
    return;
  }

  updateLastSynced(data.lastSyncedAt);
  el('dashboard').classList.remove('hidden');
  populateTypeFilter();
  renderAll();

  el('type-filter').addEventListener('change', renderAll);
}

function showEmptyState(message) {
  el('empty-state').classList.remove('hidden');
  if (message) el('empty-message').textContent = message;
}

function updateLastSynced(timestamp) {
  el('last-synced').textContent = timestamp
    ? `Last synced: ${new Date(timestamp).toLocaleString()}`
    : '';
}

function populateTypeFilter() {
  const select = el('type-filter');
  const previousValue = select.value || 'all';
  const types = Array.from(new Set(allActivities.map((a) => a.type))).sort();

  select.innerHTML = '<option value="all">All</option>' +
    types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

  // The very first time we have data, default to "Run" if there is any -
  // after that, respect whatever the person picked themselves.
  if (!hasSetInitialFilter && types.length > 0) {
    hasSetInitialFilter = true;
    select.value = types.includes('Run') ? 'Run' : previousValue;
    return;
  }

  if (types.includes(previousValue) || previousValue === 'all') {
    select.value = previousValue;
  }
}

function getFilteredActivities() {
  const type = el('type-filter').value;
  if (type === 'all') return allActivities;
  return allActivities.filter((a) => a.type === type);
}

function renderAll() {
  const activities = getFilteredActivities();
  renderStats(activities);
  renderChart(activities);
  renderMap(activities);
  renderTable(activities);
}

function renderStats(activities) {
  const totalDistanceKm = sum(activities, (a) => a.distance) / 1000;
  const totalTimeHours = sum(activities, (a) => a.moving_time) / 3600;
  const totalElevation = sum(activities, (a) => a.total_elevation_gain);

  el('stat-count').textContent = activities.length.toLocaleString();
  el('stat-distance').textContent = totalDistanceKm.toFixed(1);
  el('stat-time').textContent = totalTimeHours.toFixed(1);
  el('stat-elevation').textContent = Math.round(totalElevation).toLocaleString();
}

function sum(items, fn) {
  return items.reduce((acc, item) => acc + (fn(item) || 0), 0);
}

// --- Chart: total distance per week -----------------------------------

function renderChart(activities) {
  const weekly = new Map(); // key: "YYYY-MM-DD" (Monday of that week) -> km

  for (const activity of activities) {
    const monday = mondayOf(new Date(activity.start_date_local || activity.start_date));
    const key = monday.toISOString().slice(0, 10);
    weekly.set(key, (weekly.get(key) || 0) + activity.distance / 1000);
  }

  const sortedWeeks = Array.from(weekly.keys()).sort();
  // Only show the most recent 26 weeks so the chart stays readable.
  const recentWeeks = sortedWeeks.slice(-26);
  const labels = recentWeeks.map((w) => formatWeekLabel(w));
  const values = recentWeeks.map((w) => Math.round(weekly.get(w) * 10) / 10);

  const ctx = el('distance-chart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Distance (km)',
        data: values,
        backgroundColor: '#fc4c02', // Strava orange
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(isoDateString) {
  const d = new Date(isoDateString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- Map: every route overlaid ------------------------------------------

const TYPE_COLORS = {
  Run: '#fc4c02',
  Ride: '#1e90ff',
  Swim: '#00b894',
  Hike: '#8e44ad',
  Walk: '#f0932b',
};

function renderMap(activities) {
  if (!map) {
    map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapLayerGroup = L.layerGroup().addTo(map);
  }

  mapLayerGroup.clearLayers();

  const bounds = [];
  for (const activity of activities) {
    const points = decodePolyline(activity.summary_polyline);
    if (points.length === 0) continue;

    const color = TYPE_COLORS[activity.type] || '#636e72';
    const line = L.polyline(points, { color, weight: 2, opacity: 0.7 });
    line.bindPopup(
      `<strong>${escapeHtml(activity.name)}</strong><br>${(activity.distance / 1000).toFixed(1)} km`
    );
    mapLayerGroup.addLayer(line);
    bounds.push(...points);
  }

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [20, 20] });
  } else {
    // No routes to show (e.g. all activities are indoor/no GPS) -
    // fall back to a reasonable default view.
    map.setView([51.5, -0.12], 5);
  }
}

// --- Activity table -------------------------------------------------------

function renderTable(activities) {
  const rows = activities.slice(0, 100).map((a) => {
    const date = new Date(a.start_date_local || a.start_date).toLocaleDateString();
    const distanceKm = (a.distance / 1000).toFixed(2);
    const time = formatDuration(a.moving_time);
    const paceOrSpeed = formatPaceOrSpeed(a);
    const elevation = Math.round(a.total_elevation_gain || 0);
    return `
      <tr>
        <td>${date}</td>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.type)}</td>
        <td>${distanceKm}</td>
        <td>${time}</td>
        <td>${paceOrSpeed}</td>
        <td>${elevation}</td>
        <td><a href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">View</a></td>
      </tr>`;
  });
  el('activity-rows').innerHTML = rows.join('');
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Running/walking/hiking activities are more useful as pace
// (min per km); everything else (rides, swims, etc.) as speed (km/h).
function formatPaceOrSpeed(activity) {
  const paceTypes = ['Run', 'Walk', 'Hike', 'TrailRun'];
  if (paceTypes.includes(activity.type) && activity.average_speed > 0) {
    const secPerKm = 1000 / activity.average_speed;
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60);
    return `${min}:${String(sec).padStart(2, '0')} /km`;
  }
  const kmh = (activity.average_speed || 0) * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

main().catch((err) => {
  console.error(err);
  showEmptyState('Something went wrong loading the dashboard - check the browser console.');
});
