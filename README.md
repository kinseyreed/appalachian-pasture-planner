# Appalachian Pasture Planner (APP)

An open-access, interactive tool that helps Appalachian cattle producers design **diverse, research-based seed mixes** for their permanent pastures — matched to their soil, conditions, goals, and resources at hand. It pairs each suggestion with pasture-renovation and grazing-management guidance and cites its sources.

Developed under a **USDA NRCS Conservation Innovation Grant (Soil Health Demonstration)**. Inspired by the Beef Cattle Research Council's [Forage U-Pick](https://www.beefresearch.ca/tools/forage-u-pick/) tool.

The app is a **static website** — plain HTML, CSS, and JavaScript with JSON data files. No build step, no server, no dependencies. It runs anywhere static files are served, and is set up to deploy to **GitHub Pages** automatically.

---

## How it works

1. The producer answers six short questions (location/elevation, soil pH, drainage, goals, challenges, seeding & grazing method).
2. Every species in the database is scored against those answers by a transparent rules engine ([`js/recommender.js`](js/recommender.js)).
3. The engine composes a balanced mix — a base grass or two, one or two legumes, and a forb for diversity, plus an optional warm-season paddock — and explains *why* each species was chosen.
4. Results include seeding rates, management/establishment tips, and a source list.

Nothing is hidden: the scoring factors and the data behind them are all in editable files.

---

## Project structure

```
appalachian-pasture-planner/
├── index.html                    Main page + questionnaire markup
├── css/styles.css                Styling
├── js/
│   ├── geo.js                    Address → soil/elevation/climate lookup (client-side)
│   ├── recommender.js            Scoring + mix-composition engine (the "brain")
│   └── app.js                    Loads data, renders the form and results
├── data/
│   ├── species.json              Base forage species database (traits + sources)
│   ├── sources.json              Citation registry
│   ├── extension-resources.json  Management/bulletin cards keyed to goals & challenges
│   └── local-observations.json   >>> YOUR West Virginia trial data goes here <<<
└── .github/workflows/deploy.yml  Auto-deploy to GitHub Pages
```

---

## Deploying to GitHub Pages

1. Create a new GitHub repository and push this folder to the `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Push to `main`. The included workflow publishes the site; your URL will be
   `https://<your-username>.github.io/<repo-name>/`.

That's it — every later push to `main` redeploys automatically.

### Running it locally

Because the app loads JSON with `fetch`, opening `index.html` directly (`file://`) won't load the data in some browsers. Serve it over a local web server instead:

```bash
cd appalachian-pasture-planner
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Location lookup (address → whole-pasture soils, terrain, climate)

The optional **"Find your land"** card at the top lets a producer find their field on a **satellite map**, then reads the land under it and pre-fills the questionnaire. Everything runs **in the browser** — there is no backend — so each service had to permit cross-origin requests. The ones used are:

| Layer | Source | What it fills |
|---|---|---|
| Address → coordinates | [OpenStreetMap Nominatim](https://nominatim.org) | positions the map |
| Map / imagery | [Leaflet](https://leafletjs.com) + [Esri World Imagery](https://www.esri.com) | lets the farmer place the pin / draw the field |
| Soil across the field (pH, drainage, slope, all map units) | [USDA-NRCS SSURGO / Web Soil Survey](https://websoilsurvey.nrcs.usda.gov) via Soil Data Access | pH band, drainage, "acidic"/"steep" flags, and targeted problem-area picks |
| Elevation, slope, aspect | [USGS 3DEP Elevation Point Query Service](https://www.usgs.gov/3d-elevation-program) | elevation → "higher/colder" flag; **aspect → drought scoring** |
| Climate normals + recent conditions | [Open-Meteo](https://open-meteo.com) (ERA5) | hardiness zone, frost-free days, annual rainfall, **recent drought** |

Implementation is in [`js/geo.js`](js/geo.js). Each layer is **best-effort and fails soft**: if a service is down or a point has no data, that field is simply left for the farmer to fill in, and the other layers still work.

### Reading the whole pasture, not one point
A geocoded address usually lands on the **house or barn**, and Appalachian pastures routinely span several soil series across a slope. So instead of querying one point:

1. The farmer **drags the pin onto the actual pasture** (or draws the field boundary for precision) on satellite imagery.
2. The app **grid-samples the field** and asks Soil Data Access for the map unit at every sample point in a **single query**, giving an area-weighted composition of all the soils present (e.g. "Gilpin 55%, Buchanan 25%, Lily 20%").
3. It builds a **pasture profile**: the dominant/area-weighted pH and drainage, the pH range, and which extremes (wet toeslopes, very acidic knobs, droughty ridges) occupy a minority of the field.

The results then come in **two tiers** ([`recommendPasture`](js/recommender.js)):
- a **whole-pasture base mix** tuned to the dominant conditions and any field-wide variability, and
- **targeted add-ins for problem sub-areas** — e.g. "Wet / poorly drained spots (~15%): reed canarygrass, alsike clover" — but only when a sub-area differs enough from the rest that the base mix doesn't already cover it.

### Aspect and recent drought in the scoring
Two continuous, map-derived signals feed the scoring engine (`buildContext` in [`js/recommender.js`](js/recommender.js)):
- **Aspect** — south/southwest-facing ground is warmer and drier, north/northeast cooler and moister. The effect scales with slope steepness (it barely matters on flat ground). A steep SW slope pulls the mix toward drought-tolerant species; a steep NE slope toward moisture-lovers.
- **Recent drought** — the last ~90 days of rainfall are compared to the 1991–2020 normal for the same window; a shortfall nudges the mix toward drought-resilient species and is shown to the farmer ("58% of normal — leaning the mix toward drought resilience").

### Privacy
- The typed address is sent **once** to the geocoder to get coordinates, then discarded. Only latitude/longitude go to the soil/elevation/climate services.
- **Nothing is stored** — no cookies, no `localStorage`, no analytics, and nothing is ever sent to this app's own server (there isn't one).
- The "Use my location" button uses the browser's geolocation so no address is typed or sent to any geocoder at all.

### Values are estimates, not a soil test
Auto-filled answers are **map-unit representative values** (e.g., SSURGO surface pH is the dominant soil's typical value for that map unit, not a lab test of the farmer's field). They are shown with 📍 "from map" markers and a reminder to confirm pH with a real soil test. Per the design decision, they **pre-fill** the questionnaire and remain fully editable — they never silently drive the results.

### About ClimateNA
The grant references downscaled climate from **ClimateNA**. ClimateNA is a desktop/batch application with **no browser-callable API**, so it cannot be queried live from a static site. Open-Meteo's ERA5 normals are used as the live substitute for the climate variables that actually gate forage choice (winter hardiness, growing-season length, rainfall). If you later want ClimateNA's specific bioclimatic variables, they can be added the same way as trial data — export ClimateNA point values and fold them in (a future `climate-overrides` hook, mirroring `local-observations.json`).

### Notes for production
- **Nominatim usage policy** asks for ≤1 request/second and light use; that's fine for a low-traffic extension tool. If APP gets heavy traffic, swap in a dedicated geocoder (e.g., a keyed Census/Mapbox endpoint or a small proxy).
- To **disable** the lookup entirely, delete the `.lookup-card` section from `index.html`; the manual questionnaire works on its own.

## Adding your own data

This is built so **you never edit the base database** to add your findings. All of your data lives in [`data/local-observations.json`](data/local-observations.json), which is layered on top of `species.json` at runtime. There are three ways to contribute data, and you can use any combination:

### 1. Establishment / performance observations
Nudge a species up or down in the rankings based on how it actually did, and show a trial badge in the results.

```json
{
  "speciesId": "orchardgrass",
  "establishmentSuccess": 0.82,
  "conditions": { "phMin": 5.5, "phMax": 6.5, "drainage": ["well", "moderate"], "region": "north-central-wv" },
  "note": "Strong first-year establishment on well-drained ridgetop sites.",
  "enabled": true
}
```

- `establishmentSuccess` is `0`–`1`. Above `0.5` boosts the species' score; below `0.5` lowers it. (Internally: `adjustment = (value − 0.5) × 4`.)
- `conditions` is optional. If present, the observation only applies when the producer's answers fall within those pH/drainage bounds — so you can say "orchardgrass did great on well-drained ground but not wet ground."
- When any observation informs a result, the mix shows an **"Informed by West Virginia trial data"** banner and the species gets a trial badge, and your dataset is added to the source list.

### 2. Trait overrides
Replace a specific published trait value with your measured one. Only the fields you list change:

```json
{
  "speciesId": "red-clover",
  "overrides": { "droughtTolerance": 4 },
  "note": "Held better than expected through the 2023 dry spell.",
  "enabled": true
}
```

### 3. Entirely new species
Add species you've tested that aren't in the base database. Use the **same field structure** as an entry in `species.json` (see that file's `_comment` for the schema) and set `"enabled": true`.

### Cite your data
Fill in the `meta.citation` block at the top of `local-observations.json` (title, org, URL/DOI once published). It appears in the results' **Sources** list whenever your data informs a recommendation.

> Every entry has an `enabled` flag. The file ships with disabled examples so the app runs cleanly out of the box; flip `enabled` to `true` (and delete the `_example` keys) when you add real data.

---

## Editing the base species database

`data/species.json` holds one object per species. Scales run 1 (low) to 5 (high). Key fields:

| Field | Meaning |
|---|---|
| `type` / `season` / `lifecycle` | grass/legume/forb · cool/warm · perennial/biennial/annual |
| `phMin`,`phMax`,`phTolerantLow` | productive pH range, plus the lowest pH it will still persist at |
| `drainage` | drainage classes tolerated: `well`, `moderate`, `poor`, `wet` |
| `droughtTolerance`,`floodTolerance`,`grazingTolerance`,`establishmentEase`,`winterHardiness` | 1–5 ratings |
| `fertilityNeed` | `low` / `medium` / `high` |
| `nitrogenFixer` | boolean |
| `seedingRateMix*` / `seedingRateMono*` | lbs pure live seed per acre, in a mix vs. alone |
| `goalsServed` / `challengesFit` | tags matched against the producer's selections |
| `summary`, `strengths`, `cautions` | shown in the result card |
| `sources` | ids from `sources.json` |

To add a management/bulletin card, add an entry to `data/extension-resources.json` with `triggers` (the goal/challenge/method ids that surface it) and `sources`.

---

## Data sources

Trait values and management guidance come from public Extension and USDA-NRCS research, including:

- USDA NRCS Appalachian Plant Materials Center — *[Best Management of Pasture and Hayland Species in Appalachia](https://www.nrcs.usda.gov/plantmaterials/wvpmcra13890.pdf)*
- [West Virginia University Extension — Forage Species](https://extension.wvu.edu/agriculture/pasture-hay-forage/species) and related pasture/soil-fertility/grazing pages
- [Virginia Cooperative Extension — Managing Virginia's Steep Pastures (418-005)](https://www.pubs.ext.vt.edu/418/418-005/418-005.html)
- [Penn State Extension — Successful Forage Crop Establishment](https://extension.psu.edu/successful-forage-crop-establishment), Tall Fescue, and Renovation guides
- [Oregon State University Forage Information System — Tall Fescue pH](https://forages.oregonstate.edu/tallfescuemonograph/suitability/creating/edaphic/ph)
- [Michigan State University Extension — Forage Seeding Rates](https://www.canr.msu.edu/news/forage_seeding_rates_when_seeded_alone_or_in_mixtures)
- [University of Missouri Extension — Birdsfoot Trefoil (G4640)](https://extension.missouri.edu/publications/g4640)
- [USDA NRCS PLANTS Database & Plant Guides](https://plants.usda.gov)

**Location-lookup data services:** [USDA-NRCS SSURGO / Web Soil Survey](https://websoilsurvey.nrcs.usda.gov), [USGS 3DEP elevation](https://www.usgs.gov/3d-elevation-program), [Open-Meteo climate](https://open-meteo.com), [OpenStreetMap Nominatim](https://nominatim.org) geocoding, and [Leaflet](https://leafletjs.com) with [Esri World Imagery](https://www.esri.com) for the map.

Full per-species citations live in `data/sources.json` and are shown with each recommendation.

---

## Disclaimer

This planner offers research-based **starting points**, not a prescription. Site conditions vary field to field. Always confirm species choices with a current soil test and your local NRCS or Extension office before purchasing seed.
