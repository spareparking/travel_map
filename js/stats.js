// Pure stat calculations. No DOM here, so it can be tested on its own.

export const WORLD_COUNTRIES = 195; // UN members + 2 observer states
export const EARTH_CIRCUMFERENCE_KM = 40075;

export const CONTINENTS = {
  AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe',
  NA: 'North America', OC: 'Oceania', SA: 'South America',
};

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

/**
 * @param {Array} visits    visits to summarise (already filtered). Each: {id, y, m, city:{id,name,cc,lat,lon}}
 * @param {Array} allVisits every visit, used to decide when a place was first visited
 * @param {Object} ctx      {home: city|null, countries: {cc: [name, continent]}}
 */
export function computeStats(visits, allVisits, ctx) {
  const { home, countries } = ctx;
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

  // Per year
  const years = new Map();
  for (const v of visits) {
    const y = years.get(v.y) || { year: v.y, visits: 0, newCities: 0, newCountries: 0 };
    y.visits++;
    if (firstCity.get(v.city.id) === v.id) y.newCities++;
    if (firstCountry.get(v.city.cc) === v.id) y.newCountries++;
    years.set(v.y, y);
  }
  const yearList = [...years.values()].sort((a, b) => a.year - b.year);
  let busiest = null;
  for (const y of yearList) if (!busiest || y.visits > busiest.visits) busiest = y;

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

  // Home distances (ignore visits to the home city itself)
  let fromHome = null;
  if (home) {
    const away = visits.filter((v) => v.city.id !== home.id);
    let farthest = null;
    let total = 0;
    for (const v of away) {
      const d = distanceKm(home, v.city);
      total += 2 * d;
      if (!farthest || d > farthest.km) farthest = { city: v.city, km: d };
    }
    fromHome = {
      farthest,
      roundTripKm: total,
      aroundEarth: total / EARTH_CIRCUMFERENCE_KM,
      averageKm: away.length ? total / 2 / away.length : 0,
      trips: away.length,
    };
  }

  // Favourites
  const topCities = [...cityMap.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, 5);
  const topCountries = [...countryMap.values()]
    .map((c) => ({ cc: c.cc, visits: c.visits, cities: c.cities.size }))
    .sort((a, b) => b.visits - a.visits || b.cities - a.cities)
    .slice(0, 5);

  return {
    visits: visits.length,
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
    returnCities: [...cityMap.values()].filter((e) => e.count > 1).length,
  };
}
