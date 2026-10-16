#!/usr/bin/env python3
# Build data/trial-establishment.json for the Appalachian Pasture Planner v2.
# Inputs passed as args (all untrusted attachments handled read-only):
#   1 survey.xlsx  2 seedmix.xlsx  3 Soil.csv  4 Site.csv  5 Climate.csv  6 Mgmt.csv  7 species.json  8 out.json
import sys, json, csv, re, math
import openpyxl
from collections import defaultdict

survey_x, seed_x, soil_c, site_c, clim_c, mgmt_c, spj, outp = sys.argv[1:9]

# ---------- app species: scientific-name -> id ----------
sp = json.load(open(spj))
items = sp['species'] if isinstance(sp, dict) and 'species' in sp else sp

def norm_sci(s):
    if not s: return ''
    s = s.lower().replace('×', 'x').replace('[', ' ').replace(']', ' ')
    s = re.sub(r'[^a-z\s]', ' ', s)
    toks = [t for t in s.split() if t not in ('l', 'vent', 'scop', 'nash', 'michx', 'torr',
            'leyss', 'bieb', 'm', 'savi', 'boiss', 'ponert', 'roem', 'schult', 'vitman')]
    return ' '.join(toks)

def first2(s):
    t = norm_sci(s).split()
    return ' '.join(t[:2])

app_by_sci = {}      # first-two-token scientific -> id (plain binomials only)
app_ids = set()
for s in items:
    sid = s['id']; app_ids.add(sid)
    sci = s.get('scientificName') or ''
    if '×' in sci or ' x ' in sci.lower():
        continue  # hybrids collide with their parent binomial; match them explicitly
    app_by_sci[first2(sci)] = sid

SURVEY_ALIAS = {
    'melilotus albus': 'white-sweetclover',  # survey spells it albus; app uses alba
}

# ID reliability hand-mapped from id_reliability.csv. `factor` scales the trial
# nudge so that uncertain determinations move a species' score less (Good 1.0 ->
# Poor 0.4 -> n/a 0.3). GENUINE_FAILURE marks sown species that were truly absent
# (distinctive, high-confidence ID) rather than possibly misidentified — only
# those keep a downward nudge when not detected; everything else stays neutral.
RELIABILITY = {
    'indiangrass': ('Good', 1.0), 'big-bluestem': ('Moderate', 0.7), 'eastern-gamagrass': ('Good', 1.0),
    'intermediate-wheatgrass': ('Poor', 0.4), 'smooth-bromegrass': ('Moderate', 0.7),
    'sideoats-grama': ('Poor', 0.4), 'little-bluestem': ('Poor', 0.4),
    'canada-wildrye': ('Poor', 0.4), 'virginia-wildrye': ('Poor', 0.4), 'bottlebrush-grass': ('Poor', 0.4),
    'ryegrass-blend': ('Poor', 0.4), 'perennial-ryegrass': ('Poor', 0.4),
    'chicory': ('Moderate', 0.7), 'plantain': ('Good', 1.0), 'small-burnet': ('Good', 1.0),
    'oxeye-sunflower': ('Moderate', 0.7), 'grayhead-coneflower': ('Moderate', 0.7), 'lanceleaf-coreopsis': ('Moderate', 0.7),
    'alfalfa': ('Good', 1.0), 'white-sweetclover': ('Good', 1.0), 'yellow-sweetclover': ('Good', 1.0),
    'sainfoin': ('Good', 1.0), 'purple-prairie-clover': ('Good', 1.0),
    'slender-lespedeza': ('Poor', 0.4),
    'orchardgrass': ('Good', 1.0), 'red-clover': ('Moderate', 0.7), 'white-clover': ('Moderate', 0.7),
    'maximilian-sunflower': ('n/a', 0.3),
    'kura-clover': ('Poor', 0.4), 'alsike-clover': ('Poor', 0.4), 'balansa-clover': ('Poor', 0.4),
    'strawberry-clover': ('Poor', 0.4),
    'tall-fescue': ('Moderate', 0.7), 'timothy': ('Moderate', 0.7),
    'birdsfoot-trefoil': ('Good', 1.0), 'annual-lespedeza': ('Moderate', 0.7),
}
GENUINE_FAILURE = {'sainfoin', 'purple-prairie-clover'}
def reliability(mid):
    return RELIABILITY.get(mid, ('Unrated', 0.7))
def match_app(sci):
    """Map a scientific name (from survey or mix) to an app species id, or None."""
    full = norm_sci(sci)
    if full in SURVEY_ALIAS:
        return SURVEY_ALIAS[full]
    # the italian x perennial ryegrass hybrid (= festulolium) is the app's ryegrass-blend
    if 'lolium' in full and 'hybridum' in full:
        return 'ryegrass-blend'
    f2 = first2(sci)
    if f2 in app_by_sci:
        return app_by_sci[f2]
    return None

# ---------- seed mixes -> which app ids were sown ----------
wb = openpyxl.load_workbook(seed_x, read_only=True, data_only=True)
high_ids, low_ids = set(), set()
# High Diversity Mix sheet: col0 scientificName, col1 common
ws = wb['High Diversity Mix']
for row in ws.iter_rows(values_only=True):
    sci = row[0] if row else None
    common = row[1] if row and len(row) > 1 else None
    if not sci or sci in ('LEGUMES', 'FORBS', 'GRASSES'):
        continue
    sci_s = str(sci)
    mid = match_app(sci_s)
    # manual disambiguation
    cl = (str(common) or '').lower()
    if 'ambiguum' in sci_s.lower():
        mid = 'kura-clover'
    elif 'melilotus alba' in sci_s.lower():
        mid = 'yellow-sweetclover' if 'yellow' in cl else 'white-sweetclover'
    elif 'lolium perenne' in sci_s.lower() and 'festuca' in sci_s.lower():
        mid = 'ryegrass-blend'
    elif 'hystix' in sci_s.lower() or 'hystrix' in sci_s.lower():  # mix sheet misspells Elymus hystrix
        mid = 'bottlebrush-grass'
    if mid and mid in app_ids:
        high_ids.add(mid)
# Low mix: Ernst cattle grazing mix (fixed 5 species) — read the structured rows (genus col ~6)
ws = wb['Low DiversityTraditional Mix']
low_map = {
    'dactylis glomerata': 'orchardgrass',
    'lolium perenne': 'perennial-ryegrass',
    'trifolium pratense': 'red-clover',
    'trifolium repens': 'white-clover',
    'festuca elatior x lolium perenne': 'ryegrass-blend',  # festulolium 'Duo'
}
for row in ws.iter_rows(values_only=True):
    for cell in row:
        if isinstance(cell, str):
            key = first2(cell)
            full = norm_sci(cell)
            if full in low_map: low_ids.add(low_map[full])
            elif key in low_map: low_ids.add(low_map[key])
# festulolium explicit
low_ids.add('ryegrass-blend')
print("HIGH mix app ids:", sorted(high_ids), file=sys.stderr)
print("LOW mix app ids:", sorted(low_ids), file=sys.stderr)

# ---------- survey: biomass (2023-2025) & cover (2026) per farm x plot x app species ----------
wb2 = openpyxl.load_workbook(survey_x, read_only=True, data_only=True)

def plot_norm(p):
    if p == 'High Diversity': return 'high'
    if p == 'Low Diversity': return 'low'
    if p == 'Control': return 'control'
    return None

# biomass: sum across years per (farm, plot, app id), then mean over the 3 years (n=3)
bio = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # farm->plot->id->sum
ws = wb2['biomass_2023_2025']; rows = ws.iter_rows(values_only=True); hdr = next(rows)
I = {h: i for i, h in enumerate(hdr)}
for r in rows:
    plot = plot_norm(r[I['Plot']])
    if not plot: continue
    mid = match_app(r[I['ScientificName']]) or match_app(r[I['AnalysisTaxon']])
    if not mid: continue
    try: w = float(r[I['DryWeight_g']] or 0)
    except: w = 0.0
    bio[r[I['FarmID']]][plot][mid] += w
# divide by 3 years to get mean annual biomass
for farm in bio:
    for plot in bio[farm]:
        for mid in bio[farm][plot]:
            bio[farm][plot][mid] /= 3.0

# cover 2026: mid percent per (farm, plot, app id)
cov = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
ws = wb2['cover_2026']; rows = ws.iter_rows(values_only=True); hdr = next(rows)
I = {h: i for i, h in enumerate(hdr)}
for r in rows:
    plot = plot_norm(r[I['Plot']])
    if not plot: continue
    mid = match_app(r[I['ScientificName']]) or match_app(r[I['AnalysisTaxon']])
    if not mid: continue
    try: c = float(r[I['CoverPct_mid']] or 0)
    except: c = 0.0
    cov[r[I['FarmID']]][plot][mid] += c

# farms observed in survey
survey_farms = sorted(set(list(bio.keys()) + list(cov.keys())))

# ---------- farm site metadata ----------
def num(x):
    try: return float(x)
    except: return None

# Soil 2022 baseline: mean across plots per farm
soil_rows = list(csv.DictReader(open(soil_c)))
soil_agg = defaultdict(lambda: defaultdict(list))
for row in soil_rows:
    if row['Year'] != '2022': continue
    f = row['FarmID']
    for k in ('pH (water)', 'pH (salt)', 'P_ppm', 'K_ppm', 'CEC_meq/100g', 'OMPerc_WVU_500', 'OMPerc_MU_360'):
        v = num(row.get(k))
        if v is not None: soil_agg[f][k].append(v)
def soil_mean(f, k):
    vs = soil_agg[f].get(k, [])
    return round(sum(vs) / len(vs), 2) if vs else None
def soil_ph(f):
    # 2022 pH(water) is blank throughout this dataset; fall back to pH(salt) + 0.6,
    # the usual CaCl2->water offset, so it is comparable to a producer's water-based test.
    w = soil_mean(f, 'pH (water)')
    if w is not None: return w
    s = soil_mean(f, 'pH (salt)')
    return round(s + 0.6, 2) if s is not None else None

site_rows = {}
for row in csv.DictReader(open(site_c)):
    site_rows.setdefault(row['FarmID'], row)  # first (Control) row

def drainage_cat(wss):
    s = (wss or '').lower()
    if 'poor' in s: return 'wet'
    if 'moderately well' in s or 'somewhat' in s: return 'moderate'
    if 'well' in s: return 'well'
    if 'excess' in s: return 'well'
    return None

# climate: EMT, MAT, MAP (2022 row)
clim_rows = {}
for row in csv.DictReader(open(clim_c)):
    if row['FarmID'] not in clim_rows:  # first = 2022
        clim_rows[row['FarmID']] = row

def zone_from_emt(emt):
    if emt is None: return None
    # upper bound (deg C) -> zone label
    bands = [(-31.7, '4a'), (-28.9, '4b'), (-26.1, '5a'), (-23.3, '5b'),
             (-20.6, '6a'), (-17.8, '6b'), (-15.0, '7a'), (-12.2, '7b'), (-9.4, '8a')]
    for ub, z in bands:
        if emt < ub: return z
    return '8b'

# management: mean annual AU-days per acre (grazed events)
mgmt_agg = defaultdict(lambda: defaultdict(float))  # farm->year->au_days_per_acre
for row in csv.DictReader(open(mgmt_c)):
    if (row.get('event_type') or '').lower() != 'grazed': continue
    f = row['farmid']; au = num(row.get('animal_units')); dur = num(row.get('duration_grazed_days')); ac = num(row.get('acres'))
    if au and dur and ac:
        mgmt_agg[f][row['year']] += au * dur / ac
def grazing_intensity(f):
    yrs = mgmt_agg.get(f)
    if not yrs: return None
    return round(sum(yrs.values()) / len(yrs), 2)

farms_out = {}
for f in sorted(set(list(site_rows.keys()) + survey_farms)):
    site = site_rows.get(f, {})
    clim = clim_rows.get(f, {})
    emt = num(clim.get('EMT'))
    farms_out[f] = {
        'ph': soil_ph(f),
        'om': soil_mean(f, 'OMPerc_WVU_500') or soil_mean(f, 'OMPerc_MU_360'),
        'p_ppm': soil_mean(f, 'P_ppm'),
        'k_ppm': soil_mean(f, 'K_ppm'),
        'cec': soil_mean(f, 'CEC_meq/100g'),
        'clayPct': num(site.get('PercClay')),
        'sandPct': num(site.get('PercSand')),
        'texture': site.get('Texture') or None,
        'drainage': drainage_cat(site.get('WSS_DrainageClass')),
        'drainageClass': site.get('WSS_DrainageClass') or None,
        'slopePct': num(site.get('Slope')),
        'emt_c': emt,
        'mat_c': num(clim.get('MAT')),
        'map_mm': num(clim.get('MAP')),
        'cmd': num(clim.get('CMD')),     # climate moisture deficit (mm) — dryness index
        'dd5': num(clim.get('DD5')),     # growing degree-days > 5C
        'ahm': num(clim.get('AHM')),     # annual heat:moisture index (higher = drier)
        'hardinessZone': zone_from_emt(emt),
        'grazingAuDaysPerAcre': grazing_intensity(f),
    }

# ---------- per-species per-farm outcomes + establishment index ----------
EPS = 0.5
def contrast(seeded, control):
    # normalized difference in [-1,1]; +1 = only in seeded, -1 = only in control
    if seeded == 0 and control == 0: return None
    return (seeded - control) / (seeded + control + EPS)

species_out = {}
all_ids = set()
for farm in bio:
    for plot in bio[farm]:
        all_ids.update(bio[farm][plot].keys())
for farm in cov:
    for plot in cov[farm]:
        all_ids.update(cov[farm][plot].keys())

for mid in sorted(all_ids):
    in_high = mid in high_ids
    in_low = mid in low_ids
    signal = 'establishment' if (in_high or in_low) else 'volunteer'
    per_farm = {}
    for f in survey_farms:
        cBio = bio[f]['control'].get(mid, 0.0)
        hBio = bio[f]['high'].get(mid, 0.0)
        lBio = bio[f]['low'].get(mid, 0.0)
        cCov = cov[f]['control'].get(mid, 0.0)
        hCov = cov[f]['high'].get(mid, 0.0)
        lCov = cov[f]['low'].get(mid, 0.0)
        if max(cBio, hBio, lBio, cCov, hCov, lCov) == 0:
            continue  # species absent at this farm entirely
        # which seeded plots to credit, based on actual mix membership
        seeded_bio, seeded_cov = [], []
        if in_high or signal == 'volunteer':
            seeded_bio.append(hBio); seeded_cov.append(hCov)
        if in_low or signal == 'volunteer':
            seeded_bio.append(lBio); seeded_cov.append(lCov)
        if not seeded_bio:  # safety
            seeded_bio = [hBio, lBio]; seeded_cov = [hCov, lCov]
        sBio = sum(seeded_bio) / len(seeded_bio)
        sCov = sum(seeded_cov) / len(seeded_cov)
        bi = contrast(sBio, cBio)
        ci = contrast(sCov, cCov)
        parts = [x for x in (bi, ci) if x is not None]
        if bi is not None and ci is not None:
            perf = 0.6 * bi + 0.4 * ci      # both weighted; biomass (3 yrs) > cover (1 yr)
        elif parts:
            perf = parts[0]
        else:
            continue
        # Absolute abundance (0-1): how well the species grows at this farm
        # regardless of whether we sowed it. Used for the volunteer signal, where
        # unsown presence is evidence the species suits the location. ~15% cover
        # (or ~30 g biomass) counts as thriving.
        maxCov = max(cCov, hCov, lCov)
        maxBio = max(cBio, hBio, lBio)
        abund = min(1.0, maxCov / 15.0) if maxCov > 0 else min(1.0, maxBio / 30.0)
        per_farm[f] = {
            'cBio': round(cBio, 2), 'hBio': round(hBio, 2), 'lBio': round(lBio, 2),
            'cCov': round(cCov, 2), 'hCov': round(hCov, 2), 'lCov': round(lCov, 2),
            'perf': round(perf, 3), 'abund': round(abund, 3),
        }
    if not per_farm:
        continue
    perfs = [v['perf'] for v in per_farm.values()]
    abunds = [v['abund'] for v in per_farm.values()]
    npos = sum(1 for p in perfs if p > 0.1)
    lab, fac = reliability(mid)
    species_out[mid] = {
        'inHighMix': in_high, 'inLowMix': in_low, 'signalType': signal,
        'outcome': 'detected',
        'idReliability': lab, 'reliabilityFactor': fac,
        'nFarms': len(per_farm),
        'nFarmsEstablished': npos,
        'meanPerf': round(sum(perfs) / len(perfs), 3),
        'meanAbund': round(sum(abunds) / len(abunds), 3),
        'perFarm': per_farm,
    }

# Sown species never detected in any plot through 2026. Only a genuine failure
# (distinctive, high-confidence ID) keeps a downward nudge; a species that may
# have been misidentified or folded into a look-alike stays neutral (the runtime
# applies no nudge when failureType == 'inconclusive').
NOT_DETECTED_PERF = -0.35
sown = (high_ids | low_ids) & app_ids
for mid in sorted(sown - set(species_out.keys())):
    lab, fac = reliability(mid)
    genuine = mid in GENUINE_FAILURE
    species_out[mid] = {
        'inHighMix': mid in high_ids, 'inLowMix': mid in low_ids,
        'signalType': 'establishment', 'outcome': 'not_detected',
        'failureType': 'genuine' if genuine else 'inconclusive',
        'idReliability': lab, 'reliabilityFactor': fac,
        'nFarms': len(survey_farms), 'nFarmsEstablished': 0,
        'meanPerf': NOT_DETECTED_PERF if genuine else 0.0, 'perFarm': {},
    }

# ---------- per-species climate/soil predictors -> site-match weights --------
# For each sown-and-detected species, find which site variables best predict its
# establishment across farms, and weight the runtime site-match toward those
# variables. This is how the planner "uses the climate variables that best
# predict each species' success" — e.g. a species whose establishment tracks
# moisture is matched to trial farms of similar wetness/dryness, so a dry eastern-
# panhandle site is steered by the farms most like it.
MATCH_FEATURES = {           # species feature -> farm field + distance scale
    'ph':   ('ph', 0.9),
    'clay': ('clayPct', 8.0),
    'map':  ('map_mm', 150.0),   # precipitation (mm)
    'cmd':  ('cmd', 60.0),       # moisture deficit (mm) — dryness
}
MIN_CORR_FARMS = 8
WEIGHT_FLOOR = 0.3
DEFAULT_MATCH_WEIGHTS = {'ph': 0.6, 'clay': 0.5, 'map': 0.5, 'cmd': 0.5}

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return None
    mx = sum(xs) / n; my = sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs); sy = sum((y - my) ** 2 for y in ys)
    if sx <= 0 or sy <= 0: return None
    cov = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    return cov / math.sqrt(sx * sy)

for mid, rec in species_out.items():
    pf = rec.get('perFarm') or {}
    weights, predictors = {}, []
    if rec['signalType'] == 'establishment' and rec['outcome'] == 'detected' and len(pf) >= MIN_CORR_FARMS:
        for feat, (field, _scale) in MATCH_FEATURES.items():
            xs, ys = [], []
            for farm, d in pf.items():
                fv = farms_out.get(farm, {}).get(field)
                if fv is not None:
                    xs.append(fv); ys.append(d['perf'])
            r = pearson(xs, ys) if len(xs) >= MIN_CORR_FARMS else None
            if r is not None:
                weights[feat] = round(WEIGHT_FLOOR + (1 - WEIGHT_FLOOR) * abs(r), 2)
                predictors.append((feat, round(r, 2), len(xs)))
        predictors.sort(key=lambda t: -abs(t[1]))
    if not weights:
        weights = dict(DEFAULT_MATCH_WEIGHTS)
    rec['matchWeights'] = weights
    if predictors:
        rec['climatePredictors'] = [{'var': f, 'r': r, 'n': n} for f, r, n in predictors]

out = {
    'meta': {
        'source': 'WVU / USDA NRCS CIG Soil Health Demonstration — West Virginia plant-diversity field trial',
        'design': '20 farms x Control (unseeded) / High Diversity / Low Diversity plots; High & Low no-till drill-seeded spring 2022.',
        'metrics': 'Sown species carry an establishment index combining mean dry-weight biomass 2023-2025 (weight 0.6) and % cover May 2026 (weight 0.4), each as the normalized seeded-vs-Control contrast in [-1,1]. Unsown species carry an absolute abundance index (0-1) used as positive-only evidence that the species suits a location.',
        'caveats': 'Plant identification was not perfect; the no-till drill seeding method was not controlled as a separate factor. Each species carries an ID-reliability factor that scales its nudge, and sown species that were never detected stay neutral unless they are a genuine (high-confidence) failure. Treat the signal as supporting evidence, not proof. Only species already in the planner are included.',
        'generated': '2026-10-15',
        'siteMatching': 'At runtime the planner weights each trial farm by similarity to the user site over pH, clay %, precipitation (MAP) and moisture deficit (CMD), using per-species matchWeights derived from which of those variables best predicts that species establishment. The site-weighted index is then scaled by sample size and ID reliability.',
    },
    'mixes': {'high': sorted(high_ids), 'low': sorted(low_ids)},
    'farms': farms_out,
    'species': species_out,
}
json.dump(out, open(outp, 'w'), indent=2)
print(f"\nWROTE {outp}", file=sys.stderr)
print(f"farms={len(farms_out)} species={len(species_out)} "
      f"(establishment={sum(1 for v in species_out.values() if v['signalType']=='establishment')}, "
      f"volunteer={sum(1 for v in species_out.values() if v['signalType']=='volunteer')})", file=sys.stderr)