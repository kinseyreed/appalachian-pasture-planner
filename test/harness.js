// Node test harness: loads the real recommender.js + data files and runs
// realistic scenarios. Mirrors app.js's data loading. Run: node test/harness.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

// --- load recommender.js with a window shim ---
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/recommender.js'), 'utf8'), sandbox);
const REC = sandbox.window.APP_RECOMMENDER;

// Shim: translate the harness's legacy {goals,challenges,method,grazing} answers
// into the current {priorities,methods,grazing,season} model.
function normalize(a) {
  if (!a || a.priorities) return a;
  const pri = {};
  (a.goals || []).forEach((g) => { pri[g] = 5; });
  (a.challenges || []).forEach((c) => { pri[c] = 5; });
  const mMap = { 'no-till': 'drill-fall', 'broadcast': 'frost-seed', 'tillage': 'tillage' };
  const gMap = { 'rotational': 'rot-managed', 'continuous': 'continuous-heavy' };
  return Object.assign({}, a, {
    priorities: pri,
    methods: a.method ? [mMap[a.method] || a.method] : ['drill-fall'],
    grazing: gMap[a.grazing] || a.grazing || 'rot-managed',
    season: a.season || 'both'
  });
}
const _recommend = REC.recommend;
REC.recommend = function (a, d) { return _recommend(normalize(a), d); };

// --- replicate app.js applyLocal ---
function applyLocal(speciesFile, local) {
  const list = speciesFile.species.slice();
  if (!local) return list;
  (local.traitOverrides || []).forEach((o) => {
    if (o.enabled === false || !o.overrides) return;
    const sp = list.find((s) => s.id === o.speciesId);
    if (sp) Object.assign(sp, o.overrides);
  });
  (local.newSpecies || []).forEach((s) => { if (s && s.enabled !== false && s.id) list.push(s); });
  return list;
}

const speciesFile = readJson('data/species.json');
const local = readJson('data/local-observations.json');
const data = {
  species: applyLocal(speciesFile, local),
  sources: readJson('data/sources.json'),
  resources: readJson('data/extension-resources.json'),
  local
};

const scenarios = [
  { name: 'Acidic, low-fertility hillside; wants N + summer forage; frost seed; continuous',
    a: { elevation: 'low', ph: 'lt55', canLime: false, drainage: 'moderate',
         goals: ['nitrogen', 'summer-forage', 'low-input'], challenges: ['acidic', 'low-fertility', 'slopes'],
         method: 'broadcast', grazing: 'continuous' } },
  { name: 'Wet bottom ground; extend grazing + soil health; no-till; rotational',
    a: { elevation: 'low', ph: '55-60', canLime: true, drainage: 'wet',
         goals: ['extend-grazing', 'soil-health'], challenges: ['wet'],
         method: 'no-till', grazing: 'rotational' } },
  { name: 'Well-drained upland, near-neutral; hay + drought; tillage; rotational',
    a: { elevation: 'low', ph: 'gt65', canLime: true, drainage: 'well',
         goals: ['hay', 'drought', 'nitrogen'], challenges: ['droughty'],
         method: 'tillage', grazing: 'rotational' } },
  { name: 'High-elevation cold; toxic KY-31 fescue; reduce toxicity; no-till; rotational',
    a: { elevation: 'high', ph: '60-65', canLime: true, drainage: 'moderate',
         goals: ['reduce-fescue-tox', 'extend-grazing', 'pollinators'], challenges: ['toxic-fescue'],
         method: 'no-till', grazing: 'rotational' } },
  { name: 'Unknown pH, default answers (minimal input)',
    a: { elevation: 'low', ph: 'unknown', canLime: false, drainage: 'moderate',
         goals: [], challenges: [], method: 'no-till', grazing: 'rotational' } }
];

let problems = 0;
for (const s of scenarios) {
  const r = REC.recommend(s.a, data);
  console.log('\n=== ' + s.name + ' ===');
  if (!r.mix.length) { console.log('  !! empty mix'); problems++; continue; }
  r.mix.forEach((m) => {
    const rate = Math.round((m.species.seedingRateMixLow + m.species.seedingRateMixHigh) / 2 * 10) / 10;
    console.log('  • ' + m.species.commonName.padEnd(40) + rate + ' lb/ac  (score ' + m.score.toFixed(1) + ')'
      + (m.separatePaddock ? ' [own paddock]' : '') + (m.limeNote ? ' [needs lime]' : ''));
    console.log('      why: ' + m.reasons.slice(0, 3).join('; '));
  });
  const types = new Set(r.mix.map((m) => m.species.type));
  console.log('  types: ' + [...types].join(', ') + ' | resources: ' + r.resources.length + ' | sources: ' + r.sources.length + ' | usedLocal: ' + r.usedLocal);
  // sanity checks
  if (!types.has('grass')) { console.log('  !! no grass in mix'); problems++; }
  if (!types.has('legume')) { console.log('  !! no legume in mix'); problems++; }
  if (r.sources.length === 0) { console.log('  !! no sources'); problems++; }
}

// --- targeted correctness checks ---
console.log('\n=== correctness checks ===');
function check(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) problems++; }

// Alfalfa must NOT appear on wet ground (drainage=['well'] only)
const wet = REC.recommend({ elevation: 'low', ph: 'gt65', canLime: true, drainage: 'wet', goals: ['hay'], challenges: ['wet'], method: 'no-till', grazing: 'rotational' }, data);
check('alfalfa excluded on wet ground', !wet.mix.some((m) => m.species.id === 'alfalfa'));

// Strongly acidic + cannot lime should exclude alfalfa (phTolerantLow 6.2)
const acid = REC.recommend({ elevation: 'low', ph: 'lt55', canLime: false, drainage: 'well', goals: ['hay'], challenges: ['acidic'], method: 'no-till', grazing: 'rotational' }, data);
check('alfalfa excluded when strongly acidic & cannot lime', !acid.mix.some((m) => m.species.id === 'alfalfa'));

// Cold-climate warm-season grass should be winter-hardy (not bermuda/crabgrass).
const cold = REC.recommend({ elevation: 'high', ph: '60-65', canLime: true, drainage: 'well', goals: ['summer-forage', 'drought'], challenges: ['droughty'], method: 'no-till', grazing: 'rotational', season: 'warm' }, data);
const warmPick = cold.mix.find((m) => m.species.type === 'grass' && m.species.season === 'warm');
check('cold-climate warm grass is winter-hardy (not bermuda/crabgrass)', !warmPick || warmPick.species.winterHardiness >= 4);

// Grazing pressure: continuous-heavy should favor grazing-tolerant species overall.
const gp = REC.recommend({ elevation: 'low', ph: '60-65', canLime: true, drainage: 'well', priorities: {}, methods: ['drill-fall'], grazing: 'continuous-heavy', season: 'cool' }, data);
check('mix produced under heavy continuous grazing', gp.mix.length > 0);

// Groundcover composition targets ~50/35/15 among present groups.
const prep = readJson('data/seed-prep.json');
const planChk = REC.buildSeedPlan(gp.mix, prep, 12);
check('groundcover composition sums to ~100%', Math.abs((planChk.composition.grass + planChk.composition.legume + planChk.composition.forb) - 100) <= 2);

// Local data merge: enable example observation and confirm badge/flag
const local2 = JSON.parse(JSON.stringify(local));
local2.observations[0].enabled = true;
const data2 = Object.assign({}, data, { local: local2, species: applyLocal(speciesFile, local2) });
const withLocal = REC.recommend({ elevation: 'low', ph: '60-65', canLime: true, drainage: 'well', goals: ['hay'], challenges: [], method: 'no-till', grazing: 'rotational' }, data2);
const orch = withLocal.mix.find((m) => m.species.id === 'orchardgrass');
check('local observation attaches to orchardgrass', !!(orch && orch.local));
check('usedLocal flips true when local data informs mix', withLocal.usedLocal === true);
check('local citation appears in sources', withLocal.sources.some((s) => s.isLocal));

console.log('\n' + (problems === 0 ? '✅ ALL GOOD' : '❌ ' + problems + ' problem(s)'));
process.exit(problems === 0 ? 0 : 1);
