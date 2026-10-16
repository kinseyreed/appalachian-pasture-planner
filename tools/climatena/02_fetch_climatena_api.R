# ---- Step 2: fetch ClimateNA normals from the web API (macOS-friendly) -------
# Reads grid_input.csv (ID1,ID2,lat,long,el) and queries the ClimateNA web API
# point-by-point, writing grid_climate.csv with the climate variables attached.
#
# Needs only base R + jsonlite  (install.packages("jsonlite")).  No desktop app,
# no 188 MB data package, no `terra`. This is the same endpoint the official
# ClimateNAr::ClimateNA_API() uses; we call it directly so there's nothing heavy
# to install on a Mac.
#
# The public API is throttled and returns -9999 under load. This script retries
# each point with backoff and is RESUMABLE: rows already in grid_climate.csv are
# skipped, so if it stalls you can just run it again.

source("config.R")
if (!requireNamespace("jsonlite", quietly = TRUE))
  stop("Install jsonlite first: install.packages('jsonlite')")

if (!file.exists(INPUT_CSV)) stop("Run 01_build_grid_csv.R first — grid_input.csv is missing.")
grid <- utils::read.csv(INPUT_CSV, stringsAsFactors = FALSE)
names(grid)[1:5] <- c("ID1", "ID2", "lat", "long", "el")

API <- "https://api.climatena.ca/api/cnaApi6//LatLonEl"

# Resume: load any rows already fetched (keyed by ID1).
done <- list()
if (file.exists(OUTPUT_CSV)) {
  prev <- utils::read.csv(OUTPUT_CSV, stringsAsFactors = FALSE)
  for (i in seq_len(nrow(prev))) done[[as.character(prev$ID1[i])]] <- prev[i, ]
  cat(sprintf("Resuming: %d of %d points already fetched.\n", length(done), nrow(grid)))
}

fetch_point <- function(id1, id2, lat, lon, el) {
  u <- sprintf("%s?ID1=%s&ID2=%s&lat=%s&lon=%s&el=%s&prd=%s&varYSM=%s",
               API, id1, id2, lat, lon, el, utils::URLencode(PERIOD), MSY)
  for (attempt in seq_len(MAX_RETRIES)) {
    row <- tryCatch(jsonlite::fromJSON(u), error = function(e) NULL)
    if (!is.null(row) && nrow(row) >= 1) {
      r <- row[1, ]
      if (!is.null(r$MAT) && suppressWarnings(as.numeric(r$MAT)) != -9999) return(r)
    }
    Sys.sleep(PAUSE_SEC * attempt)   # linear backoff on -9999 / errors
  }
  return(NULL)  # gave up (left out of output so a later re-run retries it)
}

results <- if (length(done)) done else list()
nnew <- 0; nfail <- 0
for (i in seq_len(nrow(grid))) {
  key <- as.character(grid$ID1[i])
  if (!is.null(results[[key]])) next
  r <- fetch_point(grid$ID1[i], grid$ID2[i], grid$lat[i], grid$long[i], grid$el[i])
  if (is.null(r)) { nfail <- nfail + 1; cat(sprintf("  [%d/%d] id %s: no data (will retry on re-run)\n", i, nrow(grid), key)); next }
  results[[key]] <- r
  nnew <- nnew + 1
  if (nnew %% 25 == 0) {
    utils::write.csv(do.call(rbind, results), OUTPUT_CSV, row.names = FALSE)  # checkpoint
    cat(sprintf("  ...%d fetched (%d failed so far)\n", length(results), nfail))
  }
  Sys.sleep(PAUSE_SEC)
}

utils::write.csv(do.call(rbind, results), OUTPUT_CSV, row.names = FALSE)
cat(sprintf("\nDone. %d points in %s (%d still missing — re-run to fill them).\n",
            length(results), OUTPUT_CSV, nrow(grid) - length(results)))
cat("Next: python3 03_build_lookup.py", OUTPUT_CSV, "../../data/climate-grid.json",
    paste0("--source='", PERIOD, "'"), "\n")
