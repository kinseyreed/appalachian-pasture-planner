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
│   ├── species.json              Forage/native species database (46 species: traits + sources)
│   ├── seed-prep.json            Per-species seeds/lb, PLS, depth, seed box, price, varieties, sources
│   ├── seed-vendors.json         Reputable seed-supplier registry
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

## Seasonal strategy, mix composition & the seed table

Before building a mix, the farmer picks a **growth pattern** — cool-season (spring/fall), warm-season (summer), or a **year-round mix** (a cool + warm blend for moderate growth with no big flushes). This filters which species are eligible and, for the year-round option, pairs a cool-season and a warm-season grass.

**Site conditions are asked once.** Acidity, wetness, droughtiness and slope are *derived* from the pH, drainage and mapped-terrain answers rather than asked again as "challenges". In their place, a **soil fertility & structure** step takes actual soil-test values (P, K, organic matter) — or a *"I don't know my soil fertility"* option that assumes typical values for the soil type and land use (using SSURGO organic matter when the map lookup has run) — plus a **soil texture** selector (light / loam / heavy clay — pre-filled from SSURGO clay content when the map lookup runs) and a **compaction** slider. Texture drives species fit (heavy clay suits tall fescue, alsike and strawberry clover; it rules out alfalfa and sainfoin) and seeding depth; compaction favors deep-rooted species.

**Priorities are 0–7 importance sliders.** Instead of on/off goal and challenge checkboxes, the farmer slides each factor (including **stand longevity**) from 0 (not a priority) to 7 (top priority), and species are ranked in proportion ([`scorePriorities`](js/recommender.js)). Grazing management has **five levels** (continuous heavy/light, rotational-but-overgrazed, well-managed rotational, mob) that set a grazing-pressure weight, and **seeding method is multi-select** (e.g. drill in fall *and* frost-seed clover in late winter).

Every result includes an **interactive seed-mix table** ([`buildSeedTableSection`](js/app.js) + [`buildSeedPlan`](js/recommender.js)) that turns the chosen species into a buy-and-plant plan. Click a species name for its full details (summary, strengths, cautions, why-it-was-picked, sources); click ✕ to remove it; or **+ Add a species** from the full lookup list — rates and composition recompute automatically.

- **Diversity controls** — a live panel reports **species richness**, **Simpson's index of diversity** (D = 1 - sum(p^2) over groundcover shares) and the **effective number of species** (1 / sum(p^2)), with a plain-language definition. A richness stepper adds the next best-suited species (keeping the grass/legume/forb balance) or drops the weakest; an evenness slider spreads cover equally versus concentrating it in the top performers, and the indices update live.
- **Editable per-species rates** — any species' PLS lb/ac can be typed directly. Pinned rates are honoured exactly and the unpinned species share the remainder, so the table always adds up to the stated total. **Groundcover is always back-calculated from the rates actually in the table** (rate / pure-stand rate), so composition, Simpson diversity and effective species all move the moment anything is edited.
- **Save, reopen and export** — *Save plan* writes a small `.json` (mix, rates, seed tags, evenness, answers) that *Open saved plan* restores exactly, so a producer can plan now and come back once the seed arrives to enter tag data. *Download for Excel (CSV)* writes the table with a summary header and a purity/germination column. Everything is file-based: nothing is uploaded and nothing is stored in the browser, so the privacy promise still holds.
- **Editable PLS from your seed tag** — open any species in the table and type the purity and germination printed on the bag you actually ordered. PLS%, bulk pounds and cost recompute instantly (e.g. an 85% x 70% tag = 59.5% PLS, so 6.1 lb PLS/ac needs 10.3 bulk lb/ac).
- **Liming and fertility, with working calculators** — the lime step explains that established sod only responds to lime in the top ~2 inches, so West Virginia's pasture/hayland pH target (6.0+) is judged at that shallow depth rather than the deeper target used for tilled ground; it links WVU's **Ag Limestone Tool** (compare lime products by Effective Neutralizing Value) and the **pelleted-lime guidance** for steep or small fields where bulk spreading isn't practical. The fertility step links WVU's **Fertility Recommend Tool** and **Forage Fertilization Worksheet** (downloadable spreadsheets), the **Blended Fertilizer Calculator** for mixing straight materials to a soil-test recommendation, and a guide to reading the soil test report itself.
- **Livestock-aware**: pick the classes that will graze (beef, dairy, sheep, horses, goats). Species toxic to a class are excluded (e.g. alsike clover for horses), well-suited ones favored (timothy/meadow fescue for horses; tannin legumes & browse forbs for sheep/goats), per-class cautions surface in the species detail, and a horse selection shifts the whole mix grass-leaning (~62/20/18) to reduce founder risk.
- **No-lime / no-fertilizer options**: the mix shifts to acid-tolerant and nitrogen-fixing/low-input species, and the plan explains the trade-offs.
- **Toxic-species cover caps**: species that are harmful in quantity carry a hard groundcover cap (partridge pea 8%, alsike 15%, sweetclovers 20%); the allocation water-fills around the cap and the table flags it.
- **Editable table**: change any species' groundcover % or its PLS % directly (in addition to entering seed-tag purity/germination); rates, cost and diversity update live.
- **Per-seeding breakdown**: instead of leaning on one total, the table groups species into the separate seedings they're actually applied in (late-winter frost-seed, fall drill, spring drill), each with its own bulk-lb total, per-box split, and cost.
- **Soil texture triangle**: place a pin on the USDA texture triangle (or let the soil map set it) to get the texture name and class.
- **USDA hardiness zone** replaces the old elevation question and auto-fills from the location lookup.
- **Seedbed & herbicide guidance** with tillage-vs-no-till risk/benefit, slope/compaction suitability, glyphosate burndown and spray-smother-spray, and herbicide grazing/replant-restriction cautions.
- **How to soil-test properly** (zig-zag cores, 2-inch sod depth) and **inline diagrams** (crosshatch two-pass seeding; seeding depth). Establishment steps are collapsible.
- **A custom establishment plan** replaces generic guidance cards: a numbered, ordered set of steps written for this mix, this soil and the chosen seeding methods — lime and fertility targets, seedbed prep, what to seed when by method, drill depth and calibration, splitting the mix between boxes, inoculation, native-seed handling, first-year management, and grazing advice matched to the selected grazing level. A dedicated step covers **equipment calibration** for whichever method(s) are chosen: the bag/catch-weight procedure for drills (measured 60 ft, catch and weigh seed from a few openings, scale to lb/acre, adjust and repeat) and the catch-pan procedure for broadcast spreaders, plus the crosshatch technique - splitting the seed and making two passes at right angles - for both drilling and broadcasting, which is the standard fix for the streaks and skips uneven equipment leaves behind. It also covers the firm-seedbed footprint test, texture-adjusted seeding depth, press wheels, first-year weed control (weeds shade out seedlings; clip — but not too early), the mow/regrow/tug-test sequence before first grazing, the "sleep, creep, leap" second-year caution, and regrowth-based rest periods (graze again at 8-10 in; ~21-30 days spring, 35-45+ days midsummer). Sources: WVU Extension (soil fertility, the Ag Limestone Tool, the Blended Fertilizer Calculator, the soil-test-report guide, and pelleted-lime guidance), Penn State (forage P/K maintenance and spreader calibration), Maryland Dept. of Agriculture/UMD Extension, Mississippi State, UT Beef & Forage Center, University of Florida IFAS Extension and UK Master Grazer.
- **Composition by estimated groundcover** — the mix targets ~**50% grass / 35% legume / 15% forb groundcover**, back-calculated from each species' seeding rate relative to a pure (monoculture) stand (`cover ∝ rate ÷ mono-rate`). It updates whenever you add, remove, or re-rate species.
- **PLS math** — from `seed-prep.json` each species carries typical purity and germination; the table shows **PLS lb/ac** (what you're targeting), **bulk lb/ac** (`PLS ÷ (purity×germ)` — what you actually weigh out and buy), computed with the UT PB1752 formula.
- **Total seeding rate, derived not guessed** — the recommended total is computed from the mix itself as sum(cover share x that species' pure-stand rate), i.e. the seed needed to deliver about one full stand with each species holding its target share of the ground. It updates whenever species change, and the UI explains both where it comes from and why it matters (too light leaves gaps for weeds; too heavy is seed competing with itself; add ~50% for broadcasting). The producer can override it, or reset to the recommendation.
- **Variety, seed box, depth, planting window** — suggested cultivars (e.g. novel-endophyte fescue, low-alkaloid reed canarygrass, upland switchgrass), which drill box each species goes in, seeding depth, and the planting date window.
- **Reputable sources + estimated cost** — each species links to suppliers (native species → Ernst/Roundstone/Bamert/Prairie Moon; forages → Barenbrug/DLF-Seedway/King's/co-ops), with an estimated `$/ac` range.
- **"Filling your drill boxes"** — species are grouped by seed box with total bulk pounds, so the farmer knows exactly what to weigh and combine.

### About the estimates
Prices in `seed-prep.json` are **rough 2026 planning figures in $/PLS-lb** and varieties/purity/germination are typical defaults — seed prices swing widely by year, vendor, and volume, and native seed especially. They live in their own file precisely so you can drop in your real quotes and tags without touching anything else. Confirm current pricing and **regional ecotypes** with the suppliers before buying.

### Species coverage (43 species)
Reed canarygrass was removed as an aggressive/invasive wetland species (WVDNR documents it escaping into WV wetlands); bermudagrass and forage crabgrass were dropped as well; sericea lespedeza was never included. **Tall fescue is gated**: it is only suggested where the ground is genuinely difficult (two or more severe soil constraints - strongly acidic, wet, very low fertility, compacted, heavy clay, or steep), because on decent soil it crowds out more palatable and more diverse options. The database spans introduced forages **and** natives, with an emphasis on species native to Appalachia. Highlights added for this: native warm-season grasses (little bluestem, sideoats grama + existing big bluestem/indiangrass/switchgrass/gamagrass); **native cool-season grasses** (Virginia wildrye/PA ecotype, Canada wildrye, bottlebrush grass); native legumes (purple prairie clover, Illinois bundleflower, showy tick-trefoil, slender/Virginia lespedeza, partridge pea); native forbs (Maximilian & oxeye sunflower, gray-headed coneflower, lanceleaf coreopsis); and introduced options requested (sainfoin, kura clover, balansa clover, strawberry clover, white/yellow sweetclover, intermediate wheatgrass/Kernza, a perennial×Italian ryegrass blend, small burnet, plus meadow fescue). The `native` flag is on each record. Species data draws on UT Extension **PB1752** (native grasses, PLS, seeding), USDA-NRCS plant guides, and Extension forage references.

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
