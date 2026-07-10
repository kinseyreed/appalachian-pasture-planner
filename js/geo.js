/*
 * Appalachian Pasture Planner — location data layer
 *
 * Turns an address (or a browser geolocation fix) into map-derived starting
 * points for the questionnaire, entirely client-side. Every request goes
 * directly from the farmer's browser to a public service — nothing is sent to
 * or stored by this app. The address string is used ONCE for geocoding and
 * then discarded; only coordinates are sent to the soil/elevation/climate
 * services.
 *
 * Sources (all verified to allow cross-origin browser requests):
 *   - Geocoding:  OpenStreetMap Nominatim
 *   - Soil:       USDA-NRCS Soil Data Access (SSURGO / Web Soil Survey)
 *   - Elevation:  USGS 3DEP Elevation Point Query Service
 *   - Climate:    Open-Meteo (ERA5 reanalysis, 1991–2020 normals)
 *
 * Every function is best-effort and fails soft: if a service is down or a
 * point has no data, that layer simply returns null and the farmer fills that
 * answer in by hand. A failure in one layer never blocks the others.
 */

(function () {
  'use strict';

  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error((label || 'request') + ' timed out')), ms))
  ]);

  async function getJson(url, opts, ms) {
    const res = await withTimeout(fetch(url, opts || {}), ms || 20000, url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return res.json();
  }

  /* ---- 1. Geocoding: address -> coordinates -------------------------- */

  // JSONP loader: some public geocoders (US Census) don't send CORS headers,
  // but do support a ?callback= wrapper, which a <script> tag can load across
  // origins. This never sends anything to our app — the browser fetches the URL.
  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const cb = '__app_jsonp_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let done = false;
      function cleanup() {
        done = true;
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        clearTimeout(timer);
      }
      const timer = setTimeout(function () { if (!done) { cleanup(); reject(new Error('geocoder timed out')); } }, timeoutMs || 20000);
      window[cb] = function (data) { if (!done) { cleanup(); resolve(data); } };
      script.onerror = function () { if (!done) { cleanup(); reject(new Error('geocoder request failed')); } };
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  // US Census geocoder — authoritative coverage of U.S. street addresses.
  async function geocodeCensus(query) {
    const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
      '?benchmark=Public_AR_Current&format=jsonp&address=' + encodeURIComponent(query);
    const data = await jsonp(url, 20000);
    const matches = data && data.result && data.result.addressMatches;
    if (!matches || !matches.length) throw new Error('no census match');
    const m = matches[0];
    return { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress || query };
  }

  // OpenStreetMap Nominatim — better for town names, landmarks, and partial queries.
  async function geocodeNominatim(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
      + encodeURIComponent(query);
    const data = await getJson(url, { headers: { 'Accept': 'application/json' } }, 20000);
    if (!Array.isArray(data) || !data.length) throw new Error('no nominatim match');
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
  }

  // Try the Census geocoder first (best for exact U.S. addresses), then fall
  // back to Nominatim (best for town names). If both miss, guide the farmer.
  async function geocode(query) {
    try { return await geocodeCensus(query); } catch (e) { /* fall through */ }
    try { return await geocodeNominatim(query); } catch (e) { /* fall through */ }
    throw new Error('Couldn’t find that address. Try a nearby town + state (e.g. "Martinsburg, WV"), ' +
      'check the spelling, or use “Use my location” and drag the pin.');
  }

  /* ---- 2. Soil: SSURGO via Soil Data Access -------------------------- */
  function mapDrainage(cl) {
    if (!cl) return null;
    const s = cl.toLowerCase();
    if (s.indexOf('excessively') !== -1) return { drainage: 'well', droughty: true };
    if (s.indexOf('well drained') !== -1 && s.indexOf('moderately') === -1) return { drainage: 'well', droughty: false };
    if (s.indexOf('moderately well') !== -1) return { drainage: 'moderate', droughty: false };
    if (s.indexOf('poorly') !== -1) return { drainage: 'wet', droughty: false }; // somewhat/poorly/very poorly
    return { drainage: 'moderate', droughty: false };
  }

  function phBand(ph) {
    if (ph == null) return null;
    if (ph < 5.5) return 'lt55';
    if (ph < 6.0) return '55-60';
    if (ph <= 6.5) return '60-65';
    return 'gt65';
  }

  async function lookupSoil(lat, lon) {
    const query =
      "SELECT TOP 1 mu.muname, c.compname, c.comppct_r, c.drainagecl, c.slope_r, c.hydricrating, " +
      "ch.ph1to1h2o_r, ch.om_r, ch.awc_r " +
      "FROM mapunit mu " +
      "INNER JOIN component c ON c.mukey = mu.mukey " +
      "LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0 " +
      "WHERE mu.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(" +
      lon + " " + lat + ")')) " +
      "ORDER BY c.comppct_r DESC";

    const data = await getJson('https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'JSON+COLUMNNAME', query: query })
    }, 30000);

    if (!data || !data.Table || data.Table.length < 2) return null;
    const cols = data.Table[0];
    const row = data.Table[1];
    const rec = {};
    cols.forEach((c, i) => { rec[c] = row[i]; });

    const ph = rec.ph1to1h2o_r != null && rec.ph1to1h2o_r !== '' ? parseFloat(rec.ph1to1h2o_r) : null;
    const slope = rec.slope_r != null && rec.slope_r !== '' ? parseFloat(rec.slope_r) : null;
    const drain = mapDrainage(rec.drainagecl);
    const om = rec.om_r != null && rec.om_r !== '' ? parseFloat(rec.om_r) : null;

    return {
      mapUnit: rec.muname || null,
      component: rec.compname || null,
      componentPct: rec.comppct_r != null ? parseFloat(rec.comppct_r) : null,
      drainageClass: rec.drainagecl || null,
      slopePct: slope,
      hydric: rec.hydricrating || null,
      surfacePh: ph,
      organicMatter: om,
      // derived questionnaire hints
      phBand: phBand(ph),
      drainage: drain ? drain.drainage : null,
      excessivelyDrained: drain ? drain.droughty : false,
      steep: slope != null ? slope >= 15 : null,
      acidic: ph != null ? ph < 5.6 : null,
      wet: drain ? drain.drainage === 'wet' : (rec.hydricrating === 'Yes')
    };
  }

  /* ---- 3. Elevation, slope & aspect: USGS 3DEP ----------------------- */
  async function elevationAt(lat, lon) {
    const url = 'https://epqs.nationalmap.gov/v1/json?x=' + lon + '&y=' + lat +
      '&units=Meters&wkid=4326&includeDate=false';
    const data = await getJson(url, {}, 15000);
    // EPQS shape has varied across versions; probe common fields.
    let v = null;
    if (data && data.value != null) v = parseFloat(data.value);
    else if (data && data.location && data.location.elevation != null) v = parseFloat(data.location.elevation);
    else if (data && data.USGS_Elevation_Point_Query_Service) {
      v = parseFloat(data.USGS_Elevation_Point_Query_Service.Elevation_Query.Elevation);
    }
    if (v == null || isNaN(v) || v <= -1000000) return null; // -1000000 is EPQS "no data"
    return v;
  }

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  async function lookupTerrain(lat, lon) {
    const center = await elevationAt(lat, lon); // required; throws if it fails
    const elevM = center;
    const result = {
      elevationM: elevM,
      elevationFt: elevM != null ? Math.round(elevM * 3.28084) : null,
      high: elevM != null ? (elevM * 3.28084) > 2500 : false,
      aspect: null, aspectDeg: null, slopeDegDEM: null
    };
    // Aspect/slope from four neighbours — best-effort, never fatal.
    try {
      const dLat = 0.0009;                               // ~100 m N-S
      const dLon = 0.0009 / Math.cos(lat * Math.PI / 180); // ~100 m E-W
      const [n, s, e, w] = await Promise.all([
        elevationAt(lat + dLat, lon), elevationAt(lat - dLat, lon),
        elevationAt(lat, lon + dLon), elevationAt(lat, lon - dLon)
      ]);
      if ([n, s, e, w].every(v => v != null)) {
        const dyM = dLat * 110540, dxM = dLon * 111320 * Math.cos(lat * Math.PI / 180);
        const gx = (e - w) / (2 * dxM); // dz/dEast
        const gy = (n - s) / (2 * dyM); // dz/dNorth
        const slopeRad = Math.atan(Math.sqrt(gx * gx + gy * gy));
        result.slopeDegDEM = Math.round(slopeRad * 180 / Math.PI);
        if (gx * gx + gy * gy > 1e-9) {
          // aspect = compass bearing of steepest descent (the way the slope faces)
          let a = Math.atan2(-gx, -gy) * 180 / Math.PI;
          a = (a + 360) % 360;
          result.aspectDeg = Math.round(a);
          result.aspect = COMPASS[Math.round(a / 45) % 8];
        }
      }
    } catch (e) { /* aspect optional */ }
    return result;
  }

  /* ---- 4. Climate normals: Open-Meteo (ERA5 1991–2020) --------------- */
  function hardinessZone(minF) {
    // USDA zone from average annual extreme minimum temperature (°F).
    // Each zone spans 5°F; value shown is the zone's lower bound.
    const zones = [
      [-40, '3a'], [-35, '3b'], [-30, '4a'], [-25, '4b'], [-20, '5a'], [-15, '5b'],
      [-10, '6a'], [-5, '6b'], [0, '7a'], [5, '7b'], [10, '8a'], [15, '8b'],
      [20, '9a'], [25, '9b'], [30, '10a']
    ];
    let zone = '3a', rank = 0;
    zones.forEach((z, i) => { if (minF >= z[0]) { zone = z[1]; rank = i; } });
    return { zone: zone, rank: rank };
  }
  const ZONE_6A_RANK = 6; // index of '6a' above; at/below this we treat the site as cold

  async function lookupClimate(lat, lon) {
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon +
      '&start_date=1991-01-01&end_date=2020-12-31' +
      '&daily=temperature_2m_min,precipitation_sum&temperature_unit=celsius&precipitation_unit=mm&timezone=auto';
    const data = await getJson(url, {}, 40000);
    if (!data || !data.daily || !data.daily.time) return null;

    const times = data.daily.time;
    const tmin = data.daily.temperature_2m_min;
    const precip = data.daily.precipitation_sum;

    // Per-year: coldest daily min (for hardiness), total precip, and the
    // growing season = days between the last spring freeze and first fall freeze.
    const byYear = {};
    const monthlySum = new Array(12).fill(0); // total precip per calendar month across all years
    const DAY_MS = 86400000;
    for (let i = 0; i < times.length; i++) {
      const date = times[i];
      const yr = date.slice(0, 4);
      const mn = tmin[i], pr = precip[i];
      let rec = byYear[yr];
      if (!rec) rec = byYear[yr] = { min: Infinity, precip: 0, lastSpring: null, firstFall: null };
      if (mn != null) {
        if (mn < rec.min) rec.min = mn;
        if (mn <= 0) {
          const month = parseInt(date.slice(5, 7), 10);
          if (month <= 6) rec.lastSpring = date;            // chronological: keeps the latest spring freeze
          else if (rec.firstFall === null) rec.firstFall = date; // first fall freeze
        }
      }
      if (pr != null) { rec.precip += pr; monthlySum[parseInt(date.slice(5, 7), 10) - 1] += pr; }
    }

    const years = Object.keys(byYear);
    let sumMin = 0, sumPrecip = 0, sumGrow = 0, nMin = 0;
    years.forEach(function (yr) {
      const rec = byYear[yr];
      if (rec.min !== Infinity) { sumMin += rec.min; nMin++; }
      sumPrecip += rec.precip;
      const spring = Date.parse((rec.lastSpring || (yr + '-01-01')) + 'T00:00:00Z');
      const fall = Date.parse((rec.firstFall || (yr + '-12-31')) + 'T00:00:00Z');
      sumGrow += Math.max(0, Math.round((fall - spring) / DAY_MS));
    });

    const avgExtremeMinC = sumMin / Math.max(1, nMin);
    const avgExtremeMinF = avgExtremeMinC * 9 / 5 + 32;
    const avgAnnualPrecipMm = sumPrecip / years.length;
    const frostFreeDays = Math.round(sumGrow / years.length);
    const hz = hardinessZone(avgExtremeMinF);

    const monthlyNormalMm = monthlySum.map(function (v) { return v / years.length; });
    let drought = null;
    try { drought = await recentDrought(lat, lon, monthlyNormalMm); } catch (e) { drought = null; }

    return {
      hardinessZone: hz.zone,
      hardinessRank: hz.rank,
      avgExtremeMinF: Math.round(avgExtremeMinF),
      frostFreeDays: frostFreeDays,
      annualPrecipIn: Math.round(avgAnnualPrecipMm / 25.4),
      // recent conditions (last ~90 days vs. normal)
      recentPrecipPctNormal: drought ? drought.pctNormal : null,
      droughtStress: drought ? drought.stress : 0,
      droughtLabel: drought ? drought.label : null,
      // derived hints
      cold: hz.rank <= ZONE_6A_RANK || frostFreeDays < 150, // zone 6a or colder, or short season
      lowRainfall: (avgAnnualPrecipMm / 25.4) < 35
    };
  }

  // Recent drought: last ~90 days of precipitation vs. the 1991–2020 normal for
  // the same calendar window. Returns percent-of-normal and a 0–1 stress score.
  function fmtDate(d) { return d.toISOString().slice(0, 10); }
  async function recentDrought(lat, lon, monthlyNormalMm) {
    const end = new Date(Date.now() - 7 * 86400000);   // ERA5 archive lags a few days
    const start = new Date(end.getTime() - 89 * 86400000);
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon +
      '&start_date=' + fmtDate(start) + '&end_date=' + fmtDate(end) +
      '&daily=precipitation_sum&precipitation_unit=mm&timezone=auto';
    const data = await getJson(url, {}, 30000);
    if (!data || !data.daily || !data.daily.time) return null;
    const t = data.daily.time, p = data.daily.precipitation_sum;
    let recentMm = 0, expectedMm = 0;
    for (let i = 0; i < t.length; i++) {
      if (p[i] != null) recentMm += p[i];
      expectedMm += monthlyNormalMm[parseInt(t[i].slice(5, 7), 10) - 1] / 30.4;
    }
    if (expectedMm <= 0) return null;
    const pct = recentMm / expectedMm;
    const stress = Math.max(0, Math.min(1, (0.85 - pct) / 0.6)); // pct>=0.85 → 0, pct<=0.25 → 1
    let label;
    if (pct < 0.5) label = 'unusually dry';
    else if (pct < 0.8) label = 'drier than normal';
    else if (pct <= 1.2) label = 'near normal';
    else label = 'wetter than normal';
    return { pctNormal: Math.round(pct * 100), stress: Math.round(stress * 100) / 100, label: label, days: t.length };
  }

  /* ---- 5. Pasture-wide soils (multiple map units across a field) ----- */

  async function sdaPost(query, ms) {
    const data = await getJson('https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'JSON+COLUMNNAME', query: query })
    }, ms || 45000);
    if (!data || !data.Table || data.Table.length < 2) return [];
    const cols = data.Table[0];
    return data.Table.slice(1).map(function (row) {
      const o = {}; cols.forEach(function (c, i) { o[c] = row[i]; }); return o;
    });
  }

  function bboxOf(poly) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    poly.forEach(function (p) {
      minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
    });
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
  }

  function pointInPoly(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // Build a square polygon of `acres` centred on a point (default ~5 acres).
  function pinSquare(lat, lon, acres) {
    const side = Math.sqrt((acres || 5) * 4046.86); // metres
    const half = side / 2;
    const dLat = half / 110540;
    const dLon = half / (111320 * Math.cos(lat * Math.PI / 180));
    return [
      [lon - dLon, lat - dLat], [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]
    ];
  }

  // Regular grid of sample points that fall inside the polygon.
  function samplePolygon(poly, n) {
    const b = bboxOf(poly);
    const cols = Math.max(3, Math.round(Math.sqrt(n)));
    const pts = [];
    for (let r = 0; r < cols; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = b.minx + (c + 0.5) / cols * (b.maxx - b.minx);
        const lat = b.miny + (r + 0.5) / cols * (b.maxy - b.miny);
        if (pointInPoly(lon, lat, poly)) pts.push([lon, lat]);
      }
    }
    if (!pts.length) pts.push([(b.minx + b.maxx) / 2, (b.miny + b.maxy) / 2]);
    return pts;
  }

  function weightedPh(list) {
    const w = list.filter(function (s) { return s.ph != null; });
    if (!w.length) return null;
    const ws = w.reduce(function (a, s) { return a + s.weight; }, 0) || 1;
    return w.reduce(function (a, s) { return a + s.ph * s.weight; }, 0) / ws;
  }

  function pastureProfile(soils) {
    const withPh = soils.filter(function (s) { return s.ph != null; });
    const wPh = weightedPh(soils);
    const drainW = {};
    soils.forEach(function (s) { if (s.drainage) drainW[s.drainage] = (drainW[s.drainage] || 0) + s.weight; });
    let pluralityDrainage = null, best = 0;
    Object.keys(drainW).forEach(function (k) { if (drainW[k] > best) { best = drainW[k]; pluralityDrainage = k; } });
    const totalW = soils.reduce(function (a, s) { return a + s.weight; }, 0) || 1;
    const sumW = function (pred) { return soils.filter(pred).reduce(function (a, s) { return a + s.weight; }, 0); };
    const acidW = sumW(function (s) { return s.acidic; });
    const steepW = sumW(function (s) { return s.steep; });
    const wetW = sumW(function (s) { return s.wet; });

    const problemAreas = [];
    if (wetW > 0.05 && wetW < 0.6 && pluralityDrainage !== 'wet') {
      const z = soils.filter(function (s) { return s.wet; });
      problemAreas.push({ key: 'wet', label: 'Wet / poorly drained spots', weightPct: Math.round(wetW * 100),
        phBand: phBand(weightedPh(z)), drainage: 'wet', challenges: ['wet'], soils: z.map(function (s) { return s.component || s.muname; }) });
    }
    const veryAcid = soils.filter(function (s) { return s.ph != null && s.ph < 5.0; });
    const vaW = veryAcid.reduce(function (a, s) { return a + s.weight; }, 0);
    if (vaW > 0.05 && vaW < 0.7 && (wPh == null || weightedPh(veryAcid) < wPh - 0.3)) {
      problemAreas.push({ key: 'acid', label: 'Strongly acidic areas', weightPct: Math.round(vaW * 100),
        phBand: phBand(weightedPh(veryAcid)), drainage: pluralityDrainage || 'well', challenges: ['acidic', 'low-fertility'],
        soils: veryAcid.map(function (s) { return s.component || s.muname; }) });
    }
    const dry = soils.filter(function (s) { return s.excessivelyDrained; });
    const dryW = dry.reduce(function (a, s) { return a + s.weight; }, 0);
    if (dryW > 0.05 && dryW < 0.6) {
      problemAreas.push({ key: 'dry', label: 'Droughty, excessively drained spots', weightPct: Math.round(dryW * 100),
        phBand: phBand(weightedPh(dry)), drainage: 'well', challenges: ['droughty'], soils: dry.map(function (s) { return s.component || s.muname; }) });
    }

    return {
      dominant: soils[0] || null,
      weightedPh: wPh,
      weightedPhBand: phBand(wPh),
      pluralityDrainage: pluralityDrainage,
      phRange: withPh.length ? { min: Math.min.apply(null, withPh.map(function (s) { return s.ph; })),
        max: Math.max.apply(null, withPh.map(function (s) { return s.ph; })) } : null,
      drainageClasses: Object.keys(drainW),
      widespread: { acidic: acidW / totalW >= 0.4, steep: steepW / totalW >= 0.4 },
      problemAreas: problemAreas
    };
  }

  async function lookupPastureSoils(poly) {
    const pts = samplePolygon(poly, 16).slice(0, 25);
    const unionQ = pts.map(function (p, i) {
      return (i === 0 ? 'SELECT ' : 'UNION ALL SELECT ') + i +
        " AS pid, mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(" + p[0] + " " + p[1] + ")')";
    }).join(' ');

    const sampleRows = await sdaPost(unionQ, 50000);
    const counts = {}; let total = 0;
    sampleRows.forEach(function (r) { if (r.mukey) { counts[r.mukey] = (counts[r.mukey] || 0) + 1; total++; } });
    if (!total) return null;

    const wkt = 'polygon((' + poly.map(function (p) { return p[0] + ' ' + p[1]; }).join(', ') + '))';
    const propRows = await sdaPost(
      "SELECT mu.mukey, mu.muname, c.compname, c.comppct_r, c.drainagecl, c.slope_r, ch.ph1to1h2o_r " +
      "FROM mapunit mu INNER JOIN component c ON c.mukey=mu.mukey " +
      "LEFT JOIN chorizon ch ON ch.cokey=c.cokey AND ch.hzdept_r=0 " +
      "WHERE mu.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('" + wkt + "')) " +
      "AND c.majcompflag='Yes' ORDER BY mu.mukey, c.comppct_r DESC", 50000);
    const byMukey = {};
    propRows.forEach(function (r) { if (!byMukey[r.mukey]) byMukey[r.mukey] = r; });

    const soils = Object.keys(counts).map(function (mukey) {
      const w = counts[mukey] / total;
      const p = byMukey[mukey] || {};
      const ph = p.ph1to1h2o_r != null && p.ph1to1h2o_r !== '' ? parseFloat(p.ph1to1h2o_r) : null;
      const slope = p.slope_r != null && p.slope_r !== '' ? parseFloat(p.slope_r) : null;
      const drain = mapDrainage(p.drainagecl);
      return {
        mukey: mukey, muname: p.muname || ('Map unit ' + mukey), component: p.compname || null,
        weightPct: Math.round(w * 100), weight: w,
        ph: ph, phBand: phBand(ph),
        drainageClass: p.drainagecl || null, drainage: drain ? drain.drainage : null,
        excessivelyDrained: drain ? drain.droughty : false,
        slope: slope, steep: slope != null ? slope >= 15 : false,
        acidic: ph != null ? ph < 5.6 : false, wet: drain ? drain.drainage === 'wet' : false
      };
    }).sort(function (a, b) { return b.weight - a.weight; });

    return { soils: soils, sampled: total, profile: pastureProfile(soils) };
  }

  /* ---- orchestration ------------------------------------------------- */
  // Runs all layers in parallel; each settles independently.
  async function lookupAll(lat, lon) {
    const [soil, terrain, climate] = await Promise.allSettled([
      lookupSoil(lat, lon), lookupTerrain(lat, lon), lookupClimate(lat, lon)
    ]);
    return {
      lat: lat, lon: lon,
      soil: soil.status === 'fulfilled' ? soil.value : null,
      soilError: soil.status === 'rejected' ? soil.reason.message : null,
      terrain: terrain.status === 'fulfilled' ? terrain.value : null,
      terrainError: terrain.status === 'rejected' ? terrain.reason.message : null,
      climate: climate.status === 'fulfilled' ? climate.value : null,
      climateError: climate.status === 'rejected' ? climate.reason.message : null
    };
  }

  function browserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported by this browser.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'your current location' }),
        (err) => reject(new Error(err.code === 1 ? 'Location permission denied.' : 'Could not get your location.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  window.APP_GEO = {
    geocode: geocode,
    browserLocation: browserLocation,
    lookupAll: lookupAll,
    lookupSoil: lookupSoil,
    lookupTerrain: lookupTerrain,
    lookupClimate: lookupClimate,
    lookupPastureSoils: lookupPastureSoils,
    pinSquare: pinSquare
  };
})();
