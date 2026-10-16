#!/usr/bin/env python3
"""Convert a ClimateNA output CSV into the compact climate-grid.json the planner reads.

Works with either:
  * the output of climatenaR::histClimateNA(..., '1991_2020', 'Y', exe)  (true 30-yr normal), or
  * any CSV with the same ClimateNA annual variables (e.g. the trial ClimateData.csv),
    which is how the shipped seed grid was built.

Usage:
  python3 03_build_lookup.py INPUT.csv ../../data/climate-grid.json [--source "label"]

The planner does a nearest-point lookup on this grid for a producer's coordinates and
uses the result as the primary climate normal, with Open-Meteo (ERA5) as the live fallback.
Keep the point count reasonable (a ~0.1 deg grid over the service region is a few hundred KB).
"""
import sys, csv, json, math

def pick(row, *names):
    """First present, non-empty column among several possible header spellings."""
    for n in names:
        if n in row and row[n] not in (None, ''):
            return row[n]
    # case-insensitive fallback
    low = {k.lower(): v for k, v in row.items()}
    for n in names:
        v = low.get(n.lower())
        if v not in (None, ''):
            return v
    return None

def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if v == -9999 else v  # ClimateNA no-data sentinel

def zone_from_emt(emt_c):
    """USDA hardiness zone from ClimateNA extreme-minimum-temperature EMT (deg C).
    EMT is the coldest value over the period, so this runs a little conservative vs.
    the mean-annual-minimum USDA definition. Swap for MCMT-based logic if preferred."""
    if emt_c is None:
        return None
    bands = [(-31.7, '4a'), (-28.9, '4b'), (-26.1, '5a'), (-23.3, '5b'),
             (-20.6, '6a'), (-17.8, '6b'), (-15.0, '7a'), (-12.2, '7b'),
             (-9.4, '8a'), (-6.7, '8b')]
    for ub, z in bands:
        if emt_c < ub:
            return z
    return '8b'

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src_label = '1991-2020 normal'
    for a in sys.argv[1:]:
        if a.startswith('--source'):
            src_label = a.split('=', 1)[1] if '=' in a else 'custom'
    inp, outp = args[0], args[1]

    # Average all rows that share a location (handles multi-year inputs like the
    # trial file; a true normal grid has one row per point and is unaffected).
    acc = {}
    with open(inp, newline='') as f:
        for row in csv.DictReader(f):
            lat = num(pick(row, 'Latitude', 'Lat', 'lat'))
            lon = num(pick(row, 'Longitude', 'Lon', 'Long', 'long', 'lon'))
            if lat is None or lon is None:
                continue
            # ClimateNA input CSVs sometimes store longitude as positive-west; normalise
            # North-American longitudes back to negative so the lookup matches real coords.
            if lon > 0 and lat > 0:
                lon = -lon
            key = (round(lat, 4), round(lon, 4))
            rec = acc.setdefault(key, {'lat': lat, 'lon': lon, 'vals': {}})
            fields = {
                'elev': pick(row, 'Elevation', 'Elv_m', 'el', 'elev'),
                'emt': pick(row, 'EMT'),
                'ffp': pick(row, 'FFP'),
                'nffd': pick(row, 'NFFD'),
                'map': pick(row, 'MAP'),
                'mat': pick(row, 'MAT'),
                'dd5': pick(row, 'DD5'),
                'cmd': pick(row, 'CMD'),
            }
            for k, v in fields.items():
                v = num(v)
                if v is not None:
                    rec['vals'].setdefault(k, []).append(v)

    points = []
    for rec in acc.values():
        def mean(k):
            vs = rec['vals'].get(k)
            return sum(vs) / len(vs) if vs else None
        emt = mean('emt')
        ffp = mean('ffp')
        nffd = mean('nffd')
        mapp = mean('map')
        pt = {
            'lat': round(rec['lat'], 4),
            'lon': round(rec['lon'], 4),
            'elev': round(mean('elev')) if mean('elev') is not None else None,
            'zone': zone_from_emt(emt),
            'emtF': round(emt * 9 / 5 + 32) if emt is not None else None,
            'ffd': round(ffp) if ffp is not None else (round(nffd) if nffd is not None else None),
            'precipIn': round(mapp / 25.4) if mapp is not None else None,
            'mat': round(mean('mat'), 1) if mean('mat') is not None else None,
            'dd5': round(mean('dd5')) if mean('dd5') is not None else None,
            'cmd': round(mean('cmd')) if mean('cmd') is not None else None,
        }
        points.append(pt)

    points.sort(key=lambda p: (p['lat'], p['lon']))
    out = {
        'meta': {
            'source': 'ClimateNA (' + src_label + ')',
            'generator': 'tools/climatena/03_build_lookup.py',
            'variables': 'zone (USDA, from EMT), emtF (extreme min, F), ffd (frost-free days, from FFP/NFFD), precipIn (from MAP), mat (C), dd5 (growing degree-days >5C), cmd (climate moisture deficit, mm)',
            'note': 'Nearest-point lookup. Replace this file by running the full grid pipeline (see tools/climatena/README.md); the planner falls back to Open-Meteo ERA5 for any point beyond grid coverage.',
            'nPoints': len(points),
        },
        'points': points,
    }
    with open(outp, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote %s  (%d points, %.1f KB)' % (outp, len(points), len(json.dumps(out)) / 1024))

if __name__ == '__main__':
    main()
