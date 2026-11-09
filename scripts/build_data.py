#!/usr/bin/env python3
"""Builds the compact data files used by the app.

Inputs (download into a folder and pass it as the first argument):
  https://download.geonames.org/export/dump/cities15000.zip   (unzipped -> cities15000.txt)
  https://download.geonames.org/export/dump/countryInfo.txt
  https://download.geonames.org/export/dump/admin1CodesASCII.txt
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson

Outputs (written to ../data):
  cities.json     [[geonameId, name, admin1Name, countryCode, lat, lon, population], ...]
  countries.json  {countryCode: [name, continentCode]}
  world.geojson   country outlines with a single "cc" property, coordinates rounded
  us-states.geojson  US state (+ D.C.) outlines with a single "name" property
"""
import json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(out, exist_ok=True)

# Countries
countries = {}
for line in open(os.path.join(src, "countryInfo.txt"), encoding="utf-8"):
    if line.startswith("#"):
        continue
    f = line.rstrip("\n").split("\t")
    countries[f[0]] = [f[4], f[8]]

# Admin1 (state / region) names
admin1 = {}
for line in open(os.path.join(src, "admin1CodesASCII.txt"), encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    admin1[f[0]] = f[1]

# Cities
cities = []
for line in open(os.path.join(src, "cities15000.txt"), encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    cc = f[8]
    if cc not in countries:
        continue
    cities.append([
        int(f[0]), f[1], admin1.get(f"{cc}.{f[10]}", ""), cc,
        round(float(f[4]), 3), round(float(f[5]), 3), int(f[14] or 0),
    ])
cities.sort(key=lambda c: -c[6])
with open(os.path.join(out, "cities.json"), "w", encoding="utf-8") as fh:
    json.dump(cities, fh, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(out, "countries.json"), "w", encoding="utf-8") as fh:
    json.dump(countries, fh, ensure_ascii=False, separators=(",", ":"))

# World outlines
def ring(r):
    res = []
    for x, y in r:
        p = [round(x, 2), round(y, 2)]
        if not res or res[-1] != p:
            res.append(p)
    return res if len(res) >= 4 else None

def geom(g):
    if g["type"] == "Polygon":
        polys = [g["coordinates"]]
    else:
        polys = g["coordinates"]
    newp = []
    for poly in polys:
        rings = [ring(r) for r in poly]
        if rings[0]:
            newp.append([r for r in rings if r])
    return {"type": "MultiPolygon", "coordinates": newp}

gj = json.load(open(os.path.join(src, "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
feats = []
for ft in gj["features"]:
    p = ft["properties"]
    cc = p.get("ISO_A2_EH") or p.get("ISO_A2")
    if not cc or cc == "-99":
        cc = p.get("ISO_A2")
    if not cc or cc == "-99":
        continue
    feats.append({"type": "Feature", "properties": {"cc": cc}, "geometry": geom(ft["geometry"])})
with open(os.path.join(out, "world.geojson"), "w") as fh:
    json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
# US states
gj = json.load(open(os.path.join(src, "ne_50m_admin_1_states_provinces.geojson"), encoding="utf-8"))
states = [
    {"type": "Feature", "properties": {"name": ft["properties"]["name"]}, "geometry": geom(ft["geometry"])}
    for ft in gj["features"] if ft["properties"].get("iso_a2") == "US"
]
with open(os.path.join(out, "us-states.geojson"), "w") as fh:
    json.dump({"type": "FeatureCollection", "features": states}, fh, separators=(",", ":"))
print(f"{len(states)} US states")
print(f"{len(cities)} cities, {len(countries)} countries, {len(feats)} outlines")
