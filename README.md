# Travel Map

A lean, single-page web app for marking the cities you've visited (with month and year) on a world map and seeing summary stats about your travels.

## Features

- **Map:** flat world map; visited countries shaded, a pin per city (bigger pin = more visits). Your current home is a solid ⌂; past homes are lighter outlined ⌂ markers.
- **Add visits:** search by city name (about 34,000 cities with population over 15,000), or click the map to pick the nearest city. Each visit is stored separately, so return trips count.
- **Stats:** countries, cities and continents, % of the world's 195 countries, visits per year chart, busiest year, first and latest trip, farthest north/south/east/west, farthest from home, total round-trip distance, your homes, and most-visited cities and countries.
- **Home cities:** **⋯ → Home cities** lets you list every place you've lived with the years you lived there. Only one can be current; adding a new current home moves the old one to your past homes. Distance stats measure each trip from the home you had that year, and visits to the city you lived in at the time don't count as trips.
- **Time filter:** limit the map and stats to a year or a range of years.
- **Your data stays yours:** saved in your browser (localStorage). Use **⋯ → Download backup** to save a file and **Restore from backup** to load it on another device.
- **Share:** **⋯ → Share my map** makes a read-only link with your trips encoded in it (no server involved).

## Running it

It's a static site with no build step and no server code. Serve the folder with any static web server, for example:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk won't work, because browsers block loading the data files from `file://`.

### Hosting on GitHub Pages

Repository **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**, then pick the branch and the `/ (root)` folder and save. The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

## Project layout

```
index.html          page structure
css/style.css       styling (desktop + phone)
js/app.js           map, dialogs, rendering, backup/restore
js/stats.js         stat calculations (no DOM)
js/share.js         compact encoding for share links
data/               cities, countries, and world outlines (generated)
vendor/leaflet/     Leaflet 1.9.4 map library
scripts/build_data.py  regenerates data/ from the original sources
```

## Data sources

- Cities: [GeoNames](https://www.geonames.org/) `cities15000` (CC BY 4.0)
- Country outlines: [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 countries (public domain)
- Map library: [Leaflet](https://leafletjs.com/) (BSD-2-Clause)
