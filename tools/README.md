# Regenerating the field-trial establishment data

`build-trial-data.py` produces [`../data/trial-establishment.json`](../data/trial-establishment.json),
the precomputed West Virginia field-trial signal the planner loads at runtime.

## Inputs (not included in the repo — the source research files)

1. `survey.xlsx` — species-resolved plant survey (sheets `biomass_2023_2025`, `cover_2026`, `presence_2022`, `taxon_master`, …)
2. `seedmix.xlsx` — Spring 2022 seed mix planted (`High Diversity Mix`, `Low DiversityTraditional Mix`)
3. `AllData - Soil.csv`
4. `AllData - Site_Data.csv`
5. `AllData - ClimateData.csv` (ClimateNA output)
6. `Combined_Years_Management - DuringExperiment.csv`
7. `../data/species.json` (the planner's species list — defines which species are eligible)

## Run

```bash
pip install openpyxl
python3 build-trial-data.py \
  survey.xlsx seedmix.xlsx \
  "AllData - Soil.csv" "AllData - Site_Data.csv" \
  "AllData - ClimateData.csv" "Combined_Years_Management - DuringExperiment.csv" \
  ../data/species.json ../data/trial-establishment.json
```

## What it computes

- **Farm site metadata** (20 farms): soil pH (2022 baseline; pH-water was blank, so pH-salt + 0.6),
  clay %, USDA hardiness zone (from ClimateNA extreme-minimum-temperature `EMT`), organic matter,
  P/K/CEC, slope, mean annual grazing intensity (AU-days/acre). WSS drainage class was blank in the
  source data, so drainage is not used.
- **Per-species establishment index** for every planner species found in the survey: the normalized
  *seeded-vs-Control* contrast, combining mean dry-weight biomass 2023–2025 (weight 0.6) and % cover
  May 2026 (weight 0.4), in the range −1…+1, stored per farm so the planner can site-match.
- **Mix membership** — which planner species were actually sown in the High and Low mixes.
  - *Sown & detected*: the seeded-vs-Control contrast is a true establishment test → nudge up/down.
  - *Sown but not detected*: flagged `not_detected` with `failureType` = `genuine` (distinctive,
    confidently identified → keeps a downward nudge) or `inconclusive` (possible misID → left neutral).
  - *Unsown volunteer*: carries an absolute **abundance index** per farm → positive-only nudge, since
    growing well unsown is evidence a species suits a site.
- **ID reliability** — each species gets a `reliabilityFactor` (from `id_reliability.csv`, hand-mapped in
  the script: Good 1.0 / Moderate 0.7 / Poor 0.4 / n/a 0.3) that scales its nudge.

Caveats carried through to the UI: plant identification was imperfect, and the no-till drill seeding
method was not tested as a separate factor, so the signal is treated as supporting evidence, weighted
moderately — never more than a clean soil-fit. To change an ID-reliability rating or a genuine-vs-
inconclusive call, edit the `RELIABILITY` / `GENUINE_FAILURE` tables at the top of `build-trial-data.py`
and re-run.
