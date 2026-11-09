import { computeStats, CONTINENTS, MONTHS, formatWhen, formatYears, visitKey, distanceKm, WORLD_COUNTRIES } from './stats.js';
import { encodeShare, decodeShare } from './share.js';

const STORAGE_KEY = 'travelmap.v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Math.round(n).toLocaleString();

// ---------- State ----------
let cities = [];          // [{id,name,admin,cc,lat,lon,pop,norm}]
const cityById = new Map();
let countries = {};       // cc -> [name, continent]
let data = { homes: [], visits: [] }; // homes: {id, cityId, from, to}  visits: {id, cityId, y, m}
let readOnly = false;
let filter = { from: null, to: null };
let map, countryLayer, pinLayer, homeLayer, tempMarker;

const countryName = (cc) => (countries[cc] ? countries[cc][0] : cc);
const cityLabel = (c) => `${c.name}, ${countryName(c.cc)}`;
const cityLabelLong = (c) => (c.admin && c.admin !== c.name ? `${c.name}, ${c.admin}, ${countryName(c.cc)}` : cityLabel(c));
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// ---------- Storage ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.visits)) {
        addPlaces(d.places);
        data = { homes: migrateHomes(d), visits: d.visits };
      }
    }
  } catch { /* storage unavailable: start empty */ }
}
function save() {
  if (readOnly) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...data, places: usedPlaces() }));
  } catch {
    toast("Couldn't save in this browser. Download a backup to keep your data.");
  }
}
// ---------- Places added from the online search ----------
// They live alongside the built-in cities (same shape) but are saved with your data,
// since they aren't in the built-in list. IDs start at 3,000,000,000 to never clash with GeoNames ids.
const customPlaces = new Map();

function addPlace(p) {
  if (!p || cityById.has(+p.id)) return cityById.get(+p.id);
  const place = {
    id: +p.id, name: String(p.name), admin: String(p.admin || ''), cc: String(p.cc).toUpperCase(),
    lat: +p.lat, lon: +p.lon, pop: 0, norm: norm(String(p.name)), custom: true,
  };
  cities.push(place);
  cityById.set(place.id, place);
  customPlaces.set(place.id, place);
  return place;
}
function addPlaces(list) { if (Array.isArray(list)) list.forEach(addPlace); }

/** Turn an online search result into a place we can use, reusing a known one if it's the same spot. */
function registerOnlinePlace(r) {
  const n = norm(r.name);
  const same = cities.find((c) => c.norm === n && c.cc === r.cc && distanceKm(c, r) < 10);
  if (same) return same;
  let id;
  do { id = 3000000000 + Math.floor(Math.random() * 1000000000); } while (cityById.has(id));
  return addPlace({ ...r, id, lat: Math.round(r.lat * 1e5) / 1e5, lon: Math.round(r.lon * 1e5) / 1e5 });
}

/** Online-added places that a visit or home still uses (unused ones are dropped on save). */
function usedPlaces() {
  const used = new Set([...data.visits.map((v) => v.cityId), ...data.homes.map((h) => h.cityId)]);
  return [...customPlaces.values()].filter((p) => used.has(p.id))
    .map(({ id, name, admin, cc, lat, lon }) => ({ id, name, admin, cc, lat, lon }));
}

async function searchOnline(q) {
  const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '8', 'accept-language': 'en' });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const seen = new Set();
  return (await res.json())
    .filter((x) => x.address && x.address.country_code)
    .map((x) => {
      const a = x.address;
      return {
        name: x.name || x.display_name.split(',')[0],
        admin: a.state || a.province || a.region || a.state_district || a.county || '',
        cc: a.country_code.toUpperCase(), lat: +x.lat, lon: +x.lon, online: true,
      };
    })
    .filter((r) => {
      const k = `${r.name}|${r.admin}|${r.cc}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Older saves had a single `home` city id; newer ones have a `homes` list. */
function migrateHomes(d) {
  if (Array.isArray(d.homes)) return d.homes;
  return d.home ? [{ id: newId(), cityId: d.home, from: null, to: null }] : [];
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** Homes with their city attached, newest first (current home on top). */
function resolvedHomes() {
  return data.homes
    .map((h) => ({ ...h, city: cityById.get(h.cityId) }))
    .filter((h) => h.city)
    .sort((a, b) => (b.to ?? Infinity) - (a.to ?? Infinity) || (b.from ?? -Infinity) - (a.from ?? -Infinity));
}
const currentHome = () => resolvedHomes().find((h) => h.to == null) || null;

function resolvedVisits() {
  return data.visits.map((v) => ({ ...v, city: cityById.get(v.cityId) })).filter((v) => v.city);
}
function filteredVisits() {
  return resolvedVisits().filter((v) => (filter.from == null || v.y >= filter.from) && (filter.to == null || v.y <= filter.to));
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- City search ----------
function searchCities(q, limit = 8) {
  const parts = q.split(',').map(norm).filter(Boolean);
  if (!parts.length) return [];
  const [name, ...rest] = parts;
  const restOk = (c) => rest.every((r) => norm(countryName(c.cc)).startsWith(r) || norm(c.admin).startsWith(r) || c.cc.toLowerCase() === r);
  const exact = [], prefix = [], word = [];
  for (const c of cities) {
    if (c.norm === name) { if (restOk(c)) exact.push(c); }
    else if (c.norm.startsWith(name)) { if (prefix.length < limit && restOk(c)) prefix.push(c); }
    else if (word.length < limit && name.length > 2 && c.norm.includes(' ' + name) && restOk(c)) word.push(c);
  }
  return [...exact, ...prefix, ...word].slice(0, limit);
}

function nearestCity(lat, lon) {
  let best = null, bestD = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const c of cities) {
    let dLon = Math.abs(c.lon - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const d = (c.lat - lat) ** 2 + (dLon * cosLat) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * Wire an input + list into a city autocomplete. Returns {get, set}.
 * Built-in cities are searched as you type; the last row offers an online search (OpenStreetMap)
 * for places that aren't in the built-in list. Nothing goes online unless that row is chosen.
 */
function cityCombo(input, list, onPick) {
  let selected = null, items = [], extra = null, active = -1, searchSeq = 0;
  const total = () => items.length + (extra && extra.type === 'online' ? 1 : 0);
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const sub = (c) => esc([c.admin !== c.name ? c.admin : '', countryName(c.cc)].filter(Boolean).join(', '));
  const render = () => {
    let html = items.map((c, i) =>
      `<li role="option" id="${list.id}-${i}" data-i="${i}" class="${i === active ? 'active' : ''}" aria-selected="${i === active}">
        <strong>${esc(c.name)}</strong> <span class="muted">${sub(c)}</span>${c.online ? '<span class="tag">OpenStreetMap</span>' : ''}</li>`).join('');
    if (extra && extra.type === 'online') {
      const i = items.length;
      html += `<li role="option" id="${list.id}-${i}" data-i="${i}" class="online-row ${i === active ? 'active' : ''}" aria-selected="${i === active}">
        Not listed? <strong>Search online</strong> for “${esc(extra.q)}”</li>`;
    } else if (extra && extra.type === 'status') {
      html += `<li class="status" aria-live="polite">${esc(extra.text)}</li>`;
    }
    list.innerHTML = html;
    const open = !!html;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (c) => {
    if (c.online) c = registerOnlinePlace(c);
    selected = c;
    input.value = cityLabelLong(c);
    close();
    onPick && onPick(c);
  };
  const runOnline = async (q) => {
    const seq = ++searchSeq;
    items = [];
    extra = { type: 'status', text: 'Searching OpenStreetMap…' };
    active = -1;
    render();
    try {
      const results = await searchOnline(q);
      if (seq !== searchSeq) return; // the user has typed something else since
      items = results;
      extra = results.length ? null : { type: 'status', text: `Nothing found online for “${q}”. Try adding the country, e.g. “${q}, Italy”.` };
      active = results.length ? 0 : -1;
    } catch {
      if (seq !== searchSeq) return;
      extra = { type: 'status', text: "Couldn't reach the online search. Check your internet connection and try again." };
    }
    render();
  };
  const activate = (i) => {
    if (i < items.length) pick(items[i]);
    else if (extra && extra.type === 'online') runOnline(extra.q);
  };
  input.addEventListener('input', () => {
    selected = null;
    searchSeq++;
    const q = input.value.trim();
    items = searchCities(q);
    extra = q.length >= 2 ? { type: 'online', q } : null;
    active = total() ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const n = total();
    if (e.key === 'ArrowDown' && n) { active = (active + 1) % n; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && n) { active = (active - 1 + n) % n; render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { activate(active); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    e.preventDefault(); // keep focus in the input
    if (li) activate(+li.dataset.i);
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 100));
  return {
    get: () => selected,
    set: (c) => { selected = c; input.value = c ? cityLabelLong(c) : ''; items = []; extra = null; searchSeq++; close(); },
  };
}

// ---------- Map ----------
const ACCENT = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';

function initMap() {
  map = L.map('map', { worldCopyJump: true, minZoom: 1, maxZoom: 8, zoomSnap: 0.5, zoomControl: true }).setView([25, 10], 2);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Map: <a href="https://www.naturalearthdata.com/">Natural Earth</a> · Cities: <a href="https://www.geonames.org/">GeoNames</a>, <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://leafletjs.com">Leaflet</a>');
  pinLayer = L.layerGroup();
  homeLayer = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    if (readOnly) return;
    const ll = e.latlng.wrap();
    const c = nearestCity(ll.lat, ll.lng);
    if (c) openVisitDialog({ city: c });
  });
  // Buttons inside popups
  // (capture phase: Leaflet stops clicks inside popups from bubbling)
  $('map').addEventListener('click', (e) => {
    const b = e.target.closest('[data-popup]');
    if (!b) return;
    const city = cityById.get(+b.dataset.city);
    pinLayer.eachLayer((l) => l.closePopup());
    if (b.dataset.popup === 'add') openVisitDialog({ city });
    if (b.dataset.popup === 'edit') openVisitDialog({ visit: data.visits.find((v) => v.id === b.dataset.id) });
  }, true);
}

function drawMap(visits) {
  const visitedCC = new Set(visits.map((v) => v.city.cc));
  if (countryLayer) {
    countryLayer.setStyle((f) => countryStyle(visitedCC.has(f.properties.cc)));
  }
  pinLayer.clearLayers();
  const byCity = new Map();
  for (const v of visits) {
    if (!byCity.has(v.city.id)) byCity.set(v.city.id, []);
    byCity.get(v.city.id).push(v);
  }
  for (const [, vs] of byCity) {
    const c = vs[0].city;
    vs.sort((a, b) => visitKey(a) - visitKey(b));
    const m = L.circleMarker([c.lat, c.lon], {
      radius: 5 + Math.min(6, (vs.length - 1) * 1.5),
      color: '#fff', weight: 2, fillColor: ACCENT, fillOpacity: 0.95, bubblingMouseEvents: false,
    });
    m.bindPopup(() => popupHtml(c, vs));
    m.bindTooltip(`${esc(c.name)} · ${vs.length} visit${vs.length > 1 ? 's' : ''}`, { direction: 'top', offset: [0, -6] });
    pinLayer.addLayer(m);
  }
  pinLayer.addTo(map);
  drawHomes();
}

function countryStyle(visited) {
  return visited
    ? { color: '#ffffff', weight: 0.8, opacity: 1, fillColor: ACCENT, fillOpacity: 0.35 }
    : { color: '#d5dae0', weight: 0.6, opacity: 1, fillColor: '#ffffff', fillOpacity: 1 };
}

function popupHtml(c, vs) {
  const rows = vs.map((v) => `<li><span>${formatWhen(v)}</span>${readOnly ? '' : `<button type="button" class="link" data-popup="edit" data-id="${esc(v.id)}" data-city="${c.id}">Edit</button>`}</li>`).join('');
  return `<div class="popup"><strong>${esc(c.name)}</strong><div class="muted">${esc(countryName(c.cc))}</div>
    <ul>${rows}</ul>${readOnly ? '' : `<button type="button" class="btn small primary" data-popup="add" data-city="${c.id}">+ Add another visit</button>`}</div>`;
}

function drawHomes() {
  homeLayer.clearLayers();
  // Past homes first so the current home is drawn on top
  for (const h of resolvedHomes().reverse()) {
    const current = h.to == null;
    const label = current
      ? `Current home: ${esc(h.city.name)}${h.from != null ? ` · since ${h.from}` : ''}`
      : `Past home: ${esc(h.city.name)} · ${formatYears(h)}`;
    L.marker([h.city.lat, h.city.lon], {
      icon: L.divIcon({
        className: `home-icon ${current ? 'current' : 'past'}`,
        html: '<span aria-hidden="true">⌂</span>',
        iconSize: current ? [26, 26] : [20, 20],
        iconAnchor: current ? [13, 13] : [10, 10],
      }),
      keyboard: false,
      zIndexOffset: current ? 1000 : 500,
    }).bindTooltip(label, { direction: 'top', offset: [0, -10] }).addTo(homeLayer);
  }
}

function showTempMarker(c) {
  clearTempMarker();
  if (!c) return;
  tempMarker = L.circleMarker([c.lat, c.lon], { radius: 8, color: ACCENT, weight: 2, dashArray: '3 3', fill: false, interactive: false }).addTo(map);
}
function clearTempMarker() { if (tempMarker) { tempMarker.remove(); tempMarker = null; } }

// ---------- Stats panel ----------
function tile(value, label, sub = '') {
  return `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}
const placeLine = (c) => `${esc(c.name)} <span class="muted">${esc(countryName(c.cc))}</span>`;

function yearChart(years) {
  if (!years.length) return '';
  const min = years[0].year, max = years[years.length - 1].year;
  const byYear = new Map(years.map((y) => [y.year, y]));
  const all = [];
  for (let y = min; y <= max; y++) all.push(byYear.get(y) || { year: y, visits: 0, newCities: 0, newCountries: 0 });
  const peak = Math.max(...all.map((y) => y.visits));
  const step = Math.ceil(all.length / 8);
  const bars = all.map((y, i) => {
    const h = y.visits ? Math.max(4, (y.visits / peak) * 100) : 0;
    const tip = `${y.year}: ${y.visits} visit${y.visits === 1 ? '' : 's'} · ${y.newCities} new cit${y.newCities === 1 ? 'y' : 'ies'} · ${y.newCountries} new countr${y.newCountries === 1 ? 'y' : 'ies'}`;
    const showLabel = i % step === 0 || i === all.length - 1;
    return `<div class="bar-col" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
      <div class="bar-area"><div class="bar" style="height:${h}%"></div></div>
      <div class="bar-label">${showLabel ? `’${String(y.year).slice(2)}` : ''}</div></div>`;
  }).join('');
  return `<div class="chart" role="img" aria-label="Visits per year">
      <div class="chart-peak muted">${peak}</div>
      <div class="bars">${bars}</div>
      <div class="chart-tip" hidden></div>
    </div>`;
}

function renderStats(visits) {
  const el = $('tab-stats');
  const homes = resolvedHomes();
  if (!visits.length) {
    el.innerHTML = data.visits.length
      ? `<div class="empty"><p>No visits in this time range.</p></div>`
      : `<div class="empty"><div class="empty-globe" aria-hidden="true">🌍</div><h2>Start your map</h2>
         <p>Search for a city or click anywhere on the map to add your first visit.</p>
         ${readOnly ? '' : '<button type="button" class="btn primary" data-act="add">+ Add your first visit</button>'}</div>`;
    return;
  }
  const s = computeStats(visits, resolvedVisits(), { homes, countries });
  const contNames = s.continents.map((c) => CONTINENTS[c]).join(', ');
  const newInRange = s.years.reduce((a, y) => a + y.newCities, 0);
  const ex = s.extremes;
  const fh = s.fromHome;

  el.innerHTML = `
    <section class="block">
      <div class="tiles">
        ${tile(s.countries, `countr${s.countries === 1 ? 'y' : 'ies'}`, `${s.worldPct.toFixed(1)}% of ${WORLD_COUNTRIES}`)}
        ${tile(s.cities, `cit${s.cities === 1 ? 'y' : 'ies'}`, s.returnCities ? `${s.returnCities} visited more than once` : '')}
        ${tile(`${s.continents.length}<span class="of">/7</span>`, 'continents', esc(contNames))}
        ${tile(s.visits, `visit${s.visits === 1 ? '' : 's'}`, '')}
      </div>
      <div class="progress" aria-label="${s.worldPct.toFixed(1)}% of the world's countries visited"><div style="width:${Math.min(100, s.worldPct)}%"></div></div>
    </section>

    <section class="block">
      <h3>Over time</h3>
      <p class="chart-title muted">Visits per year · hover a bar for new places</p>
      ${yearChart(s.years)}
      <dl class="facts">
        <div><dt>Busiest year</dt><dd>${s.busiest.year} <span class="muted">(${s.busiest.visits} visit${s.busiest.visits === 1 ? '' : 's'})</span></dd></div>
        <div><dt>First trip</dt><dd>${placeLine(s.first.city)} <span class="muted">· ${formatWhen(s.first)}</span></dd></div>
        <div><dt>Latest trip</dt><dd>${placeLine(s.latest.city)} <span class="muted">· ${formatWhen(s.latest)}</span></dd></div>
        <div><dt>New cities</dt><dd>${newInRange} <span class="muted">first-time visits${filter.from || filter.to ? ' in this range' : ''}</span></dd></div>
      </dl>
    </section>

    <section class="block">
      <h3>Distance &amp; extremes</h3>
      <dl class="facts compass">
        <div><dt>Farthest north</dt><dd>${placeLine(ex.north)} <span class="muted">${ex.north.lat.toFixed(1)}°</span></dd></div>
        <div><dt>Farthest south</dt><dd>${placeLine(ex.south)} <span class="muted">${ex.south.lat.toFixed(1)}°</span></dd></div>
        <div><dt>Farthest east</dt><dd>${placeLine(ex.east)} <span class="muted">${ex.east.lon.toFixed(1)}°</span></dd></div>
        <div><dt>Farthest west</dt><dd>${placeLine(ex.west)} <span class="muted">${ex.west.lon.toFixed(1)}°</span></dd></div>
      </dl>
      ${homes.length ? (fh.trips ? `
      <dl class="facts">
        <div><dt>Farthest from home</dt><dd>${placeLine(fh.farthest.city)} <span class="muted">· ${fmtNum(fh.farthest.km)} km${homes.length > 1 ? ` from ${esc(fh.farthest.home.name)}` : ''}</span></dd></div>
        <div><dt>Average trip</dt><dd>${fmtNum(fh.averageKm)} km <span class="muted">from ${homes.length > 1 ? 'home at the time' : esc(homes[0].city.name)}</span></dd></div>
        <div><dt>Round trips from home</dt><dd>${fmtNum(fh.roundTripKm)} km <span class="muted">· ${fh.aroundEarth.toFixed(1)}× around the Earth</span></dd></div>
      </dl>` : `<p class="muted note">All visits in this range are in the city you lived in at the time.</p>`)
      : (readOnly ? '' : `<p class="muted note">Add your home cities to see distance-from-home stats. <button type="button" class="link" data-act="home">Add home cities</button></p>`)}
    </section>

    ${homes.length ? `<section class="block">
      <h3>Home${homes.length > 1 ? 's' : ''}</h3>
      <ul class="home-list">${homes.map((h) => `<li class="${h.to == null ? 'current' : 'past'}">
        <span class="home-dot" aria-hidden="true">⌂</span>
        <span>${placeLine(h.city)}</span>
        <span class="home-years">${h.to == null ? `<span class="badge">Current</span> ${h.from != null ? `since ${h.from}` : ''}` : formatYears(h)}</span>
      </li>`).join('')}</ul>
      ${readOnly ? '' : '<button type="button" class="link note-link" data-act="home">Edit homes</button>'}
    </section>` : ''}

    <section class="block">
      <h3>Favourites</h3>
      <div class="two-col">
        <div>
          <h4>Most-visited cities</h4>
          <ol class="rank">${s.topCities.map((e) => `<li><span>${esc(e.city.name)}</span><span class="muted">${e.count}×</span></li>`).join('')}</ol>
        </div>
        <div>
          <h4>Most-visited countries</h4>
          <ol class="rank">${s.topCountries.map((c) => `<li><span>${esc(countryName(c.cc))}</span><span class="muted" title="${c.visits} visits, ${c.cities} cities">${c.visits}× · ${c.cities} cit${c.cities === 1 ? 'y' : 'ies'}</span></li>`).join('')}</ol>
        </div>
      </div>
    </section>`;
  wireChartTips(el);
}

function wireChartTips(root) {
  const chart = root.querySelector('.chart');
  if (!chart) return;
  const tip = chart.querySelector('.chart-tip');
  const show = (col) => {
    tip.textContent = col.dataset.tip;
    tip.hidden = false;
    const cr = chart.getBoundingClientRect(), br = col.getBoundingClientRect();
    const x = br.left - cr.left + br.width / 2;
    tip.style.left = `${Math.max(tip.offsetWidth / 2, Math.min(cr.width - tip.offsetWidth / 2, x))}px`;
    chart.querySelectorAll('.bar-col.hover').forEach((c) => c.classList.remove('hover'));
    col.classList.add('hover');
  };
  const hide = () => { tip.hidden = true; chart.querySelectorAll('.bar-col.hover').forEach((c) => c.classList.remove('hover')); };
  chart.querySelectorAll('.bar-col').forEach((col) => {
    col.addEventListener('mouseenter', () => show(col));
    col.addEventListener('focus', () => show(col));
    col.addEventListener('click', () => show(col));
    col.addEventListener('blur', hide);
  });
  chart.addEventListener('mouseleave', hide);
}

// ---------- Visits list ----------
function renderVisits(visits) {
  const el = $('tab-visits');
  $('visitCount').textContent = visits.length;
  if (!visits.length) {
    el.innerHTML = `<div class="empty"><p>${data.visits.length ? 'No visits in this time range.' : 'No visits yet.'}</p></div>`;
    return;
  }
  const sorted = [...visits].sort((a, b) => visitKey(b) - visitKey(a));
  let html = '', year = null;
  for (const v of sorted) {
    if (v.y !== year) {
      if (year !== null) html += '</ul>';
      year = v.y;
      html += `<h3 class="year-head">${year}</h3><ul class="visit-list">`;
    }
    html += `<li>
      <button type="button" class="visit-main" data-fly="${v.city.id}">
        <span class="visit-city">${esc(v.city.name)}</span>
        <span class="muted">${esc(countryName(v.city.cc))}</span>
      </button>
      <span class="visit-when">${v.m ? MONTHS[v.m - 1] : '—'}</span>
      ${readOnly ? '' : `<button type="button" class="link" data-edit="${esc(v.id)}" aria-label="Edit visit to ${esc(v.city.name)}">Edit</button>`}
    </li>`;
  }
  el.innerHTML = html + '</ul>';
}

// ---------- Filter ----------
function renderFilter() {
  const years = [...new Set(resolvedVisits().map((v) => v.y))].sort((a, b) => a - b);
  $('filter').hidden = years.length < 2;
  const opts = (sel, anyLabel) => `<option value="">${anyLabel}</option>` +
    years.map((y) => `<option value="${y}" ${sel === y ? 'selected' : ''}>${y}</option>`).join('');
  if (filter.from != null && !years.includes(filter.from)) filter.from = null;
  if (filter.to != null && !years.includes(filter.to)) filter.to = null;
  $('yearFrom').innerHTML = opts(filter.from, 'All years');
  $('yearTo').innerHTML = opts(filter.to, 'Now');
}

function onFilterChange() {
  let f = $('yearFrom').value ? +$('yearFrom').value : null;
  let t = $('yearTo').value ? +$('yearTo').value : null;
  if (f != null && t != null && f > t) [f, t] = [t, f];
  filter = { from: f, to: t };
  renderAll();
}

// ---------- Render all ----------
function renderAll() {
  renderFilter();
  const visits = filteredVisits();
  drawMap(visits);
  renderStats(visits);
  renderVisits(visits);
}

// ---------- Visit dialog ----------
let visitCombo, homeCombo, editingId = null;

function fillDateSelects() {
  $('monthInput').innerHTML = '<option value="0">Month unknown</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const now = new Date().getFullYear();
  let yrs = '';
  for (let y = now; y >= 1940; y--) yrs += `<option value="${y}">${y}</option>`;
  $('yearInput').innerHTML = yrs;
}

function openVisitDialog({ city = null, visit = null } = {}) {
  editingId = visit ? visit.id : null;
  const now = new Date();
  const c = visit ? cityById.get(visit.cityId) : city;
  visitCombo.set(c);
  $('monthInput').value = String(visit ? visit.m : now.getMonth() + 1);
  $('yearInput').value = String(visit ? visit.y : now.getFullYear());
  $('visitTitle').textContent = visit ? 'Edit visit' : 'Add a visit';
  $('deleteVisitBtn').hidden = !visit;
  $('visitError').hidden = true;
  showTempMarker(c);
  $('visitDialog').showModal();
  if (!c) $('cityInput').focus();
  else $('saveVisitBtn').focus();
}

function closeVisitDialog() { $('visitDialog').close(); }

function saveVisit(e) {
  e.preventDefault();
  const c = visitCombo.get();
  const err = $('visitError');
  if (!c) { err.textContent = 'Pick a city from the suggestions.'; err.hidden = false; return; }
  const y = +$('yearInput').value, m = +$('monthInput').value;
  const now = new Date();
  if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) {
    err.textContent = "That date is in the future. This map is for places you've already been."; err.hidden = false; return;
  }
  const dup = data.visits.find((v) => v.id !== editingId && v.cityId === c.id && v.y === y && v.m === m);
  if (dup) { err.textContent = `You've already logged ${c.name} for ${formatWhen({ y, m })}.`; err.hidden = false; return; }
  if (editingId) {
    Object.assign(data.visits.find((v) => v.id === editingId), { cityId: c.id, y, m });
  } else {
    data.visits.push({ id: newId(), cityId: c.id, y, m });
  }
  save();
  closeVisitDialog();
  // Make sure the new visit is visible under the current filter
  if ((filter.from != null && y < filter.from) || (filter.to != null && y > filter.to)) filter = { from: null, to: null };
  renderAll();
  toast(editingId ? 'Visit updated' : `Added ${c.name} · ${formatWhen({ y, m })}`);
}

function deleteVisit() {
  const v = data.visits.find((x) => x.id === editingId);
  if (!v) return;
  const c = cityById.get(v.cityId);
  if (!confirm(`Delete your ${formatWhen(v)} visit to ${c ? c.name : 'this city'}?`)) return;
  data.visits = data.visits.filter((x) => x.id !== editingId);
  save();
  closeVisitDialog();
  renderAll();
  toast('Visit deleted');
}

// ---------- Homes dialog ----------
let editingHomeId = null;

function fillHomeYearSelects() {
  const now = new Date().getFullYear();
  let fromOpts = '<option value="">Not sure</option>', toOpts = '<option value="">Now (current home)</option>';
  for (let y = now; y >= 1930; y--) {
    fromOpts += `<option value="${y}">${y}</option>`;
    toOpts += `<option value="${y}">${y}</option>`;
  }
  $('homeFrom').innerHTML = fromOpts;
  $('homeTo').innerHTML = toOpts;
}

function renderHomeRows() {
  const homes = resolvedHomes();
  $('homeRows').innerHTML = homes.length
    ? homes.map((h) => `<li class="${h.to == null ? 'current' : 'past'}${h.id === editingHomeId ? ' editing' : ''}">
        <span class="home-dot" aria-hidden="true">⌂</span>
        <span class="home-name">${esc(h.city.name)} <span class="muted">${esc(countryName(h.city.cc))}</span></span>
        <span class="home-years">${h.to == null ? `<span class="badge">Current</span> ${h.from != null ? `since ${h.from}` : ''}` : formatYears(h)}</span>
        <button type="button" class="link" data-home-edit="${esc(h.id)}" aria-label="Edit ${esc(h.city.name)}">Edit</button>
        <button type="button" class="link danger" data-home-del="${esc(h.id)}" aria-label="Remove ${esc(h.city.name)}">Remove</button>
      </li>`).join('')
    : '<li class="home-empty muted">No homes yet. Add your current home below.</li>';
}

function resetHomeForm(h = null) {
  editingHomeId = h ? h.id : null;
  homeCombo.set(h ? cityById.get(h.cityId) : null);
  const hasCurrent = data.homes.some((x) => x.to == null && x.id !== editingHomeId);
  $('homeFrom').value = h && h.from != null ? String(h.from) : '';
  // New homes default to "Now" only if there's no current home yet
  $('homeTo').value = h ? (h.to != null ? String(h.to) : '') : (hasCurrent ? String(new Date().getFullYear()) : '');
  $('homeFormTitle').textContent = h ? 'Edit home' : 'Add a home';
  $('saveHomeBtn').textContent = h ? 'Save changes' : 'Add home';
  $('cancelHomeEditBtn').hidden = !h;
  $('homeError').hidden = true;
  renderHomeRows();
}

function openHomeDialog() {
  resetHomeForm();
  $('homeDialog').showModal();
  $('homeInput').focus();
}

function saveHome(e) {
  e.preventDefault();
  const err = (msg) => { $('homeError').textContent = msg; $('homeError').hidden = false; };
  const c = homeCombo.get();
  if (!c) return err('Pick a city from the suggestions.');
  const from = $('homeFrom').value ? +$('homeFrom').value : null;
  const to = $('homeTo').value ? +$('homeTo').value : null;
  if (from != null && to != null && from > to) return err('"From" year must be before the "until" year.');

  let note = '';
  if (to == null) {
    // Only one current home: the previous one becomes a past home ending the year you moved
    const prev = data.homes.find((h) => h.to == null && h.id !== editingHomeId);
    if (prev) {
      const end = from ?? new Date().getFullYear();
      if (prev.from != null && prev.from > end) return err(`Your current home (${cityById.get(prev.cityId)?.name}) starts after ${end}. Set its dates first.`);
      prev.to = end;
      note = ` ${cityById.get(prev.cityId)?.name} moved to past homes (until ${end}).`;
    }
  }
  const wasEditing = !!editingHomeId;
  if (wasEditing) Object.assign(data.homes.find((h) => h.id === editingHomeId), { cityId: c.id, from, to });
  else data.homes.push({ id: newId(), cityId: c.id, from, to });
  save();
  renderAll();
  resetHomeForm();
  toast(`${wasEditing ? 'Updated' : 'Added'} ${c.name}.${note}`);
}

function deleteHome(id) {
  const h = data.homes.find((x) => x.id === id);
  if (!h || !confirm(`Remove ${cityById.get(h.cityId)?.name || 'this home'} from your homes?`)) return;
  data.homes = data.homes.filter((x) => x.id !== id);
  save();
  renderAll();
  resetHomeForm();
}

// ---------- Backup / restore / share ----------
function downloadBackup() {
  const payload = {
    app: 'travel-map', version: 3, exportedAt: new Date().toISOString(),
    places: usedPlaces(),
    homes: resolvedHomes().map((h) => ({ cityId: h.cityId, city: cityLabel(h.city), from: h.from, to: h.to })),
    visits: [...data.visits].sort((a, b) => visitKey(a) - visitKey(b)).map((v) => {
      const c = cityById.get(v.cityId);
      return { cityId: v.cityId, city: c ? cityLabel(c) : '', year: v.y, month: v.m || null };
    }),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `travel-map-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup downloaded');
}

async function restoreBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'travel-map' || !Array.isArray(d.visits)) throw new Error('not a backup');
    addPlaces(d.places);
    const visits = d.visits
      .filter((v) => cityById.has(+v.cityId) && Number.isInteger(+v.year))
      .map((v) => ({ id: newId(), cityId: +v.cityId, y: +v.year, m: +v.month || 0 }));
    const msg = data.visits.length
      ? `Replace your current ${data.visits.length} visits with the ${visits.length} in this backup?`
      : `Load ${visits.length} visits from this backup?`;
    if (!confirm(msg)) return;
    const homes = Array.isArray(d.homes)
      ? d.homes.filter((h) => cityById.has(+h.cityId)).map((h) => ({
        id: newId(), cityId: +h.cityId, from: Number.isInteger(h.from) ? h.from : null, to: Number.isInteger(h.to) ? h.to : null,
      }))
      : (d.home && cityById.has(+d.home.cityId) ? [{ id: newId(), cityId: +d.home.cityId, from: null, to: null }] : []);
    data = { homes, visits };
    filter = { from: null, to: null };
    save();
    renderAll();
    fitToVisits();
    toast(`Restored ${visits.length} visits`);
  } catch {
    toast("That file doesn't look like a Travel Map backup.");
  }
}

async function openShare() {
  if (!data.visits.length) { toast('Add some visits first.'); return; }
  const code = await encodeShare(data, usedPlaces());
  const url = `${location.origin}${location.pathname}#s=${code}`;
  $('shareUrl').value = url;
  $('shareDialog').showModal();
  $('shareUrl').select();
}

async function copyShare() {
  const url = $('shareUrl').value;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    $('shareUrl').select();
    document.execCommand('copy');
    toast('Link copied');
  }
}

// ---------- Wiring ----------
function wireUi() {
  fillDateSelects();
  visitCombo = cityCombo($('cityInput'), $('cityList'), (c) => { showTempMarker(c); $('visitError').hidden = true; });
  homeCombo = cityCombo($('homeInput'), $('homeList'));

  $('addBtn').addEventListener('click', () => openVisitDialog());
  $('visitForm').addEventListener('submit', saveVisit);
  $('cancelVisitBtn').addEventListener('click', closeVisitDialog);
  $('deleteVisitBtn').addEventListener('click', deleteVisit);
  $('visitDialog').addEventListener('close', clearTempMarker);

  fillHomeYearSelects();
  $('homeForm').addEventListener('submit', saveHome);
  $('doneHomeBtn').addEventListener('click', () => $('homeDialog').close());
  $('cancelHomeEditBtn').addEventListener('click', () => resetHomeForm());
  $('homeRows').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.homeEdit) { resetHomeForm(data.homes.find((h) => h.id === b.dataset.homeEdit)); $('homeInput').focus(); }
    if (b.dataset.homeDel) deleteHome(b.dataset.homeDel);
  });

  $('closeShareBtn').addEventListener('click', () => $('shareDialog').close());
  $('copyShareBtn').addEventListener('click', copyShare);
  $('restoreInput').addEventListener('change', (e) => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; });

  // Light-dismiss dialogs by clicking the backdrop
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); }));

  // Menu
  const menuBtn = $('menuBtn'), menuList = $('menuList');
  const setMenu = (open) => { menuList.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menuList.hidden); });
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  menuList.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    setMenu(false);
    ({ home: openHomeDialog, share: openShare, backup: downloadBackup, restore: () => $('restoreInput').click() })[a.dataset.action]();
  });

  $('yearFrom').addEventListener('change', onFilterChange);
  $('yearTo').addEventListener('change', onFilterChange);

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', String(x === t)); });
    $('tab-stats').hidden = t.dataset.tab !== 'stats';
    $('tab-visits').hidden = t.dataset.tab !== 'visits';
  }));

  // Panel buttons (delegated)
  document.querySelector('.panel').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'add') openVisitDialog();
    if (t.dataset.act === 'home') openHomeDialog();
    if (t.dataset.edit) openVisitDialog({ visit: data.visits.find((v) => v.id === t.dataset.edit) });
    if (t.dataset.fly) {
      const c = cityById.get(+t.dataset.fly);
      map.flyTo([c.lat, c.lon], Math.max(map.getZoom(), 5), { duration: 0.8 });
      if (window.matchMedia('(max-width: 800px)').matches) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' });
    }
  });
}

function fitToVisits() {
  const visits = filteredVisits();
  if (!visits.length) return;
  const b = L.latLngBounds(visits.map((v) => [v.city.lat, v.city.lon]));
  map.fitBounds(b.pad(0.3), { maxZoom: 5 });
}

// ---------- Boot ----------
async function boot() {
  initMap();
  wireUi();

  const [cityRows, countryData, world] = await Promise.all([
    fetch('data/cities.json').then((r) => r.json()),
    fetch('data/countries.json').then((r) => r.json()),
    fetch('data/world.geojson').then((r) => r.json()),
  ]);
  countryLayer = L.geoJSON(world, { interactive: false, style: () => countryStyle(false) }).addTo(map);
  countries = countryData;
  cities = cityRows.map(([id, name, admin, cc, lat, lon, pop]) => ({ id, name, admin, cc, lat, lon, pop, norm: norm(name) }));
  for (const c of cities) cityById.set(c.id, c);

  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    try {
      const shared = await decodeShare(m[1]);
      addPlaces(shared.places);
      data = { homes: shared.homes, visits: shared.visits };
      readOnly = true;
      document.body.classList.add('readonly');
      $('sharedBanner').hidden = false;
      $('ownMapLink').href = location.pathname;
      $('ownMapLink').addEventListener('click', (e) => { e.preventDefault(); location.href = location.pathname; });
    } catch {
      toast("That share link looks broken. Showing your own map instead.");
      history.replaceState(null, '', location.pathname);
      load();
    }
  } else {
    load();
  }

  renderAll();
  fitToVisits();
  $('loading').hidden = true;
}

window.addEventListener('hashchange', () => location.reload());
boot().catch((err) => {
  console.error(err);
  $('loading').textContent = 'Something went wrong loading the map. Please refresh.';
});
