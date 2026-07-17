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

function scoreGoalsAndChallenges(sp, ctx, reasons) {
  let pts = 0;
  ctx.goals.forEach(function (g) {
    if (sp.goalsServed.indexOf(g) !== -1) { pts += 2; if (GOAL_REASON[g]) reasons.push(GOAL_REASON[g]); }
  });
  ctx.challenges.forEach(function (c) {
    if (sp.challengesFit.indexOf(c) !== -1) { pts += 2; if (CHALLENGE_REASON[c]) reasons.push(CHALLENGE_REASON[c]); }
  });
  return pts;
}

function scoreConditions(sp, ctx, reasons) {
  let pts = 0;
  const has = function (arr, v) { return arr.indexOf(v) !== -1; };

  const droughtConcern = has(ctx.challenges, 'droughty') || has(ctx.goals, 'drought') || has(ctx.goals, 'summer-forage');
  if (droughtConcern) pts += (sp.droughtTolerance - 3) * 1.2;

  // Aspect: south/southwest-facing ground is warmer and drier, north/northeast
  // cooler and moister. The effect scales with slope steepness (negligible on
  // flat ground, strong on a steep hillside). aspectDryness runs -1 (cool/moist)
  // to +1 (hot/dry). Positive rewards drought-tolerant species; negative rewards
  // moisture-loving ones (because (droughtTolerance-3) flips sign for them).
  if (ctx.aspectDryness) {
    pts += ctx.aspectDryness * (sp.droughtTolerance - 3) * 1.4;
    if (ctx.aspectDryness > 0.35 && sp.droughtTolerance >= 4) reasons.push('Good fit for your warm, dry south/west-facing slope');
    else if (ctx.aspectDryness < -0.35 && sp.droughtTolerance <= 2) reasons.push('Suited to your cool, moist north-facing slope');
  }

  // Recent drought (current conditions vs. normal), 0 (none) to 1 (severe).
  if (ctx.recentDroughtStress > 0.15) {
    pts += ctx.recentDroughtStress * (sp.droughtTolerance - 3) * 1.1;
    if (ctx.recentDroughtStress > 0.4 && sp.droughtTolerance >= 4) reasons.push('Extra resilient for the recent dry spell in your area');
  }

  if (has(ctx.challenges, 'wet')) pts += (sp.floodTolerance - 3) * 1.0;

  if (has(ctx.challenges, 'low-fertility')) {
    pts += sp.fertilityNeed === 'low' ? 2 : (sp.fertilityNeed === 'high' ? -2 : 0);
    if (sp.nitrogenFixer) pts += 1.5;
  }

  // Grazing system
  if (ctx.grazing === 'continuous') pts += (sp.grazingTolerance - 3) * 0.9;
  else pts += (sp.grazingTolerance - 3) * 0.25;

  // Establishment method
  if (ctx.method === 'broadcast') pts += (sp.establishmentEase - 3) * 1.1;
  else if (ctx.method === 'no-till') pts += (sp.establishmentEase - 3) * 0.4;
  else pts += (sp.establishmentEase - 3) * 0.25;

  // Elevation / winter cold
  if (ctx.cold) pts += (sp.winterHardiness - 3) * 0.9;

  // Nitrogen goal extra nudge for fixers (beyond goalsServed tag)
  if (has(ctx.goals, 'nitrogen') && sp.nitrogenFixer) pts += 1;

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

  score += scoreGoalsAndChallenges(sp, ctx, reasons);
  score += scoreConditions(sp, ctx, reasons);

  if (sp.nitrogenFixer && ctx.goals.indexOf('nitrogen') === -1 && reasons.indexOf('Fixes nitrogen, cutting fertilizer need') === -1) {
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

// Target functional-group composition, as a fraction of total PLS lbs/acre.
// Midpoints of 45-55% grass, 30-40% legume, 10-20% forb.
var COMPOSITION_TARGET = { grass: 0.50, legume: 0.35, forb: 0.15 };

// Given the chosen mix, a seed-prep dataset, and a total PLS seeding rate,
// allocate PLS lbs to each species to hit the group composition, then compute
// PLS%, bulk lbs, and estimated cost. All the numbers behind the mix table.
function buildSeedPlan(mix, prepData, totalPls) {
  totalPls = totalPls || 12;
  const prep = (prepData && prepData.species) || {};
  const groups = { grass: [], legume: [], forb: [] };
  mix.forEach(function (m) { if (groups[m.species.type]) groups[m.species.type].push(m); });

  const present = Object.keys(groups).filter(function (g) { return groups[g].length; });
  const tsum = present.reduce(function (a, g) { return a + COMPOSITION_TARGET[g]; }, 0) || 1;

  const rows = [];
  const groupPls = {};
  present.forEach(function (g) {
    const gTarget = totalPls * (COMPOSITION_TARGET[g] / tsum);
    groupPls[g] = gTarget;
    const members = groups[g];
    const mids = members.map(function (m) { return (m.species.seedingRateMixLow + m.species.seedingRateMixHigh) / 2; });
    const midSum = mids.reduce(function (a, b) { return a + b; }, 0) || members.length;
    members.forEach(function (m, i) {
      const pls = gTarget * (mids[i] / midSum);
      const p = prep[m.species.id];
      const plsFrac = p && p.purity && p.germ ? (p.purity * p.germ / 10000) : 0.85;
      const price = (p && p.pricePerPlsLb) || [6, 12];
      rows.push({
        species: m.species, group: g, prep: p || null,
        plsRate: pls, plsPct: plsFrac * 100, bulkRate: pls / plsFrac,
        costLow: pls * price[0], costHigh: pls * price[1]
      });
    });
  });

  const order = { grass: 0, legume: 1, forb: 2 };
  rows.sort(function (a, b) { return order[a.group] - order[b.group] || b.plsRate - a.plsRate; });

  const totals = { pls: 0, bulk: 0, costLow: 0, costHigh: 0 };
  rows.forEach(function (r) { totals.pls += r.plsRate; totals.bulk += r.bulkRate; totals.costLow += r.costLow; totals.costHigh += r.costHigh; });
  const composition = {};
  present.forEach(function (g) { composition[g] = Math.round(groupPls[g] / totalPls * 100); });

  return { rows: rows, totals: totals, composition: composition, totalPls: totalPls };
}

/* ---- management resources + sources ------------------------------------ */

function gatherResources(ctx, resourcesData) {
  const active = {};
  const triggers = ctx.goals.concat(ctx.challenges);
  triggers.push(ctx.method, 'always');
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

  return {
    phValue: PH_BAND_VALUE[answers.ph],
    canLime: !!answers.canLime,
    drainage: answers.drainage,
    goals: answers.goals || [],
    challenges: answers.challenges || [],
    method: answers.method || 'no-till',
    grazing: answers.grazing || 'rotational',
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
  return { ctx: ctx, mix: composed.mix, alternates: composed.alternates, resources: resources, sources: sources, usedLocal: usedLocal };
}

/* ---- pasture-wide (multi-soil) recommendation -------------------------- */

function uniq(arr) { const seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }

// Build a full answers object for one "zone" (a soil condition set), keeping the
// farmer's stated goals/method/grazing/aspect but swapping in the zone's pH,
// drainage, and extra challenges.
function zoneAnswers(farmer, phBand, drainage, extraChallenges) {
  return {
    elevation: farmer.elevation,
    ph: phBand || 'unknown',
    canLime: farmer.canLime,
    drainage: drainage || farmer.drainage,
    goals: farmer.goals || [],
    challenges: uniq((farmer.challenges || []).concat(extraChallenges || [])),
    method: farmer.method,
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

window.APP_RECOMMENDER = {
  recommend: recommend,
  recommendPasture: recommendPasture,
  buildSeedPlan: buildSeedPlan,
  scoreSpecies: scoreSpecies,
  buildContext: buildContext
};
