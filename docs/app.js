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
let yearChart;
let latestRunMap;
let latestRunLayerGroup;
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
  populateYearFilter();
  renderAll();
  loadLatestRun();

  el('type-filter').addEventListener('change', renderAll);
  el('year-filter').addEventListener('change', renderAll);
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

function populateYearFilter() {
  const select = el('year-filter');
  const previousValue = select.value || 'all';
  // Newest first, matching how a year picker is normally ordered.
  const years = Array.from(new Set(allActivities.map(yearOf))).sort((a, b) => b - a);

  select.innerHTML = '<option value="all">All</option>' +
    years.map((y) => `<option value="${y}">${y}</option>`).join('');

  if (years.includes(Number(previousValue)) || previousValue === 'all') {
    select.value = previousValue;
  }
}

function yearOf(activity) {
  return new Date(activity.start_date_local || activity.start_date).getFullYear();
}

function getTypeFilteredActivities() {
  const type = el('type-filter').value;
  if (type === 'all') return allActivities;
  return allActivities.filter((a) => a.type === type);
}

function getFilteredActivities() {
  const typeFiltered = getTypeFilteredActivities();
  const year = el('year-filter').value;
  if (year === 'all') return typeFiltered;
  return typeFiltered.filter((a) => yearOf(a) === Number(year));
}

function renderAll() {
  const typeFiltered = getTypeFilteredActivities();
  const activities = getFilteredActivities();
  const yearValue = el('year-filter').value;
  const selectedYear = yearValue === 'all' ? null : Number(yearValue);

  renderStats(activities);
  renderWeeklyChart(activities, selectedYear);
  renderYearChart(typeFiltered);
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

// With no year selected: the trailing 26 weeks, ending this week. With a
// year selected: every week of that year, so the chart matches what
// you're actually filtered to instead of showing an unrelated window.
function renderWeeklyChart(activities, year) {
  const weekly = new Map(); // key: "YYYY-MM-DD" (Monday of that week) -> km

  for (const activity of activities) {
    const monday = mondayOf(new Date(activity.start_date_local || activity.start_date));
    const key = monday.toISOString().slice(0, 10);
    weekly.set(key, (weekly.get(key) || 0) + activity.distance / 1000);
  }

  const weeks = year ? weeksOfYear(year) : trailingWeeks(26);
  const labels = weeks.map((w) => formatWeekLabel(w));
  const values = weeks.map((w) => Math.round((weekly.get(w) || 0) * 10) / 10);

  el('weekly-chart-title').textContent = year
    ? `Distance per week - ${year} (km)`
    : 'Distance per week (km)';

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

// A continuous run of `n` weeks (Mondays), ending with the current week.
function trailingWeeks(n) {
  const thisMonday = mondayOf(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - i * 7);
    weeks.push(monday.toISOString().slice(0, 10));
  }
  return weeks;
}

// Every week (Monday) that falls in the given calendar year. For the
// current year this stops at this week, rather than running into weeks
// that haven't happened yet.
function weeksOfYear(year) {
  const janFirstMonday = mondayOf(new Date(year, 0, 1));
  const isCurrentYear = year === new Date().getFullYear();
  const endMonday = isCurrentYear ? mondayOf(new Date()) : mondayOf(new Date(year, 11, 31));

  const weeks = [];
  const cursor = new Date(janFirstMonday);
  while (cursor <= endMonday) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
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

// --- Chart: total distance per year -------------------------------------

// Always shows every year (not affected by the year filter, since the
// whole point is comparing years against each other) for whatever
// activity type is currently selected. Years with no activity at all
// still get a 0 km bar, same reasoning as the weekly chart.
function renderYearChart(activities) {
  const yearly = new Map(); // key: year (number) -> km

  for (const activity of activities) {
    const y = yearOf(activity);
    yearly.set(y, (yearly.get(y) || 0) + activity.distance / 1000);
  }

  const canvas = el('year-chart');
  if (yearly.size === 0) {
    if (yearChart) {
      yearChart.destroy();
      yearChart = null;
    }
    return;
  }

  const yearsPresent = Array.from(yearly.keys());
  const minYear = Math.min(...yearsPresent);
  const maxYear = Math.max(new Date().getFullYear(), ...yearsPresent);

  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  const labels = years.map(String);
  const values = years.map((y) => Math.round((yearly.get(y) || 0) * 10) / 10);

  const ctx = canvas.getContext('2d');
  if (yearChart) yearChart.destroy();
  yearChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Distance (km)',
        data: values,
        backgroundColor: '#fc4c02', // same metric as the weekly chart, same color
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
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

// --- Latest run: map coloured by pace, plus its own stats -----------------

// Fastest -> slowest. A standard "traffic light" ramp (green through red)
// is the convention runners expect from pace-zone maps, computed relative
// to this run's own pace range rather than a fixed target you'd have to
// configure.
const PACE_ZONE_COLORS = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];

async function loadLatestRun() {
  try {
    const res = await fetch(`data/latest-run.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    renderLatestRun(data);
  } catch (err) {
    // Nothing synced yet, or the file doesn't exist - just show the
    // empty message rather than treating it as a hard error.
    el('latest-run-empty').classList.remove('hidden');
  }
}

function renderLatestRun(data) {
  const activity = data && data.activity;
  const streams = data && data.streams;

  if (!activity || !streams || !streams.latlng || streams.latlng.length === 0) {
    el('latest-run-empty').classList.remove('hidden');
    return;
  }

  el('latest-run-body').classList.remove('hidden');
  el('latest-run-name').textContent = activity.name;
  el('latest-run-date').textContent = new Date(
    activity.start_date_local || activity.start_date
  ).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  el('latest-run-link').href = `https://www.strava.com/activities/${activity.id}`;

  renderLatestRunStats(activity);
  renderLatestRunMap(streams);
}

function renderLatestRunStats(activity) {
  const cards = [
    { value: (activity.distance / 1000).toFixed(2), label: 'Distance (km)' },
    { value: formatDuration(activity.moving_time), label: 'Moving time' },
    { value: formatPaceOrSpeed(activity), label: 'Avg pace' },
    { value: Math.round(activity.total_elevation_gain || 0), label: 'Elevation (m)' },
  ];
  if (activity.average_heartrate) {
    cards.push({ value: Math.round(activity.average_heartrate), label: 'Avg HR (bpm)' });
  }
  if (activity.max_heartrate) {
    cards.push({ value: Math.round(activity.max_heartrate), label: 'Max HR (bpm)' });
  }

  el('latest-run-stats').innerHTML = cards
    .map(
      (c) => `
      <div class="stat-card">
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>`
    )
    .join('');
}

function renderLatestRunMap(streams) {
  const latlng = streams.latlng;
  const distance = streams.distance;
  const time = streams.time;

  if (!latestRunMap) {
    latestRunMap = L.map('latest-run-map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(latestRunMap);
    latestRunLayerGroup = L.layerGroup().addTo(latestRunMap);
  }
  latestRunLayerGroup.clearLayers();

  // Pace (seconds per km) for the segment between each pair of
  // consecutive points, where we have both a distance and time stream.
  const segmentPaces = [];
  for (let i = 1; i < latlng.length; i++) {
    let pace = null;
    if (distance && time && distance[i] != null && distance[i - 1] != null && time[i] != null && time[i - 1] != null) {
      const dDist = distance[i] - distance[i - 1];
      const dTime = time[i] - time[i - 1];
      if (dDist > 0 && dTime > 0) pace = dTime / (dDist / 1000);
    }
    segmentPaces.push(pace);
  }

  // Zone edges come from this run's own pace distribution (5th-95th
  // percentile, so a GPS blip or a traffic-light stop doesn't stretch
  // the scale), split into 5 equal-width bands from fastest to slowest.
  const validPaces = segmentPaces.filter((p) => p != null && p > 0 && p < 1200).sort((a, b) => a - b);
  const zoneEdges = validPaces.length > 0 ? paceZoneEdges(validPaces) : null;

  const bounds = [];
  for (let i = 1; i < latlng.length; i++) {
    const pace = segmentPaces[i - 1];
    const color = zoneEdges && pace != null ? PACE_ZONE_COLORS[paceZoneIndex(pace, zoneEdges)] : '#636e72';
    latestRunLayerGroup.addLayer(
      L.polyline([latlng[i - 1], latlng[i]], { color, weight: 4, opacity: 0.85 })
    );
  }
  bounds.push(...latlng);

  if (bounds.length > 0) {
    latestRunMap.fitBounds(bounds, { padding: [20, 20] });
  }

  renderPaceLegend(zoneEdges);
}

function paceZoneEdges(sortedPaces) {
  const p5 = percentile(sortedPaces, 0.05);
  const p95 = percentile(sortedPaces, 0.95);
  const span = Math.max(p95 - p5, 1);
  const edges = [0, 1, 2, 3, 4].map((i) => p5 + (span * i) / 5);
  edges.push(p5 + span);
  return edges; // 6 edges bounding 5 zones
}

function paceZoneIndex(pace, edges) {
  for (let i = 0; i < 5; i++) {
    if (pace <= edges[i + 1]) return i;
  }
  return 4;
}

function percentile(sortedArr, p) {
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function renderPaceLegend(zoneEdges) {
  const legend = el('pace-legend');
  if (!zoneEdges) {
    legend.innerHTML = '';
    return;
  }

  const items = [];
  for (let i = 0; i < 5; i++) {
    items.push(`
      <span class="pace-legend-item">
        <span class="pace-legend-swatch" style="background:${PACE_ZONE_COLORS[i]}"></span>
        ${formatPaceSec(zoneEdges[i])}–${formatPaceSec(zoneEdges[i + 1])} /km
      </span>`);
  }
  legend.innerHTML = '<span>Pace:</span>' + items.join('');
}

function formatPaceSec(secPerKm) {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
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
