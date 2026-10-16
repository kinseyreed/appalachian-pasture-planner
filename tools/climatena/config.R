# ---- ClimateNA precompute configuration (web-API / Mac-friendly) ------------
# This pipeline uses the ClimateNA WEB API (https://api.climatena.ca), so it runs
# on macOS with no desktop app and no large data download — only base R + the
# `jsonlite` package. Run 01_build_grid_csv.R, then 02_fetch_climatena_api.R,
# then 03_build_lookup.py. See README.md for the walkthrough.

# Service region bounding box (decimal degrees). West Virginia. Longitudes are
# negative (west). Points outside WV's actual border still get fetched (the box
# is a rectangle); that's fine — the app only ever looks up points near a farm.
REGION <- list(
  lat_min = 37.1, lat_max = 40.7,
  lon_min = -82.7, lon_max = -77.6
)

# Grid spacing in degrees. 0.1 deg ~ 11 km. NOTE: the public API is throttled,
# so a fine grid means a long, slow run. 0.15-0.2 deg is plenty for climate that
# varies gradually, and keeps the fetch to a few hundred polite requests.
GRID_STEP <- 0.15

# ClimateNA normal period. The web API's "Normal_*" periods currently resolve to
# the standard ClimateNA normal; '1991_2020' is the grant-relevant label.
PERIOD <- "Normal_1991_2020"

# Annual / seasonal / monthly: 'Y' is what the planner needs.
MSY <- "Y"

# Throttling guard. The API returns -9999 ("can't serve right now") under load;
# the fetch script retries each point this many times with growing backoff, and
# pauses PAUSE_SEC between points. Raise these if you see many -9999 rows.
MAX_RETRIES <- 6
PAUSE_SEC   <- 1.0

# Working files (relative to this tools/climatena folder).
INPUT_CSV  <- "grid_input.csv"     # written by 01_build_grid_csv.R (ID1,ID2,lat,long,el)
OUTPUT_CSV <- "grid_climate.csv"   # written by 02_fetch_climatena_api.R (adds MAT,MAP,EMT,FFP,DD5,CMD,...)
