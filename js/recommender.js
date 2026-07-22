/*
 * Appalachian Pasture Planner — recommendation engine
 *
 * Pure scoring/composition logic, deliberately transparent so the reasoning
 * can be shown to the producer and audited against the source data. No
 * framework, no build step. See README.md for how scores are formed.
 */

const PH_BAND_VALUE = {
  'unknown': null,
  'lt55': 5.2,
  '55-60': 5.8,
  '60-65': 6.2,
  'gt65': 6.8
};

// A producer who can lime is assumed to raise pH into this range.
const LIME_TARGET_PH = 6.5;

/* ---- individual scoring factors ---------------------------------------- */

function scorePh(sp, ctx) {
  const ph = ctx.phValue;
  if (ph === null) {
    return { points: 0, reason: null, hardFail: false, limeNote: false };
  }
  if (ph >= sp.phMin && ph <= sp.phMax) {
    return { points: 3, reason: 'Well suited to your soil pH', hardFail: false, limeNote: false };
  }
  if (ph >= sp.phTolerantLow && ph < sp.phMin) {
    return { points: 1.5, reason: 'Tolerates your soil pH (a little acidic for it)', hardFail: false, limeNote: false };
  }
  if (ph < sp.phTolerantLow) {
    // Too acidic. Can liming fix it?
    if (ctx.canLime && sp.phMin <= LIME_TARGET_PH) {
      return { points: 1, reason: 'Workable once you lime up to about pH 6.5', hardFail: false, limeNote: true };
    }
    return { points: -4, reason: null, hardFail: true, limeNote: false };
  }
  // ph > phMax (too alkaline — uncommon in Appalachia)
  return { points: -1, reason: null, hardFail: false, limeNote: false };
}

function scoreDrainage(sp, ctx) {
  const d = ctx.drainage; // 'well' | 'moderate' | 'wet'
  const tolerated = d === 'wet'
    ? (sp.drainage.includes('poor') || sp.drainage.includes('wet'))
    : sp.drainage.includes(d);
  if (tolerated) {
    const label = d === 'wet' ? 'poorly drained / wet' : d + '-drained';
    return { points: 3, reason: 'Handles your ' + label + ' soils', hardFail: false };
  }
  return { points: -4, reason: null, hardFail: true };
}

const GOAL_REASON = {
  'extend-grazing': 'Helps extend the grazing season',
  'soil-health': 'Builds soil health and organic matter',
  'drought': 'Holds up in summer drought',
  'reduce-fescue-tox': 'Helps dilute or replace toxic fescue',
  'nitrogen': 'Fixes nitrogen, cutting fertilizer need',
  'pollinators': 'Supports pollinators and wildlife',
  'erosion': 'Protects against erosion',
  'hay': 'Suited to hay / stored feed',
  'quick-establish': 'Establishes quickly',
  'summer-forage': 'Productive in the mid-summer slump',
  'low-input': 'Thrives with low inputs'
};

const CHALLENGE_REASON = {
  'low-fertility': 'Tolerates low fertility',
  'acidic': 'Tolerates acidic soil',
  'slopes': 'Works on slopes',
  'wet': 'Tolerates wet ground',
  'droughty': 'Tolerates droughty / shallow soils',
  'toxic-fescue': 'Good partner for diluting toxic fescue',
  'weeds': 'Competes against weeds once established'
};

// Grazing pressure by management category (1 = gentle, 5 = severe). Higher
// pressure rewards grazing-tolerant species and penalizes sensitive ones.
const GRAZING_PRESSURE = {
  'continuous-heavy': 5,
  'rot-overgrazed': 4.5,
  'continuous-light': 3.5,
  'rot-managed': 2,
  'mob': 1
};

// Importance-weighted matching: each goal/challenge the farmer cares about is a
// 0-7 slider; a species that serves it scores in proportion to that importance.
function scorePriorities(sp, ctx, reasons) {
  let pts = 0;
  const imp = ctx.imp;
  sp.goalsServed.forEach(function (g) {
    const w = imp(g); if (w > 0) { pts += w * 0.5; if (w >= 4 && GOAL_REASON[g]) reasons.push(GOAL_REASON[g]); }
  });
  sp.challengesFit.forEach(function (c) {
    const w = imp(c); if (w > 0) { pts += w * 0.5; if (w >= 4 && CHALLENGE_REASON[c]) reasons.push(CHALLENGE_REASON[c]); }
  });
  // Stand longevity slider vs. the species' persistence (1 short-lived, 5 long-lived).
  const li = imp('stand-longevity');
  if (li > 0) {
    pts += (li / 7) * ((sp.longevity || 4) - 3) * 1.5;
    if (li >= 4 && (sp.longevity || 4) >= 4) reasons.push('Long-lived and persistent');
    else if (li >= 4 && (sp.longevity || 4) <= 2) reasons.push('Short-lived — plan to reseed');
  }
  return pts;
}

function scoreConditions(sp, ctx, reasons) {
  let pts = 0;
  const imp = ctx.imp;

  // Drought emphasis: the strongest of the droughty/drought/summer sliders (0-1),
  // plus aspect and recent drought.
  const droughtEmph = Math.max(imp('droughty'), imp('drought'), imp('summer-forage')) / 7;
  if (droughtEmph > 0) pts += droughtEmph * (sp.droughtTolerance - 3) * 1.6;

  // Aspect: SW-facing ground is warmer/drier, NE cooler/moister; scaled by slope.
  if (ctx.aspectDryness) {
    pts += ctx.aspectDryness * (sp.droughtTolerance - 3) * 1.4;
    if (ctx.aspectDryness > 0.35 && sp.droughtTolerance >= 4) reasons.push('Good fit for your warm, dry south/west-facing slope');
    else if (ctx.aspectDryness < -0.35 && sp.droughtTolerance <= 2) reasons.push('Suited to your cool, moist north-facing slope');
  }
  if (ctx.recentDroughtStress > 0.15) {
    pts += ctx.recentDroughtStress * (sp.droughtTolerance - 3) * 1.1;
    if (ctx.recentDroughtStress > 0.4 && sp.droughtTolerance >= 4) reasons.push('Extra resilient for the recent dry spell in your area');
  }

  const wetEmph = imp('wet') / 7;
  if (wetEmph > 0) pts += wetEmph * (sp.floodTolerance - 3) * 1.3;

  const fertEmph = imp('low-fertility') / 7;
  if (fertEmph > 0) {
    pts += fertEmph * (sp.fertilityNeed === 'low' ? 2.5 : (sp.fertilityNeed === 'high' ? -2.5 : 0));
    if (sp.nitrogenFixer) pts += fertEmph * 1.5;
  }

  // Soil texture. Heavy clay (common on WV uplands) suits some species far
  // better than others; light/coarse ground dries out and rewards deep roots.
  if (ctx.texture === 'heavy') {
    pts += ((sp.clayTolerance || 3) - 3) * 1.5;
    if ((sp.clayTolerance || 3) >= 4) reasons.push('Handles heavy clay soils');
    else if ((sp.clayTolerance || 3) <= 2) reasons.push('Wants better internal drainage than heavy clay gives');
  } else if (ctx.texture === 'light') {
    pts += (sp.droughtTolerance - 3) * 0.6 + ((sp.rootDepth || 3) - 3) * 0.4;
    if (sp.droughtTolerance >= 4) reasons.push('Suited to light, quick-draining ground');
  }

  // Compaction: deep-rooted species help break up a compacted profile.
  if (ctx.compaction > 0) {
    pts += (ctx.compaction / 7) * ((sp.rootDepth || 3) - 3) * 1.6;
    if (ctx.compaction >= 4 && (sp.rootDepth || 3) >= 4) reasons.push('Deep roots help break up compacted soil');
  }

  // Grazing pressure vs. grazing tolerance.
  const pressure = GRAZING_PRESSURE[ctx.grazing] != null ? GRAZING_PRESSURE[ctx.grazing] : 3;
  pts += (pressure - 3) * (sp.grazingTolerance - 3) * 0.4;
  if (pressure >= 4.5 && sp.grazingTolerance <= 2) reasons.push('Watch grazing — sensitive to your pressure; rest it');
  else if (pressure >= 4.5 && sp.grazingTolerance >= 5) reasons.push('Tough enough for hard / continuous grazing');

  // Establishment: is a reliable method (drill/tillage) available, or broadcast only?
  const methods = ctx.methods || [];
  const hasReliable = methods.some(function (m) { return /drill|notill|no-till|tillage/.test(m); });
  const estFactor = methods.length ? (hasReliable ? 0.4 : 1.1) : 0.6;
  pts += estFactor * (sp.establishmentEase - 3);
  if (!hasReliable && methods.length && sp.establishmentEase <= 2) reasons.push('Hard to broadcast — a drill would help establishment');

  if (ctx.cold) pts += (sp.winterHardiness - 3) * 0.9;

  return pts;
}

/* ---- local (your) data ------------------------------------------------- */

function localObservationFor(sp, ctx, local) {
  if (!local || !local.observations) return null;
  for (const obs of local.observations) {
    if (obs.enabled === false) continue;
    if (obs.speciesId !== sp.id) continue;
    const c = obs.conditions;
    if (c) {
      if (ctx.phValue !== null && c.phMin != null && ctx.phValue < c.phMin) continue;
      if (ctx.phValue !== null && c.phMax != null && ctx.phValue > c.phMax) continue;
      if (c.drainage && c.drainage.length && c.drainage.indexOf(ctx.drainage) === -1) continue;
    }
    return obs;
  }
  return null;
}

/* ---- per-species score ------------------------------------------------- */

function scoreSpecies(sp, ctx, local) {
  const reasons = [];
  const ph = scorePh(sp, ctx);
  const drain = scoreDrainage(sp, ctx);

  if (ph.hardFail || drain.hardFail) {
    return { species: sp, score: -Infinity, disqualified: true, reasons: [], limeNote: false, local: null };
  }

  let score = ph.points + drain.points;
  if (ph.reason) reasons.push(ph.reason);
  if (drain.reason) reasons.push(drain.reason);

  score += scorePriorities(sp, ctx, reasons);
  score += scoreConditions(sp, ctx, reasons);

  if (sp.nitrogenFixer && ctx.imp('nitrogen') < 4 && reasons.indexOf('Fixes nitrogen, cutting fertilizer need') === -1) {
    // note N-fixation as a passive plus even when not a stated goal
    reasons.push('Adds nitrogen to the stand');
  }

  const obs = localObservationFor(sp, ctx, local);
  let localInfo = null;
  if (obs && typeof obs.establishmentSuccess === 'number') {
    const adj = (obs.establishmentSuccess - 0.5) * 4;
    score += adj;
    localInfo = { establishmentSuccess: obs.establishmentSuccess, note: obs.note || '' };
    reasons.unshift('WV trial: ' + Math.round(obs.establishmentSuccess * 100) + '% establishment on comparable sites');
  }

  // de-duplicate reasons, keep order
  const seen = {};
  const uniqueReasons = reasons.filter(function (r) { if (seen[r]) return false; seen[r] = 1; return true; });

  return {
    species: sp,
    score: score,
    disqualified: false,
    reasons: uniqueReasons,
    limeNote: ph.limeNote,
    local: localInfo
  };
}

/* ---- mix composition --------------------------------------------------- */

function pickTop(list, n, minScore) {
  return list.filter(function (r) { return r.score > minScore; }).slice(0, n);
}

function composeMix(scored, ctx) {
  const season = ctx.season || 'both'; // 'cool' | 'warm' | 'both'
  let eligible = scored.filter(function (r) { return !r.disqualified && r.score > -Infinity; });
  if (season === 'warm') eligible = eligible.filter(function (r) { return r.species.season === 'warm'; });
  else if (season === 'cool') eligible = eligible.filter(function (r) { return r.species.season === 'cool'; });
  eligible.sort(function (a, b) { return b.score - a.score; });

  const coolGrass = eligible.filter(function (r) { return r.species.type === 'grass' && r.species.season === 'cool'; });
  const warmGrass = eligible.filter(function (r) { return r.species.type === 'grass' && r.species.season === 'warm'; });
  const legumes = eligible.filter(function (r) { return r.species.type === 'legume'; });
  const forbs = eligible.filter(function (r) { return r.species.type === 'forb'; });

  const chosen = [];
  function add(r) { if (r && chosen.indexOf(r) === -1) chosen.push(r); }

  // Grasses — tuned to the seasonal strategy.
  if (season === 'warm') {
    warmGrass.slice(0, 2).forEach(add);
  } else if (season === 'cool') {
    if (coolGrass[0]) add(coolGrass[0]);
    if (coolGrass[1] && coolGrass[1].score > 0 && coolGrass[1].score >= coolGrass[0].score * 0.6) add(coolGrass[1]);
  } else { // both — pair a cool-season and a warm-season grass for year-round growth
    if (coolGrass[0]) add(coolGrass[0]);
    if (warmGrass[0] && warmGrass[0].score > 0) add(warmGrass[0]);
    if (coolGrass[1] && coolGrass[1].score > 0 && coolGrass[1].score >= coolGrass[0].score * 0.65) add(coolGrass[1]);
  }

  // Legumes: one or two (aim ~30-40% of the mix).
  const legPicks = pickTop(legumes, 2, -2);
  if (!legPicks.length && legumes.length) legPicks.push(legumes[0]);
  legPicks.forEach(add);

  // Forbs: one or two for diversity (aim ~10-20% of the mix).
  let forbPicks = pickTop(forbs, 2, -1).slice(0, 2);
  if (!forbPicks.length && forbs.length) forbPicks.push(forbs[0]);
  forbPicks.forEach(add);

  return {
    mix: chosen,
    alternates: { coolGrass: coolGrass, warmGrass: warmGrass, legumes: legumes, forbs: forbs }
  };
}

/* ---- seed plan: composition targeting + PLS math ----------------------- */

// Target functional-group composition, as a fraction of estimated GROUND COVER.
// Midpoints of 45-55% grass, 30-40% legume, 10-20% forb.
var COMPOSITION_TARGET = { grass: 0.50, legume: 0.35, forb: 0.15 };

// Estimated ground cover is back-calculated from seeding rate relative to a pure
// (monoculture) stand: a species seeded at X% of its full rate contributes ~X of
// a "stand". Cover share_i ∝ plsRate_i / monoRate_i. To hit a target cover split,
// allocate PLS so each species' rate = totalPls · coverFrac_i · monoRate_i / Σ(...).
function monoMid(sp) {
  const lo = sp.seedingRateMonoLow, hi = sp.seedingRateMonoHigh;
  const m = (lo != null && hi != null) ? (lo + hi) / 2 : (sp.seedingRateMixLow + sp.seedingRateMixHigh);
  return m > 0 ? m : 1;
}

// `overrides` lets a producer type the purity/germination printed on the seed
// tag they actually bought, per species: { speciesId: {purity, germ} }.
function buildSeedPlan(mix, prepData, totalPls, overrides) {
  totalPls = totalPls || 12;
  const prep = (prepData && prepData.species) || {};
  const ov = overrides || {};
  const groups = { grass: [], legume: [], forb: [] };
  mix.forEach(function (m) { if (groups[m.species.type]) groups[m.species.type].push(m); });

  const present = Object.keys(groups).filter(function (g) { return groups[g].length; });
  const tsum = present.reduce(function (a, g) { return a + COMPOSITION_TARGET[g]; }, 0) || 1;

  // Desired ground-cover fraction per species: split each group's (normalized)
  // target cover equally among its members.
  const coverFrac = {};
  present.forEach(function (g) {
    const share = (COMPOSITION_TARGET[g] / tsum) / groups[g].length;
    groups[g].forEach(function (m) { coverFrac[m.species.id] = share; });
  });

  // Denominator Σ(coverFrac · monoMid) sets the scaling so rates sum to totalPls.
  let denom = 0;
  mix.forEach(function (m) { denom += coverFrac[m.species.id] * monoMid(m.species); });
  denom = denom || 1;

  const rows = [];
  mix.forEach(function (m) {
    const sp = m.species;
    const cover = coverFrac[sp.id];
    const pls = totalPls * cover * monoMid(sp) / denom;
    const p = prep[sp.id];
    const o = ov[sp.id] || {};
    const purity = o.purity != null ? o.purity : (p && p.purity);
    const germ = o.germ != null ? o.germ : (p && p.germ);
    const plsFrac = purity && germ ? (purity * germ / 10000) : 0.85;
    const price = (p && p.pricePerPlsLb) || [6, 12];
    rows.push({
      species: sp, group: sp.type, prep: p || null,
      purity: purity, germ: germ, fromTag: !!(o.purity != null || o.germ != null),
      coverPct: cover * 100,
      plsRate: pls, plsPct: plsFrac * 100, bulkRate: pls / plsFrac,
      costLow: pls * price[0], costHigh: pls * price[1]
    });
  });

  const order = { grass: 0, legume: 1, forb: 2 };
  rows.sort(function (a, b) { return order[a.group] - order[b.group] || b.coverPct - a.coverPct; });

  const totals = { pls: 0, bulk: 0, costLow: 0, costHigh: 0 };
  const composition = { grass: 0, legume: 0, forb: 0 };
  rows.forEach(function (r) {
    totals.pls += r.plsRate; totals.bulk += r.bulkRate; totals.costLow += r.costLow; totals.costHigh += r.costHigh;
    composition[r.group] += r.coverPct;
  });
  Object.keys(composition).forEach(function (g) { composition[g] = Math.round(composition[g]); });

  return { rows: rows, totals: totals, composition: composition, totalPls: totalPls };
}

/* ---- management resources + sources ------------------------------------ */

function gatherResources(ctx, resourcesData) {
  const active = {};
  const triggers = [];
  Object.keys(ctx.priorities || {}).forEach(function (id) { if (ctx.priorities[id] >= 3) triggers.push(id); });
  (ctx.methods || []).forEach(function (m) {
    triggers.push(m);
    if (/drill|notill|no-till/.test(m)) triggers.push('no-till');
    if (/broadcast/.test(m)) triggers.push('broadcast');
    if (/frost/.test(m)) triggers.push('frost-seed', 'broadcast');
  });
  triggers.push('always');
  return resourcesData.resources.filter(function (r) {
    return r.triggers.some(function (t) {
      if (active[r.id]) return false;
      const hit = triggers.indexOf(t) !== -1;
      if (hit) active[r.id] = true;
      return hit;
    });
  });
}

function gatherSources(mix, resources, sourcesData, local) {
  const ids = {};
  mix.forEach(function (r) { (r.species.sources || []).forEach(function (s) { ids[s] = true; }); });
  resources.forEach(function (r) { (r.sources || []).forEach(function (s) { ids[s] = true; }); });
  const list = Object.keys(ids)
    .map(function (id) { return Object.assign({ id: id }, sourcesData.sources[id]); })
    .filter(function (s) { return s.title; });

  // Include the local-data citation if any observation informed the mix.
  const usedLocal = mix.some(function (r) { return r.local; });
  if (usedLocal && local && local.meta && local.meta.citation && local.meta.citation.title) {
    list.unshift(Object.assign({ id: local.meta.citationId || 'local', isLocal: true }, local.meta.citation));
  }
  return list;
}

/* ---- public entry point ------------------------------------------------ */

// Turn a soil test (or "I don't know") into a 0-7 low-fertility emphasis.
// Thresholds reflect typical extractable levels for Appalachian pasture.
function fertilityEmphasis(answers, af) {
  const p = parseFloat(answers.soilP), k = parseFloat(answers.soilK), om = parseFloat(answers.soilOM);
  const haveAny = !isNaN(p) || !isNaN(k) || !isNaN(om);
  if (answers.fertilityUnknown || !haveAny) {
    // Fall back to the mapped organic matter if the soil lookup gave us one,
    // else assume the low-to-moderate fertility typical of Appalachian hill pasture.
    const mappedOm = af.organicMatter;
    if (mappedOm != null) return mappedOm < 2 ? 5 : (mappedOm < 3.5 ? 4 : 3);
    return 4;
  }
  let pts = 0, n = 0;
  if (!isNaN(p)) { pts += p < 15 ? 2 : (p <= 30 ? 1 : 0); n++; }
  if (!isNaN(k)) { pts += k < 100 ? 2 : (k <= 175 ? 1 : 0); n++; }
  if (!isNaN(om)) { pts += om < 2 ? 2 : (om <= 4 ? 1 : 0); n++; }
  return n ? Math.round((pts / (n * 2)) * 7) : 4;
}

function buildContext(answers) {
  const af = answers.autofill || {};

  // Aspect dryness: peak dryness at SW (225°), peak moisture at NE (45°),
  // scaled by slope steepness so it barely matters on flat ground.
  let aspectDryness = 0;
  if (af.aspectDeg != null && af.slopePct != null) {
    const dry = Math.cos((af.aspectDeg - 225) * Math.PI / 180); // +1 at SW, -1 at NE
    const steep = Math.min(af.slopePct / 25, 1);
    aspectDryness = dry * steep;
  }

  // Site-condition factors are DERIVED from questions already asked (pH,
  // drainage, slope, soil test) rather than asked again as "challenges".
  const derived = {};
  if (answers.ph === 'lt55') derived.acidic = 6;
  else if (answers.ph === '55-60') derived.acidic = 4;
  if (answers.drainage === 'wet') derived.wet = 6;
  else if (answers.drainage === 'well') derived.droughty = 2;
  const slopePct = af.slopePct;
  if (slopePct != null && slopePct >= 15) derived.slopes = 5;
  else if (slopePct != null && slopePct >= 8) derived.slopes = 3;
  const fert = fertilityEmphasis(answers, af);
  if (fert > 0) derived['low-fertility'] = fert;

  // The farmer's own sliders take precedence where they are higher.
  const stated = answers.priorities || {};
  const priorities = Object.assign({}, derived);
  Object.keys(stated).forEach(function (k) { priorities[k] = Math.max(priorities[k] || 0, stated[k]); });

  return {
    phValue: PH_BAND_VALUE[answers.ph],
    canLime: !!answers.canLime,
    drainage: answers.drainage,
    priorities: priorities,
    fertilityEmphasis: fert,
    texture: answers.texture && answers.texture !== 'unknown' ? answers.texture : (af.texture || null),
    clayPct: af.clayPct != null ? af.clayPct : null,
    compaction: Math.max(0, Math.min(7, answers.compaction || 0)),
    imp: function (id) { return priorities[id] || 0; },
    methods: answers.methods || [],
    grazing: answers.grazing || 'rot-managed',
    cold: answers.elevation === 'high',
    season: answers.season || 'both',
    aspectDryness: aspectDryness,
    recentDroughtStress: Math.max(0, Math.min(1, af.recentDroughtStress || 0))
  };
}

function recommend(answers, data) {
  const ctx = buildContext(answers);
  const scored = data.species.map(function (sp) { return scoreSpecies(sp, ctx, data.local); });
  const composed = composeMix(scored, ctx);
  const resources = gatherResources(ctx, data.resources);
  const sources = gatherSources(composed.mix, resources, data.sources, data.local);
  const usedLocal = composed.mix.some(function (r) { return r.local; });
  return { ctx: ctx, mix: composed.mix, scored: scored, alternates: composed.alternates, resources: resources, sources: sources, usedLocal: usedLocal };
}

/* ---- pasture-wide (multi-soil) recommendation -------------------------- */

function uniq(arr) { const seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }

// Build a full answers object for one "zone" (a soil condition set), keeping the
// farmer's stated goals/method/grazing/aspect but swapping in the zone's pH,
// drainage, and extra challenges.
function zoneAnswers(farmer, phBand, drainage, extraChallenges) {
  // Copy the farmer's priority sliders, then raise any extra challenge factors
  // (e.g. 'wet' for a wet sub-area) so the zone's picks reflect that condition.
  const priorities = Object.assign({}, farmer.priorities || {});
  (extraChallenges || []).forEach(function (c) { priorities[c] = Math.max(priorities[c] || 0, 6); });
  return {
    elevation: farmer.elevation,
    ph: phBand || 'unknown',
    canLime: farmer.canLime,
    drainage: drainage || farmer.drainage,
    priorities: priorities,
    methods: farmer.methods,
    grazing: farmer.grazing,
    season: farmer.season,
    autofill: farmer.autofill
  };
}

// Two-tier plan: a robust whole-pasture base mix tuned to the dominant/average
// conditions and any field-wide variability, plus targeted species for minority
// problem sub-areas (wet toeslopes, very acidic knobs, droughty spots).
function recommendPasture(farmer, profile, data) {
  const baseChallenges = [];
  if (profile.widespread.acidic) baseChallenges.push('acidic');
  if (profile.widespread.steep) baseChallenges.push('slopes');

  const baseAns = zoneAnswers(farmer, profile.weightedPhBand, profile.pluralityDrainage, baseChallenges);
  const base = recommend(baseAns, data);

  const baseIds = {};
  base.mix.forEach(function (m) { baseIds[m.species.id] = 1; });

  const problems = (profile.problemAreas || []).map(function (pa) {
    const rec = recommend(zoneAnswers(farmer, pa.phBand, pa.drainage, pa.challenges), data);
    const picks = rec.mix.filter(function (m) { return !baseIds[m.species.id]; }).slice(0, 3);
    return { area: pa, picks: picks };
  }).filter(function (p) { return p.picks.length; });

  return { base: base, problems: problems, profile: profile };
}

/* ---- custom establishment plan ----------------------------------------- */

const GRAZE_ADVICE = {
  'continuous-heavy': 'This stand is grazed continuously and short. Be straight with yourself: a diverse mix will not persist under that. If you change one thing, add rest — even splitting the field in two and alternating will hold legumes and forbs far longer. Otherwise the mix will drift toward the toughest grasses.',
  'continuous-light': 'Light continuous grazing will hold a simple stand, but legumes and forbs still thin out without recovery time. Splitting into 2–3 paddocks to give 20–30 days of rest would pay for itself.',
  'rot-overgrazed': 'You already have the paddocks — the gap is rest and residual, and this is the most common way good mixes are lost in West Virginia. More paddocks will not fix it; longer rest will. Stop grazing at a 3–4 inch residual and do not return until regrowth reaches 8–10 inches.',
  'rot-managed': 'Keep doing what you are doing: graze to a 3–4 inch residual and rest each paddock until it regrows to 8–10 inches. That residual is exactly what keeps legumes and forbs in the stand.',
  'mob': 'High-density grazing with long rest suits this mix well. Just watch that rest periods do not stretch so long that the grasses go rank and shade out the legumes and forbs.'
};

// Builds a step-by-step establishment plan written for THIS mix, THIS soil and
// THESE seeding methods, rather than a set of generic guidance cards.
function buildEstablishmentPlan(ctx, mix, prepData) {
  const prep = (prepData && prepData.species) || {};
  const sp = mix.map(function (m) { return m.species; });
  const names = function (a) { return a.map(function (s) { return s.commonName; }).join(', '); };
  const legumes = sp.filter(function (s) { return s.nitrogenFixer; });
  const nativeWarm = sp.filter(function (s) { return s.native && s.season === 'warm' && s.type === 'grass'; });
  const coolSp = sp.filter(function (s) { return s.season === 'cool'; });
  const warmSp = sp.filter(function (s) { return s.season === 'warm'; });
  const methods = ctx.methods || [];
  const has = function (m) { return methods.indexOf(m) !== -1; };
  const steps = [];

  // 1 — pH / lime
  const needsHighPh = sp.some(function (s) { return s.phMin >= 6.4; });
  const targetPh = needsHighPh ? '6.5–6.8' : '6.0–6.5';
  let limeBody;
  if (ctx.phValue == null) {
    limeBody = 'Pull a soil test before you buy any seed — it is the cheapest decision in this whole plan. Aim for pH ' + targetPh + ' for this mix.';
  } else if (ctx.phValue < 5.8) {
    limeBody = 'Your pH is low for this mix. Lime as far ahead of seeding as you can — 6–12 months is ideal, because lime reacts slowly. Target pH ' + targetPh + '.' +
      (ctx.canLime ? '' : ' You indicated liming is not an option, so this mix leans on the acid-tolerant species; expect lower yield than a limed field.');
  } else {
    limeBody = 'Your pH is workable for this mix. Hold it at ' + targetPh + ' and re-test every 2–3 years.';
  }
  if (needsHighPh) limeBody += ' Note that ' + names(sp.filter(function (s) { return s.phMin >= 6.4; })) + ' in this mix needs the higher end of that range.';
  steps.push({ title: 'Soil test and lime first', body: limeBody });

  // 2 — fertility
  let fertBody;
  if (ctx.fertilityEmphasis >= 5) fertBody = 'Fertility reads low. Correct phosphorus and potassium to soil-test recommendation before seeding — seedlings, and especially legumes, cannot fix nitrogen without adequate P and K.';
  else if (ctx.fertilityEmphasis >= 3) fertBody = 'Fertility reads moderate. Apply P and K to soil-test recommendation at seeding.';
  else fertBody = 'Fertility looks adequate. Maintain P and K on a regular soil-test cycle.';
  if (legumes.length) {
    fertBody += ' Skip the nitrogen fertilizer: with ' + legumes.length + ' legume' + (legumes.length > 1 ? 's' : '') +
      ' in this mix (' + names(legumes) + '), applied N mostly feeds grass and weeds and shuts down nodulation.';
  }
  steps.push({ title: 'Fertility', body: fertBody });

  // 3 — compaction (only when flagged)
  if (ctx.compaction >= 3) {
    const deep = sp.filter(function (s) { return (s.rootDepth || 3) >= 4; });
    steps.push({
      title: 'Compaction', body: 'You rated compaction ' + ctx.compaction + '/7. The deep-rooted species here — ' +
        (deep.length ? names(deep) : 'none currently') + ' — will open the profile over a few seasons. Just as important: keep stock off saturated ground and avoid driving or working the field wet, or you will rebuild the pan faster than roots can break it.'
    });
  }

  // 4 — seedbed (texture-aware, with the standard firmness test)
  const heavy = ctx.texture === 'heavy';
  const seedbedBullets = has('tillage') ? [
    'Aim for a seedbed that is <strong>firm (not hard), fine (not powdered), and moist (not muddy)</strong>, and free of perennial weeds before you start.',
    '<strong>The footprint test:</strong> walk across the worked ground — your boot should sink <strong>no more than about ¼ inch</strong>. If you sink deeper, it is too loose: cultipack again before seeding.',
    'Cultipack <strong>before</strong> seeding to firm the bed, and <strong>again after</strong> to close the seed in. A firm bed pulls moisture up to the seed by capillary action, which is what carries seedlings through a dry spell.'
  ] : [
    'Suppress the existing sod so seedlings get light: graze or clip hard to 2–3 inches, and/or use a burndown ahead of drilling. Remove or graze off heavy residue so the openers can reach soil.',
    'Check that the drill has working <strong>press wheels</strong> to firm soil around each seed. Press wheels matter more the heavier the soil and the drier the conditions' + (heavy ? ' — and your ground reads as heavy clay, so this is worth checking before you start.' : '.'),
    'Make sure the drill is heavy enough to penetrate, and re-check depth every few passes as conditions change across the field.'
  ];
  steps.push({ title: 'Prepare the seedbed', bullets: seedbedBullets });

  // 5 — when and how to seed (built from the selected methods)
  const seedBullets = [];
  if (has('drill-fall') || has('broadcast-fall') || has('tillage')) {
    seedBullets.push('<strong>Late summer / early fall (mid-Aug – mid-Sep):</strong> ' +
      (has('drill-fall') ? 'drill' : 'broadcast and cultipack') + ' the cool-season species — ' +
      (coolSp.length ? names(coolSp) : names(sp)) + '. Fall beats spring for cool-season stands: less weed pressure and warm soil with cooling air.');
  }
  if (warmSp.length && (has('drill-spring') || has('broadcast-spring') || has('tillage'))) {
    seedBullets.push('<strong>Mid-April – May, soil above 60 °F:</strong> seed the warm-season species — ' + names(warmSp) +
      '. These are slow out of the gate; judge the stand at the end of year two, not year one.');
  }
  if (has('frost-seed')) {
    const fsl = legumes.filter(function (s) { return s.season === 'cool'; });
    seedBullets.push('<strong>Late winter (Feb – early Mar):</strong> frost-seed ' + (fsl.length ? names(fsl) : 'the legumes') +
      ' onto short sod. Freeze–thaw cycles work seed into the surface. Graze or clip hard first so seed reaches bare soil.');
  }
  if (!seedBullets.length) seedBullets.push('Seed each species inside the planting window shown in its row of the table above.');
  steps.push({ title: 'When and how to seed', bullets: seedBullets });

  // 6 — depth & calibration (texture-aware)
  const gama = sp.some(function (s) { return s.id === 'eastern-gamagrass'; });
  const depthBullets = [
    'Where conditions are good, aim for <strong>less than ¼ inch</strong>' +
      (gama ? ' — except eastern gamagrass, which wants roughly 1 inch' : '') +
      '. Seeding too deep is the single most common cause of failure, especially with small seed and especially no-till.',
    '<strong>Texture changes the target:</strong> the heavier and wetter the soil, the <em>shallower</em> you plant; the lighter and drier the soil, the deeper you can go.' +
      (ctx.texture === 'heavy' ? ' Your ground reads as <strong>heavy clay</strong> — stay at the shallow end and do not chase moisture by going deeper.'
        : ctx.texture === 'light' ? ' Your ground reads as <strong>lighter textured</strong>, so the deeper end of the range is safer against drying out.' : ''),
    'No-till drills often place seed deeper than you think (½–¾ inch or more). Dig behind the drill and check before you plant the whole field.',
    'On fluffy native seed, roughly 30% should still be visible on the surface after planting.',
    'Calibrate using the <strong>bulk</strong> pounds in the table, never the PLS pounds.'
  ];
  steps.push({ title: 'Depth and drill calibration', bullets: depthBullets });

  // 7 — boxes and inoculation
  const boxes = {};
  mix.forEach(function (m) { const b = (prep[m.species.id] || {}).seedBox || 'Other'; (boxes[b] = boxes[b] || []).push(m.species.commonName); });
  let boxBody = Object.keys(boxes).map(function (b) { return '<strong>' + b + ':</strong> ' + boxes[b].join(', '); }).join('. ') + '.';
  if (legumes.length) boxBody += ' Inoculate every legume with the correct rhizobium strain immediately before planting and keep treated seed out of direct sun — kura clover needs its own specific inoculant.';
  steps.push({ title: 'Splitting the mix and inoculating', body: boxBody });

  // 8 — native seed handling
  if (nativeWarm.length) {
    steps.push({
      title: 'Handling native warm-season seed', body: 'Native grass seed (' + names(nativeWarm) +
        ') is light and chaffy. Use a native-seed box or a drill with picker wheels, or ask your supplier for debearded seed. Expect most of year one to go into roots rather than top growth — that is normal, not failure.'
    });
  }

  // 9 — first-year weed control (the step that usually decides the stand)
  steps.push({
    title: 'Control weeds the first year — this decides the stand', bullets: [
      'Weeds are the main reason new seedings fail. They grow faster than forage seedlings and <strong>shade them out</strong>; left alone they thin the stand, and it may never fully recover.',
      '<strong>Clip — but not too early.</strong> Clipping while weeds are still short only takes the tips and leaves buds low on the stem, which branch out and compete harder. Let weeds grow enough that clipping removes most of those growing points.',
      'Mow <strong>no lower than 3–4 inches</strong>, so you cut weeds off above the forage seedlings instead of scalping them.',
      '<strong>Never let weeds set seed</strong> in the establishment year — you will fight that seedbank for years.',
      'Clip only as often as you need to. Repeated clipping also sets seedlings back and cuts next year\'s yield.' +
        (legumes.length ? ' Avoid broadleaf herbicides over new legume seedlings; clipping is the safer tool here.' : '')
    ]
  });

  // 10 — first grazing
  const springSeed = has('drill-spring') || has('broadcast-spring');
  steps.push({
    title: 'First grazing — wait on roots, not height', bullets: [
      '<strong>Tug test:</strong> grab a handful of plants and pull. If they come out of the ground, the roots cannot anchor against a grazing animal yet — mow again and wait.',
      'A proven sequence: let the stand reach <strong>10–12 inches</strong> and mow to <strong>3–4 inches</strong>; let it regrow to 10–12 inches and mow to 3–4 inches a second time; when it reaches 10–12 inches again it is usually ready for a first, light grazing.',
      'Graze <strong>no lower than 3–4 inches</strong>, and only when the soil surface is dry and firm. Never graze a new stand in wet conditions — especially on a tilled seedbed — or you will pug the field and pull plants out.',
      springSeed ? 'For spring seedings, stop grazing or clipping <strong>4–6 weeks before your average killing frost</strong> so plants can build reserves for winter.' : '',
      'Late-summer seedings should <strong>not</strong> be cut or grazed that fall — it weakens the plants and invites winterkill.'
    ].filter(Boolean)
  });

  // 11 — year two
  steps.push({
    title: 'Year two — go light ("sleep, creep, leap")',
    body: 'Perennials follow the old rule: they <strong>sleep</strong> the first year while they put down roots, <strong>creep</strong> the second as crowns and rhizomes fill in, and <strong>leap</strong> the third at full production. Graze year two lightly and briefly, with long rests and a high residual — the stand is still investing below ground. Pushing it hard in year two is the most common way a good establishment gets undone right before it would have paid off.' +
      (nativeWarm.length ? ' Native warm-season grasses are the slowest of all — expect almost nothing in year one and only light use in year two.' : '')
  });

  // 12 — grazing that keeps the mix, with rest periods
  const restBody = ' <strong>Rest is measured by regrowth, not the calendar:</strong> bring animals back only once cool-season pasture has regrown to <strong>8–10 inches</strong>' +
    (warmSp.length ? ' (native warm-season stands to <strong>18–20 inches</strong>)' : '') +
    '. In practice that is roughly <strong>21–30 days</strong> of rest during spring growth and <strong>35–45+ days</strong> in midsummer heat or drought, when regrowth slows right down. Stop grazing at a <strong>3–4 inch residual</strong>' +
    (warmSp.length ? ' (leave 8 inches on native warm-season)' : '') +
    ' — that leftover leaf area is the engine for regrowth and is what keeps legumes and forbs in the stand.';
  steps.push({ title: 'Grazing to keep the mix diverse', body: (GRAZE_ADVICE[ctx.grazing] || GRAZE_ADVICE['rot-managed']) + restBody });

  return steps;
}

window.APP_RECOMMENDER = {
  recommend: recommend,
  recommendPasture: recommendPasture,
  buildSeedPlan: buildSeedPlan,
  buildEstablishmentPlan: buildEstablishmentPlan,
  scoreSpecies: scoreSpecies,
  buildContext: buildContext
};
