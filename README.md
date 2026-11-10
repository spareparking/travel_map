# Travel Map

A lean, single-page web app for marking the cities you've visited (with month and year) on a world map and seeing summary stats about your travels.

## Features

- **Map:** flat world map; visited countries shaded (the US is divided into states and only visited states are shaded), a pin per city (bigger pin = more visits). Your current home is a solid ⌂; past homes are lighter outlined ⌂ markers.
- **Add visits:** search by city name (about 34,000 cities with population over 15,000), or click the map to pick the nearest city. Each visit is stored separately, so return trips count.
- **Places not in the built-in list:** the last suggestion is always *"Not listed? Search online"*, which looks the place up on [OpenStreetMap](https://www.openstreetmap.org/) (via the free Nominatim service). Nothing is sent online unless you choose that row. Places you pick are saved with your data, included in backups and share links, and show up in future searches without going online.
- **Stats:** countries, cities and continents, % of the world's 195 countries, US states visited (of 50, with D.C. noted separately), visits per year chart, busiest year, first and latest trip, farthest north/south/east/west, farthest from home, total round-trip distance, your homes, and most-visited cities and countries.
- **Home cities:** **⋯ → Home cities** lets you list every place you've lived with the years you lived there. Only one can be current; adding a new current home moves the old one to your past homes. Distance stats measure each trip from the home you had that year, and visits to the city you lived in at the time don't count as trips.
- **Time filter:** limit the map and stats to a year or a range of years.
- **Cloud save (Google sign-in):** trips are always saved in the browser, and when you sign in with Google they're also saved to your own Firestore document and kept in sync across devices. If a browser clears its data, sign in again and everything comes back. The first sign-in on a device that already has trips combines them with the cloud copy. Changes made offline are uploaded when you're back online.
- **Backups:** **⋯ → Download backup** saves a file; **Restore from backup** loads one.
- **Share:** **⋯ → Share my map**. Signed in: a short link (`#m=…`) to a read-only copy of your map that updates as you add trips, with **Stop sharing** to turn it off. Signed out: a longer snapshot link with the trips packed into it (`#s=…`).

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
js/cloud.js         Google sign-in + Firestore sync
js/firebase-config.js  Firebase project settings (set to null to turn cloud save off)
data/               cities, countries, and world outlines (generated)
vendor/leaflet/     Leaflet 1.9.4 map library
scripts/build_data.py  regenerates data/ from the original sources
```

## Data sources

- Cities: [GeoNames](https://www.geonames.org/) `cities15000` (CC BY 4.0)
- Online place search: [Nominatim](https://nominatim.org/) / © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- Country outlines: [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 countries (public domain)
- Map library: [Leaflet](https://leafletjs.com/) (BSD-2-Clause)

## Cloud save setup (Firebase)

1. Create a Firebase project and enable **Authentication → Sign-in method → Google**.
2. Add the site's domain under **Authentication → Settings → Authorized domains**.
3. Create a **Firestore** database (production mode) with these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /shares/{shareId} {
      allow get: if true;
      allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
      allow update: if request.auth != null && resource.data.owner == request.auth.uid
                    && request.resource.data.owner == request.auth.uid;
      allow delete: if request.auth != null && resource.data.owner == request.auth.uid;
    }
  }
}
```

4. Register a Web app and paste its config into `js/firebase-config.js`.

Each user's data lives in one document at `users/{uid}`. A share link (`#m=<id>`) points to a public, read-only copy at `shares/{id}` that its owner keeps up to date; anyone with the link can read it (`get` only, so shares can't be listed).
