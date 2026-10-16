# ClimateNA precompute → `data/climate-grid.json`

The planner is a **static site**, so it can't query ClimateNA live. Instead we
**precompute** a grid of ClimateNA climate normals offline and ship the result as
a small JSON file the app reads client-side with a nearest-point lookup.

This pipeline uses the **ClimateNA web API** (`https://api.climatena.ca`), which
runs fine on **macOS** — no Windows desktop app, no 188 MB data package, no
`terra`/GDAL. It needs only base R plus **`jsonlite`**. (It's the same endpoint
the official `ClimateNAr::ClimateNA_API()` wraps; we call it directly so there's
nothing heavy to install.)

```
tools/climatena/
├── config.R                 Region bbox, grid step, period, throttle settings
├── 01_build_grid_csv.R      Build the input grid + elevation (Open-Meteo elevation API)
├── 02_fetch_climatena_api.R Fetch ClimateNA normals from the web API (resumable)
├── 03_build_lookup.py       Convert the fetched CSV → ../../data/climate-grid.json
└── README.md                (this file)
```

## What ships today

`data/climate-grid.json` is **seeded from the 20 WV trial farms' own ClimateNA
values**, so West Virginia works immediately. Run the steps below to replace it
with a full gridded normal — the app code doesn't change, only the data file grows.

## Setup (macOS)

```r
install.packages("jsonlite")   # the only dependency
```
Edit **`config.R`** if you want a different `GRID_STEP` or `PERIOD`. The default
region is West Virginia.

## Run (from this `tools/climatena/` folder)

```r
source("01_build_grid_csv.R")        # -> grid_input.csv   (ID1,ID2,lat,long,el)
source("02_fetch_climatena_api.R")   # -> grid_climate.csv (adds MAT,MAP,EMT,FFP,DD5,CMD,...)
```
```bash
python3 03_build_lookup.py grid_climate.csv ../../data/climate-grid.json --source="1991-2020 normal"
```

### Heads-up: the public API is throttled

The ClimateNA web API returns real values in bursts, then a `-9999` "can't serve
right now" sentinel under load. `02_fetch_climatena_api.R` handles this:

- it **retries** each point with backoff (`MAX_RETRIES`, `PAUSE_SEC` in `config.R`),
- it **checkpoints** every 25 points and is **resumable** — rows already in
  `grid_climate.csv` are skipped, so if it stalls, just run it again until the
  "still missing" count reaches zero.

Keep `GRID_STEP` coarse (0.15–0.2°) so the run stays to a few hundred polite
requests. `03_build_lookup.py` drops any `-9999` rows automatically.

## What the lookup stores (per grid point)

| field | meaning |
|---|---|
| `lat`, `lon`, `elev` | location and elevation (m) |
| `zone`, `emtF` | USDA zone + extreme-min °F from ClimateNA `EMT` (**offline fallback only** — see note) |
| `ffd` | frost-free days (ClimateNA `FFP`, else `NFFD`) |
| `precipIn` | mean annual precipitation (in, from `MAP`) |
| `mat`, `dd5`, `cmd` | mean annual temp (°C), growing degree-days >5 °C, climate-moisture deficit (mm) |

## How the app uses it

`js/geo.js` → `lookupClimateGrid(lat, lon)` finds the nearest grid point and
returns the agronomic normals above; `lookupClimate` falls back to Open-Meteo
(ERA5) when the grid doesn't cover a point, and always gets live recent-drought
from Open-Meteo.

**Hardiness zone note:** ClimateNA `EMT` is the *extreme* minimum temperature,
which is colder than the *average annual* minimum USDA zones are defined on, so it
under-states the zone. The app therefore takes the **hardiness zone from Open-Meteo**
(whose daily-minimum method matches USDA) whenever it's online, and only uses the
grid's `EMT`-based zone as an offline fallback. ClimateNA still drives everything
else. To make the grid's own zone warmer, edit `zone_from_emt()` in
`03_build_lookup.py` (e.g. base it on `MCMT`).
