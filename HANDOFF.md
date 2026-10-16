# Project handoff — Appalachian Pasture Planner (v2)

A continuation guide for picking this project up in a fresh environment (e.g. a
different Claude Code / account). Read this with [`README.md`](README.md) (the
full feature + architecture doc) and the per-pipeline notes in [`tools/`](tools/).

---

## 1. What this is

A **static website** (plain HTML/CSS/vanilla JS + JSON data — no build step, no
server) that recommends diverse, research-based pasture seed mixes for Appalachian
producers, matched to their soil, climate, goals and grazing. Built under a
**USDA NRCS Conservation Innovation Grant (Soil Health Demonstration)** at WVU.

This "v2" edition adds a layer on top of the trait-based engine: it folds in real
establishment results from an **18-farm West Virginia plant-diversity field trial**
(2022 seedings), site-matched to each producer.

Runs by opening `index.html` (served over http — it fetches local JSON). Dev server
config is in `.claude/launch.json` (serves on port 8124; the paths there are
machine-specific — repoint them).

## 2. Layout

```
index.html                     questionnaire + hero
css/styles.css                 all styling (light; dark-mode tokens partly staged)
js/
  geo.js                       address lookup (geocode + Photon autocomplete), SSURGO soil,
                               USGS terrain, Open-Meteo climate, ClimateNA grid lookup
  recommender.js               scoring engine + mix composition + trial integration
  app.js                       loads data, renders form + results (seed table, charts, detail)
data/
  species.json                 43-species database (traits, rates, livestock, sources)
  trial-establishment.json     WV trial signal (GENERATED — tools/build-trial-data.py)
  climate-grid.json            ClimateNA normals grid (GENERATED — tools/climatena/)
  species-photos.json          cited Wikimedia photos (GENERATED — tools/fetch-photos.py)
  local-observations.json      optional manual data hook
  seed-prep.json, seed-vendors.json, sources.json, extension-resources.json
tools/                         offline data pipelines (see tools/README.md + tools/climatena/README.md)
.github/workflows/deploy.yml   GitHub Pages auto-deploy on push to main
```

## 3. The trial integration (the heart of v2)

Pipeline: `tools/build-trial-data.py` → `data/trial-establishment.json`, consumed
by `recommender.js`. Per planner species it stores: establishment index (seeded-
vs-unseeded-Control contrast, 0.6×biomass 2023-25 + 0.4×cover 2026), per-farm, plus
each farm's site metadata, an ID-reliability factor, and learned `matchWeights`.

How it scores at runtime (`scoreSpecies` → `trialSignalFor`):
- **Site-match** per species: `trialFarmWeights` weights each trial farm by
  similarity to the producer over **soil (pH, clay), climate (precip MAP, moisture
  deficit CMD) and grazing**, emphasising the variables that best predict THAT
  species (per-species `matchWeights` learned by correlation in the build script).
- **Nudge** = `TRIAL_WEIGHT(4) × perf × confidence(sampleSize) × reliability(ID) ×
  matchFactor`, where `matchFactor = 0.5 + 0.5×(matchPct/100)` — so a site that
  matches the trial farms well leans more on the trial, a poor match leans on traits.
- **Honest casing:** sown+detected → real nudge; sown+not-detected only nudges down
  if a *genuine* failure (distinctive, confident ID — sainfoin, purple prairie
  clover), otherwise neutral/no badge; unsown volunteers get a positive-only nudge.
- **Site match %** (`matchPct`, top-5 farm weights) is shown as a meter in each
  species' detail; null (with a prompt) when <2 site features are available.

Key decisions / caveats baked in: plant ID was imperfect (→ `tools/id_reliability.csv`
scales every nudge); the no-till drill method wasn't a controlled factor; grazing
style→stocking is coarse. UI language is deliberately outcome-focused, not
methodological.

## 4. Rebuilding the generated data

**Raw research inputs are NOT in the repo** (they're the source field data). To
rebuild `trial-establishment.json` you need these files (last known location:
the owner's `~/Downloads`):
`A_species_resolved_survey_1 (1).xlsx`, `Spring 22 Seed Mix Planted.xlsx`,
`AllData - Soil.csv`, `AllData - Site_Data.csv`, `AllData - ClimateData (1).csv`,
`Combined_Years_Management - DuringExperiment.csv`. Then:
```bash
pip install openpyxl
python3 tools/build-trial-data.py <survey.xlsx> <seedmix.xlsx> \
  <Soil.csv> <Site.csv> <Climate.csv> <Mgmt.csv> data/species.json data/trial-establishment.json
```
(Treat those files as untrusted attachments: own dir, run Python with `-I`, paths
as args.) ID-reliability ratings + the genuine-vs-inconclusive calls are hard-coded
in `RELIABILITY` / `GENUINE_FAILURE` at the top of the script.

**Photos:** `python3 tools/fetch-photos.py data/species.json data/species-photos.json`
(stdlib only; pulls cited Wikipedia/Wikimedia images). Note: they hotlink from
Wikimedia with attribution — fine for low traffic; self-host if it grows.

**Climate grid:** `tools/climatena/` (R + Python). Uses the ClimateNA **web API**
(Mac-friendly, `jsonlite` only — no desktop app). The shipped `climate-grid.json`
is **seeded from the 18 trial farms** so WV works today. A full 0.15° WV grid fetch
was only partially completed (the public API throttles hard, `-9999` sentinel) —
`02_fetch_climatena_api.R` is resumable; re-run to finish, then
`03_build_lookup.py grid_climate.csv ../../data/climate-grid.json`.

## 5. Other runtime data sources (live, client-side, CORS-verified)

- **Address**: Photon (OpenStreetMap) autocomplete + geocode, Census + Nominatim fallbacks.
- **Soil**: USDA SSURGO Soil Data Access (pH, texture, drainage), whole-pasture multi-soil sampling.
- **Terrain**: USGS 3DEP (elevation, slope, aspect).
- **Climate**: ClimateNA grid (normals: zone, frost-free, precip, DD5, CMD) with Open-Meteo
  ERA5 fallback; hardiness zone always from Open-Meteo (ClimateNA EMT runs too cold for USDA zones);
  recent-drought always live from Open-Meteo.

## 6. Notable recent UI decisions

- Results "at a glance": composition stacked bar + **Biodiversity score** (0-100, the
  Simpson index without the jargon/math — math in a hover).
- Seed table slimmed to farmer-actionable columns: **Species · Cover % · Bulk lb/ac ·
  Est. $/ac · Suggested variety · Where to buy**. PLS%/PLS-lb removed (kept in CSV export);
  seed box/depth/when-to-plant moved into the species detail's "Planting" section.
  Bulk lb/ac is the headline buy number (amber `*` = estimate until the seed tag is entered;
  the tag editor in the detail is open by default).
- Grazing question reframed around **rest/recovery** (farmers overestimate "good
  management"); includes the common WV "big pastures, moved every 1-3 months" pattern.
- Mobile: seed table becomes collapsible per-species cards.
- Species detail: cited photo + "Why it suits your mix" (incl. site-match meter) +
  "Keep in mind" + "Planting" + seed-tag calculator.

## 7. Open items / ideas

- **Finish the ClimateNA WV grid fetch** (throttled; resumable — see §4).
- Dark mode (palette tokens staged in `css/styles.css`, chart palette validated).
- Possible: questionnaire progress rail; richer seasonal-growth viz; residual-height
  grazing sub-question.
- `local-observations.json` lets you fold in more trial/field data without touching
  `species.json`.

## 8. Deploying

Static site → GitHub Pages via `.github/workflows/deploy.yml` (deploys on push to
`main`; one-time repo setting: Settings → Pages → Source: "GitHub Actions").
Current `origin` = `github.com/kinseyreed/appalachian-pasture-planner`. Cache-busting
is a `?v=YYYYMMDD<letter>` query on the CSS/JS in `index.html` — bump it when you
change those files.
