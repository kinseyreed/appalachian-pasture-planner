# ---- Step 1: build the ClimateNA input CSV (macOS-friendly) ------------------
# Produces grid_input.csv with the columns the ClimateNA API needs:
#   ID1, ID2, lat, long, el   (el = elevation in metres; long is negative = west)
#
# Elevation is fetched from the Open-Meteo elevation API so this needs only base R
# + jsonlite — no sf / elevatr / GDAL to wrestle with on a Mac.

source("config.R")
if (!requireNamespace("jsonlite", quietly = TRUE))
  stop("Install jsonlite first: install.packages('jsonlite')")

# Regular grid over the bounding box.
lons <- seq(REGION$lon_min, REGION$lon_max, by = GRID_STEP)
lats <- seq(REGION$lat_min, REGION$lat_max, by = GRID_STEP)
grid <- expand.grid(long = lons, lat = lats)
cat(sprintf("Grid: %d points (%d lon x %d lat) at %.3f deg\n",
            nrow(grid), length(lons), length(lats), GRID_STEP))

# Elevation (m) from Open-Meteo, up to 100 coordinates per request, with retry/
# backoff (the elevation API rate-limits bursts with HTTP 429).
elev <- rep(NA_real_, nrow(grid))
idx <- split(seq_len(nrow(grid)), ceiling(seq_len(nrow(grid)) / 100))
for (chunk in idx) {
  u <- sprintf("https://api.open-meteo.com/v1/elevation?latitude=%s&longitude=%s",
               paste(round(grid$lat[chunk], 5), collapse = ","),
               paste(round(grid$long[chunk], 5), collapse = ","))
  for (attempt in 1:6) {
    res <- tryCatch(jsonlite::fromJSON(u), error = function(e) NULL)
    if (!is.null(res) && !is.null(res$elevation)) { elev[chunk] <- res$elevation; break }
    Sys.sleep(2 * attempt)  # back off on 429
  }
  Sys.sleep(1.5)
}
miss <- sum(is.na(elev))
if (miss > 0) cat(sprintf("WARNING: %d points still missing elevation after retries\n", miss))

out <- data.frame(
  ID1  = seq_len(nrow(grid)),
  ID2  = seq_len(nrow(grid)),
  lat  = round(grid$lat, 5),
  long = round(grid$long, 5),          # negative = western hemisphere
  el   = round(elev)
)
out <- out[!is.na(out$el), ]
utils::write.csv(out, INPUT_CSV, row.names = FALSE)
cat(sprintf("Wrote %s (%d points with elevation)\n", INPUT_CSV, nrow(out)))
cat("Next: source('02_fetch_climatena_api.R')\n")
