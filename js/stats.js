// Pure stat calculations. No DOM here, so it can be tested on its own.

export const WORLD_COUNTRIES = 195; // UN members + 2 observer states
export const EARTH_CIRCUMFERENCE_KM = 40075;

export const CONTINENTS = {
  AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe',
  NA: 'North America', OC: 'Oceania', SA: 'South America',
};

export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];
const US_STATE_LOOKUP = new Map(US_STATES.map((n) => [n.toLowerCase(), n]));

/** US states (of 50) visited, plus whether Washington, D.C. was visited. Uses each place's state/region name. */
export function usStatesVisited(visits) {
  const states = new Set();
  let dc = false;
  for (const v of visits) {
    if (v.city.cc !== 'US') continue;
    const admin = (v.city.admin || '').trim().toLowerCase();
    if (admin === 'district of columbia' || admin === 'washington, d.c.') dc = true;
    else if (US_STATE_LOOKUP.has(admin)) states.add(US_STATE_LOOKUP.get(admin));
  }
  const visited = [...states].sort();
  return { visited, missing: US_STATES.filter((n) => !states.has(n)), dc, any: visits.some((v) => v.city.cc === 'US') };
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Great-circle distance in km between two {lat, lon} points. */
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sort key for a visit: year then month (unknown month = 0 sorts first). */
export const visitKey = (v) => v.y * 100 + (v.m || 0);

export function formatWhen(v) {
  return v.m ? `${MONTHS[v.m - 1]} ${v.y}` : `${v.y}`;
}

/** "2015–2019", "2019–now", "2019", "?–2012" for a home's years. */
export function formatYears(h) {
  if (h.to == null) return h.from == null ? 'now' : `${h.from}–now`;
  if (h.from === h.to) return `${h.from}`;
  return `${h.from ?? '?'}–${h.to}`;
}

/**
 * Which home was "home" in a given year. Homes: {city, from, to}; from null = unknown start, to null = current.
 * In a moving year (two homes match) the newer home wins. If no home covers the year, the closest in time is used.
 */
export function homeAt(homes, year) {
  let best = null, bestGap = Infinity, bestFrom = -Infinity;
  for (const h of homes) {
    const from = h.from ?? -Infinity, to = h.to ?? Infinity;
    const gap = year < from ? from - year : year > to ? year - to : 0;
    if (gap < bestGap || (gap === bestGap && from > bestFrom)) { best = h; bestGap = gap; bestFrom = from; }
  }
  return best;
}

/**
 * Group city visits into trips. Several cities in the same country and the same month count as ONE trip
 * when that country is abroad (not where you lived that year). Visits at home, and visits with no month,
 * are always their own trip. With no homes set, every country counts as abroad.
 * @returns {Array<{y:number, m:number, cc:string, visits:Array}>}
 */
export function groupTrips(visits, homes = []) {
  const trips = new Map();
  for (const v of visits) {
    const abroad = !homes.length || homeAt(homes, v.y).city.cc !== v.city.cc;
    const key = abroad && v.m ? `${v.city.cc}|${v.y}|${v.m}` : `visit|${v.id}`;
    if (!trips.has(key)) trips.set(key, { y: v.y, m: v.m || 0, cc: v.city.cc, abroad, visits: [] });
    trips.get(key).visits.push(v);
  }
  return [...trips.values()];
}

/**
 * @param {Array} visits    visits to summarise (already filtered). Each: {id, y, m, city:{id,name,cc,lat,lon}}
 * @param {Array} allVisits every visit, used to decide when a place was first visited
 * @param {Object} ctx      {homes: [{city, from, to}], countries: {cc: [name, continent]}}
 */
export function computeStats(visits, allVisits, ctx) {
  const { homes = [], countries } = ctx;
  const continentOf = (cc) => (countries[cc] ? countries[cc][1] : null);

  // Unique places
  const cityMap = new Map(); // id -> {city, count, last}
  const countryMap = new Map(); // cc -> {cc, visits, cities:Set}
  const continentSet = new Set();
  for (const v of visits) {
    const c = v.city;
    const ce = cityMap.get(c.id) || { city: c, count: 0, last: 0 };
    ce.count++;
    ce.last = Math.max(ce.last, visitKey(v));
    cityMap.set(c.id, ce);
    const co = countryMap.get(c.cc) || { cc: c.cc, visits: 0, cities: new Set() };
    co.visits++;
    co.cities.add(c.id);
    countryMap.set(c.cc, co);
    const cont = continentOf(c.cc);
    if (cont) continentSet.add(cont);
  }

  // First-ever visit of each city / country, across ALL data
  const firstCity = new Map();
  const firstCountry = new Map();
  for (const v of [...allVisits].sort((a, b) => visitKey(a) - visitKey(b))) {
    if (!firstCity.has(v.city.id)) firstCity.set(v.city.id, v.id);
    if (!firstCountry.has(v.city.cc)) firstCountry.set(v.city.cc, v.id);
  }

  const trips = groupTrips(visits, homes);

  // Per year: trips (not city stops), plus places seen for the first time
  const years = new Map();
  const yearOf = (yr) => {
    if (!years.has(yr)) years.set(yr, { year: yr, trips: 0, newCities: 0, newCountries: 0 });
    return years.get(yr);
  };
  for (const t of trips) yearOf(t.y).trips++;
  for (const v of visits) {
    const y = yearOf(v.y);
    if (firstCity.get(v.city.id) === v.id) y.newCities++;
    if (firstCountry.get(v.city.cc) === v.id) y.newCountries++;
  }
  const yearList = [...years.values()].sort((a, b) => a.year - b.year);
  let busiest = null;
  for (const y of yearList) if (!busiest || y.trips > busiest.trips) busiest = y;

  const sorted = [...visits].sort((a, b) => visitKey(a) - visitKey(b));

  // Extremes
  const uniqueCities = [...cityMap.values()].map((e) => e.city);
  const pick = (fn) => uniqueCities.reduce((best, c) => (!best || fn(c, best) ? c : best), null);
  const extremes = uniqueCities.length ? {
    north: pick((a, b) => a.lat > b.lat),
    south: pick((a, b) => a.lat < b.lat),
    east: pick((a, b) => a.lon > b.lon),
    west: pick((a, b) => a.lon < b.lon),
  } : null;

  // Home distances: each trip is measured from where you lived that year, as one round trip
  // to its farthest city. Visits to the city you lived in at the time are not trips.
  let fromHome = null;
  if (homes.length) {
    let farthest = null;
    let total = 0;
    let tripCount = 0;
    for (const t of trips) {
      const h = homeAt(homes, t.y);
      let tripKm = -1;
      for (const v of t.visits) {
        if (v.city.id === h.city.id) continue;
        const d = distanceKm(h.city, v.city);
        tripKm = Math.max(tripKm, d);
        if (!farthest || d > farthest.km) farthest = { city: v.city, km: d, home: h.city };
      }
      if (tripKm < 0) continue;
      tripCount++;
      total += 2 * tripKm;
    }
    fromHome = {
      farthest,
      roundTripKm: total,
      aroundEarth: total / EARTH_CIRCUMFERENCE_KM,
      averageKm: tripCount ? total / 2 / tripCount : 0,
      trips: tripCount,
    };
  }

  // Favourites
  const topCities = [...cityMap.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, 5);
  // Most-visited countries counts trips abroad (not the country you were living in at the time)
  const abroad = new Map(); // cc -> {visits (trips), cities:Set}
  for (const t of trips) {
    if (!t.abroad) continue;
    const e = abroad.get(t.cc) || { visits: 0, cities: new Set() };
    e.visits++;
    for (const v of t.visits) e.cities.add(v.city.id);
    abroad.set(t.cc, e);
  }
  const topCountries = [...abroad.entries()]
    .map(([cc, e]) => ({ cc, visits: e.visits, cities: e.cities.size }))
    .sort((a, b) => b.visits - a.visits || b.cities - a.cities)
    .slice(0, 5);

  return {
    visits: visits.length,
    trips: trips.length,
    cities: cityMap.size,
    countries: countryMap.size,
    continents: [...continentSet].sort(),
    worldPct: (countryMap.size / WORLD_COUNTRIES) * 100,
    years: yearList,
    busiest,
    first: sorted[0] || null,
    latest: sorted[sorted.length - 1] || null,
    extremes,
    fromHome,
    topCities,
    topCountries,
    topCountriesAbroadOnly: homes.length > 0,
    returnCities: [...cityMap.values()].filter((e) => e.count > 1).length,
    us: usStatesVisited(visits),
  };
}
