/*
 * Appalachian Pasture Planner — UI controller
 * Loads the data files, renders the questionnaire, and displays the mix.
 */

/* ---- option definitions (also drive the rendered form) ----------------- */

const GOALS = [
  { id: 'extend-grazing', label: 'Extend the grazing season', icon: '🌱' },
  { id: 'summer-forage', label: 'Beat the summer slump', icon: '☀️' },
  { id: 'drought', label: 'Drought resilience', icon: '🌾' },
  { id: 'soil-health', label: 'Improve soil health', icon: '🪱' },
  { id: 'nitrogen', label: 'Fix nitrogen / cut fertilizer', icon: '⚡' },
  { id: 'reduce-fescue-tox', label: 'Reduce toxic-fescue problems', icon: '🐄' },
  { id: 'pollinators', label: 'Pollinators & wildlife', icon: '🐝' },
  { id: 'erosion', label: 'Erosion control', icon: '⛰️' },
  { id: 'hay', label: 'Hay / stored feed', icon: '🌿' },
  { id: 'quick-establish', label: 'Get a stand fast', icon: '⏱️' }
];

const CHALLENGES = [
  { id: 'acidic', label: 'Acidic / sour soil', icon: '🧪' },
  { id: 'low-fertility', label: 'Low fertility', icon: '📉' },
  { id: 'droughty', label: 'Droughty / shallow soils', icon: '🏜️' },
  { id: 'wet', label: 'Wet spots / poor drainage', icon: '💧' },
  { id: 'slopes', label: 'Steep slopes', icon: '🗻' },
  { id: 'toxic-fescue', label: 'Existing toxic (KY-31) fescue', icon: '⚠️' },
  { id: 'weeds', label: 'Weed pressure', icon: '🌼' }
];

const PH_OPTIONS = [
  { id: 'unknown', label: "Haven't tested / not sure", hint: 'We\'ll skip pH scoring' },
  { id: 'lt55', label: 'Below 5.5 (strongly acidic)', hint: '' },
  { id: '55-60', label: '5.5 – 6.0 (acidic)', hint: '' },
  { id: '60-65', label: '6.0 – 6.5 (slightly acidic)', hint: 'Ideal for most mixes' },
  { id: 'gt65', label: 'Above 6.5 (near neutral)', hint: '' }
];

const DRAINAGE_OPTIONS = [
  { id: 'well', label: 'Well drained', hint: 'Dries quickly, ridge/upland' },
  { id: 'moderate', label: 'Moderately drained', hint: 'Typical pasture ground' },
  { id: 'wet', label: 'Poorly drained / wet', hint: 'Stays wet, low spots' }
];

const METHOD_OPTIONS = [
  { id: 'no-till', label: 'No-till drill', hint: 'Best establishment' },
  { id: 'broadcast', label: 'Broadcast / frost seed', hint: 'Cheapest, favors small seed' },
  { id: 'tillage', label: 'Conventional tillage', hint: 'Full seedbed prep' }
];

const GRAZING_OPTIONS = [
  { id: 'rotational', label: 'Rotational / managed', hint: 'Move animals, rest paddocks' },
  { id: 'continuous', label: 'Continuous', hint: 'Set-stocked' }
];

const ELEVATION_OPTIONS = [
  { id: 'low', label: 'Lower / milder valleys', hint: '' },
  { id: 'high', label: 'Higher / colder mountains', hint: 'Above ~2,500 ft' }
];

const SEASON_OPTIONS = [
  { id: 'cool', label: '❄️ Cool-season (spring & fall)', hint: 'Strong spring/fall growth; slumps in summer heat' },
  { id: 'warm', label: '☀️ Warm-season (summer pasture)', hint: 'Beats the summer slump; dormant in cool months' },
  { id: 'both', label: '🔄 Year-round mix', hint: 'Moderate growth all season — no big flushes' }
];

const TYPE_LABEL = {
  grass: 'Grass', legume: 'Legume', forb: 'Forb'
};

/* ---- data loading + local merge ---------------------------------------- */

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ')');
  return res.json();
}

function applyLocal(speciesFile, local) {
  const list = speciesFile.species.slice();
  if (!local) return list;

  (local.traitOverrides || []).forEach(function (o) {
    if (o.enabled === false || !o.overrides) return;
    const sp = list.find(function (s) { return s.id === o.speciesId; });
    if (sp) Object.assign(sp, o.overrides);
  });

  (local.newSpecies || []).forEach(function (s) {
    if (s && s.enabled !== false && s.id) list.push(s);
  });

  return list;
}

async function loadData() {
  const [speciesFile, sources, resources, prep, vendors] = await Promise.all([
    fetchJson('data/species.json'),
    fetchJson('data/sources.json'),
    fetchJson('data/extension-resources.json'),
    fetchJson('data/seed-prep.json'),
    fetchJson('data/seed-vendors.json')
  ]);
  let local = null;
  try { local = await fetchJson('data/local-observations.json'); } catch (e) { local = null; }
  return {
    species: applyLocal(speciesFile, local),
    sources: sources,
    resources: resources,
    prep: prep,
    vendors: vendors,
    local: local
  };
}

/* ---- form rendering ---------------------------------------------------- */

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function renderChips(container, options, name, multi) {
  options.forEach(function (opt) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.dataset.value = opt.id;
    chip.dataset.group = name;
    chip.dataset.multi = multi ? '1' : '0';
    chip.innerHTML = (opt.icon ? '<span class="chip-icon">' + opt.icon + '</span>' : '') +
      '<span class="chip-label">' + opt.label + '</span>' +
      (opt.hint ? '<span class="chip-hint">' + opt.hint + '</span>' : '');
    chip.addEventListener('click', function () {
      if (multi) {
        chip.classList.toggle('selected');
      } else {
        container.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
      }
    });
    container.appendChild(chip);
  });
}

function buildForm() {
  renderChips(document.getElementById('q-season'), SEASON_OPTIONS, 'season', false);
  renderChips(document.getElementById('q-elevation'), ELEVATION_OPTIONS, 'elevation', false);
  renderChips(document.getElementById('q-ph'), PH_OPTIONS, 'ph', false);
  renderChips(document.getElementById('q-drainage'), DRAINAGE_OPTIONS, 'drainage', false);
  renderChips(document.getElementById('q-goals'), GOALS, 'goals', true);
  renderChips(document.getElementById('q-challenges'), CHALLENGES, 'challenges', true);
  renderChips(document.getElementById('q-method'), METHOD_OPTIONS, 'method', false);
  renderChips(document.getElementById('q-grazing'), GRAZING_OPTIONS, 'grazing', false);

  // sensible defaults
  selectDefault('season', 'both');
  selectDefault('elevation', 'low');
  selectDefault('drainage', 'moderate');
  selectDefault('ph', 'unknown');
  selectDefault('method', 'no-till');
  selectDefault('grazing', 'rotational');
}

function selectDefault(group, value) {
  const chip = document.querySelector('.chip[data-group="' + group + '"][data-value="' + value + '"]');
  if (chip) chip.classList.add('selected');
}

function readSingle(group) {
  const chip = document.querySelector('.chip[data-group="' + group + '"].selected');
  return chip ? chip.dataset.value : null;
}

function readMulti(group) {
  return Array.prototype.map.call(
    document.querySelectorAll('.chip[data-group="' + group + '"].selected'),
    function (c) { return c.dataset.value; }
  );
}

// Map-derived continuous modifiers (aspect, recent drought) captured by the
// location lookup; empty when the farmer fills the form by hand.
let AUTOFILL = {};

function readAnswers() {
  return {
    elevation: readSingle('elevation'),
    ph: readSingle('ph'),
    canLime: document.getElementById('can-lime').checked,
    drainage: readSingle('drainage'),
    goals: readMulti('goals'),
    challenges: readMulti('challenges'),
    method: readSingle('method'),
    grazing: readSingle('grazing'),
    season: readSingle('season') || 'both',
    autofill: AUTOFILL
  };
}

/* ---- results rendering ------------------------------------------------- */

function suggestedRate(sp) {
  const mid = Math.round((sp.seedingRateMixLow + sp.seedingRateMixHigh) / 2 * 10) / 10;
  return mid;
}

function speciesCard(result, sourcesData) {
  const sp = result.species;
  const card = el('div', 'species-card' + (result.local ? ' has-local' : ''));

  const tag = el('span', 'type-tag type-' + sp.type,
    (sp.season === 'warm' ? 'Warm-season ' : (sp.season === 'cool' ? 'Cool-season ' : '')) + TYPE_LABEL[sp.type]);
  if (sp.nitrogenFixer) {
    const nfix = el('span', 'type-tag type-nfix', 'N-fixer');
    tag.appendChild(nfix);
  }

  const head = el('div', 'sc-head');
  head.appendChild(el('h3', 'sc-name', sp.commonName + ' <span class="sci">' + sp.scientificName + '</span>'));
  head.appendChild(tag);
  card.appendChild(head);

  card.appendChild(el('p', 'sc-summary', sp.summary));

  const rate = el('div', 'sc-rate');
  const rateLabel = result.separatePaddock ? 'Seed (own paddock)' : 'Seeding rate in mix';
  rate.innerHTML = '<span class="rate-num">' + suggestedRate(sp) + ' lb/ac</span>' +
    '<span class="rate-range">' + sp.seedingRateMixLow + '–' + sp.seedingRateMixHigh + ' lb/ac · ' + rateLabel + '</span>';
  card.appendChild(rate);

  if (result.reasons && result.reasons.length) {
    const ul = el('ul', 'sc-reasons');
    result.reasons.forEach(function (r) {
      const cls = r.indexOf('WV trial') === 0 ? 'reason local' : 'reason';
      ul.appendChild(el('li', cls, r));
    });
    card.appendChild(ul);
  }

  if (result.limeNote) {
    card.appendChild(el('div', 'sc-note lime', '🪨 Lime this ground up to ~pH 6.5 before seeding.'));
  }
  if (result.separatePaddock) {
    card.appendChild(el('div', 'sc-note paddock', '🚧 Establish and graze this in its own paddock, separate from cool-season pasture.'));
  }
  if (sp.cautions) {
    card.appendChild(el('div', 'sc-caution', '⚠️ ' + sp.cautions));
  }

  // per-species sources
  if (sp.sources && sp.sources.length) {
    const srcWrap = el('div', 'sc-sources', 'Sources: ');
    sp.sources.forEach(function (id, i) {
      const s = sourcesData.sources[id];
      if (!s) return;
      const a = el('a', null, s.org || s.title);
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
      a.title = s.title;
      srcWrap.appendChild(a);
      if (i < sp.sources.length - 1) srcWrap.appendChild(document.createTextNode(', '));
    });
    card.appendChild(srcWrap);
  }

  return card;
}

function money(a, b) { return '$' + Math.round(a) + '–' + Math.round(b); }

// The live seed-mix table: composition targeting, PLS math, suggested varieties,
// reputable sources, and estimated cost. Recomputes when the total rate changes.
function buildSeedTableSection(mix, data) {
  const section = el('section', 'seed-table-section');
  section.appendChild(el('h3', 'section-h', 'Seed mix table — what to buy & how to plant it'));

  const ctrl = el('div', 'seed-ctrl no-print');
  ctrl.innerHTML = 'Total seeding rate: <input type="number" id="total-pls" value="12" min="4" max="30" step="1"> lb PLS/acre ' +
    '<span class="ctrl-hint">(drilled; add ~50% if broadcasting)</span>';
  section.appendChild(ctrl);

  const comp = el('div', 'comp-summary');
  section.appendChild(comp);

  const scroll = el('div', 'table-scroll');
  const table = el('table', 'seed-table');
  scroll.appendChild(table);
  section.appendChild(scroll);

  const boxes = el('div', 'box-summary');
  section.appendChild(boxes);

  section.appendChild(el('p', 'seed-note',
    '💲 Costs and varieties are planning estimates (dollars per pound of pure live seed) — confirm current quotes and regional ' +
    'ecotypes with the sources listed. <strong>PLS</strong> = Pure Live Seed (purity × germination); <strong>Bulk lb</strong> is what you weigh out and buy. ' +
    'Inoculate all legumes with the correct rhizobium before planting.'));

  const V = (data.vendors && data.vendors.vendors) || {};

  function update() {
    const inp = document.getElementById('total-pls');
    const total = inp ? (parseFloat(inp.value) || 12) : 12;
    const plan = window.APP_RECOMMENDER.buildSeedPlan(mix, data.prep, total);
    const c = plan.composition;
    comp.innerHTML = 'Actual composition (by PLS weight): ' +
      '<span class="comp-chip grass">Grasses ' + (c.grass || 0) + '%</span>' +
      '<span class="comp-chip legume">Legumes ' + (c.legume || 0) + '%</span>' +
      '<span class="comp-chip forb">Forbs ' + (c.forb || 0) + '%</span>';

    let html = '<thead><tr><th>Species</th><th>Suggested variety</th><th>Seed box</th><th>Depth</th><th>When to plant</th>' +
      '<th class="num">PLS<br>lb/ac</th><th class="num">Bulk<br>lb/ac</th><th class="num">Est.<br>$/ac</th><th>Sources</th></tr></thead><tbody>';
    plan.rows.forEach(function (r) {
      const p = r.prep || {};
      const v = (p.varieties && p.varieties[0]) || { name: '—', note: '' };
      const srcs = (p.sources || []).map(function (id) {
        const x = V[id]; if (!x) return '';
        return '<a href="' + x.url + '" target="_blank" rel="noopener" title="' + x.name + ' — ' + (x.region || '') + '">' + x.name.split(' ')[0] + '</a>';
      }).filter(Boolean).join(', ');
      html += '<tr class="grp-' + r.group + '">' +
        '<td><strong>' + r.species.commonName + '</strong><br><span class="tsci">' + r.species.scientificName + '</span></td>' +
        '<td title="' + (v.note || '') + '">' + v.name + '</td>' +
        '<td>' + (p.seedBox || '—') + '</td>' +
        '<td>' + (p.depth || '—') + '</td>' +
        '<td>' + (p.seasonWindow || '—') + '</td>' +
        '<td class="num">' + r.plsRate.toFixed(1) + '</td>' +
        '<td class="num">' + r.bulkRate.toFixed(1) + '</td>' +
        '<td class="num">' + money(r.costLow, r.costHigh) + '</td>' +
        '<td class="src">' + srcs + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td colspan="5">TOTAL per acre</td>' +
      '<td class="num">' + plan.totals.pls.toFixed(1) + '</td>' +
      '<td class="num">' + plan.totals.bulk.toFixed(1) + '</td>' +
      '<td class="num">' + money(plan.totals.costLow, plan.totals.costHigh) + '</td><td></td></tr></tfoot>';
    table.innerHTML = html;

    // Drill-box / mixing summary — groups species by which box they go in.
    const byBox = {};
    plan.rows.forEach(function (r) { const b = (r.prep && r.prep.seedBox) || 'Other'; (byBox[b] = byBox[b] || []).push(r); });
    let bh = '<h4>📦 Filling your drill boxes</h4><div class="box-list">';
    Object.keys(byBox).forEach(function (b) {
      const rows = byBox[b];
      const tot = rows.reduce(function (a, r) { return a + r.bulkRate; }, 0);
      bh += '<div class="box-item"><div class="box-name">' + b + ' — ' + tot.toFixed(1) + ' bulk lb/ac</div>' +
        '<div class="box-species">' + rows.map(function (r) { return r.species.commonName + ' (' + r.bulkRate.toFixed(1) + ')'; }).join(', ') + '</div></div>';
    });
    bh += '</div>';
    boxes.innerHTML = bh;
  }

  // Attach the live listener once the section is in the DOM.
  setTimeout(function () {
    const inp = document.getElementById('total-pls');
    if (inp) inp.addEventListener('input', update);
    update();
  }, 0);

  return section;
}

function renderResults(rec, data) {
  const out = document.getElementById('results');
  out.innerHTML = '';

  if (!rec.mix.length) {
    out.appendChild(el('div', 'empty-state',
      '<h2>No confident match yet</h2><p>Your soil constraints ruled out the species in our database. ' +
      'Try marking that you can lime, relaxing the drainage setting, or checking a soil test. ' +
      'A local NRCS or extension agent can help with tough sites.</p>'));
    out.classList.add('visible');
    out.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // Header
  const header = el('div', 'results-header');
  header.appendChild(el('h2', null, 'Your suggested pasture mix'));
  header.appendChild(el('p', 'results-sub',
    'A diverse blend chosen for your conditions and goals. Rates assume these species are seeded together — tune them for your drill and site.'));
  out.appendChild(header);

  if (rec.usedLocal) {
    out.appendChild(el('div', 'local-banner',
      '📍 <strong>Informed by West Virginia trial data.</strong> Species marked with a trial badge were adjusted using local establishment results.'));
  }

  // Mix grid
  const grid = el('div', 'species-grid');
  const mainMix = rec.mix.filter(function (r) { return !r.separatePaddock; });
  const paddock = rec.mix.filter(function (r) { return r.separatePaddock; });

  mainMix.forEach(function (r) { grid.appendChild(speciesCard(r, data.sources)); });
  out.appendChild(grid);

  // Seed mix table (composition targeting + PLS + varieties + sources + cost)
  if (data.prep && window.APP_RECOMMENDER.buildSeedPlan) {
    out.appendChild(buildSeedTableSection(mainMix, data));
  }

  if (paddock.length) {
    out.appendChild(el('h3', 'section-h', 'For a separate summer / warm-season paddock'));
    const pgrid = el('div', 'species-grid');
    paddock.forEach(function (r) { pgrid.appendChild(speciesCard(r, data.sources)); });
    out.appendChild(pgrid);
  }

  // Management recommendations
  if (rec.resources.length) {
    out.appendChild(el('h3', 'section-h', 'Management & establishment guidance'));
    const mgmt = el('div', 'mgmt-list');
    rec.resources.forEach(function (r) {
      const item = el('details', 'mgmt-item');
      const sum = el('summary', null, r.title);
      item.appendChild(sum);
      const body = el('div', 'mgmt-body');
      body.appendChild(el('p', null, r.body));
      if (r.sources && r.sources.length) {
        const sw = el('div', 'mgmt-sources', 'More: ');
        r.sources.forEach(function (id, i) {
          const s = data.sources.sources[id];
          if (!s) return;
          const a = el('a', null, s.title);
          a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
          sw.appendChild(a);
          if (i < r.sources.length - 1) sw.appendChild(document.createTextNode(' · '));
        });
        body.appendChild(sw);
      }
      item.appendChild(body);
      mgmt.appendChild(item);
    });
    out.appendChild(mgmt);
  }

  // Sources / bibliography
  if (rec.sources.length) {
    out.appendChild(el('h3', 'section-h', 'Sources'));
    const bib = el('ul', 'bibliography');
    rec.sources.forEach(function (s) {
      const li = el('li', s.isLocal ? 'bib-local' : null);
      const a = el('a', null, s.title);
      a.href = s.url || '#'; a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a);
      li.appendChild(document.createTextNode(' — ' + (s.org || '') + (s.note ? '. ' + s.note : '')));
      if (s.isLocal) li.appendChild(el('span', 'bib-badge', 'your data'));
      bib.appendChild(li);
    });
    out.appendChild(bib);
  }

  // Actions
  const actions = el('div', 'results-actions no-print');
  const printBtn = el('button', 'btn btn-secondary', '🖨️ Print / Save PDF');
  printBtn.addEventListener('click', function () { window.print(); });
  const againBtn = el('button', 'btn btn-secondary', '↺ Start over');
  againBtn.addEventListener('click', function () {
    out.classList.remove('visible');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  actions.appendChild(printBtn);
  actions.appendChild(againBtn);
  out.appendChild(actions);

  out.appendChild(el('p', 'disclaimer',
    'This planner offers research-based starting points, not a prescription. Confirm choices with a current soil test and your local NRCS or Extension office before buying seed.'));

  out.classList.add('visible');
  out.scrollIntoView({ behavior: 'smooth' });
}

/* ---- two-tier (pasture) results --------------------------------------- */

function pastureBanner(profile) {
  const names = (profile._soils || []).slice(0, 4).map(function (s) {
    return (s.component || s.muname) + ' (' + s.weightPct + '%)';
  }).join(', ');
  const b = el('div', 'pasture-banner');
  const nSoils = (profile._soils || []).length;
  b.innerHTML = '🗺️ <strong>Your pasture spans ' + nSoils + ' soil type' + (nSoils > 1 ? 's' : '') + '.</strong> ' +
    'The base mix below is tuned to the dominant, area-weighted conditions' +
    (profile.weightedPh != null ? ' (about pH ' + (Math.round(profile.weightedPh * 10) / 10) + ', ' +
      (profile.pluralityDrainage === 'wet' ? 'poorly drained' : profile.pluralityDrainage + '-drained') + ')' : '') +
    (names ? '. Soils present: ' + names + '.' : '.');
  return b;
}

function problemSection(problems, data) {
  const wrap = el('div', 'problem-wrap');
  wrap.appendChild(el('h3', 'section-h', 'Targeted picks for your problem spots'));
  wrap.appendChild(el('p', 'problem-intro',
    'Parts of your field differ enough from the rest that they\'re worth spot-seeding separately. ' +
    'Add these to the base mix only where the conditions call for them.'));
  const icons = { wet: '💧', acid: '🧪', dry: '🏜️' };
  problems.forEach(function (p) {
    const card = el('div', 'problem-area');
    card.appendChild(el('div', 'pa-head', (icons[p.area.key] || '📍') + ' <strong>' + p.area.label +
      '</strong> <span class="pa-pct">~' + p.area.weightPct + '% of the field</span>'));
    if (p.area.soils && p.area.soils.length) {
      card.appendChild(el('p', 'pa-soils', 'Soils: ' + p.area.soils.filter(Boolean).join(', ')));
    }
    const picks = el('div', 'pa-picks');
    p.picks.forEach(function (m) {
      const sp = m.species;
      const pick = el('div', 'pa-pick');
      pick.appendChild(el('span', 'pa-pick-name', sp.commonName));
      pick.appendChild(el('span', 'pa-pick-rate', suggestedRate(sp) + ' lb/ac'));
      if (m.reasons && m.reasons.length) pick.appendChild(el('span', 'pa-pick-why', m.reasons[0]));
      picks.appendChild(pick);
    });
    card.appendChild(picks);
    wrap.appendChild(card);
  });
  return wrap;
}

function renderPastureResults(prec, data) {
  // stash soils on the profile for the banner
  prec.profile._soils = (PASTURE && PASTURE.soils) ? PASTURE.soils : [];

  renderResults(prec.base, data);          // renders the whole base-mix view
  const out = document.getElementById('results');

  const header = out.querySelector('.results-header h2');
  if (header && prec.problems.length) header.textContent = 'Your whole-pasture base mix';

  out.insertBefore(pastureBanner(prec.profile), out.firstChild);

  if (prec.problems.length) {
    const actions = out.querySelector('.results-actions');
    out.insertBefore(problemSection(prec.problems, data), actions);
  }
  out.scrollIntoView({ behavior: 'smooth' });
}

/* ---- location lookup --------------------------------------------------- */

function selectValue(group, value, fromMap) {
  const chips = document.querySelectorAll('.chip[data-group="' + group + '"]');
  chips.forEach(function (c) { c.classList.remove('selected'); if (fromMap) c.classList.remove('from-map'); });
  const chip = document.querySelector('.chip[data-group="' + group + '"][data-value="' + value + '"]');
  if (chip) { chip.classList.add('selected'); if (fromMap) chip.classList.add('from-map'); }
}

function addChallenge(value, fromMap) {
  const chip = document.querySelector('.chip[data-group="challenges"][data-value="' + value + '"]');
  if (chip) { chip.classList.add('selected'); if (fromMap) chip.classList.add('from-map'); }
}

// When a pasture area is scanned, the whole soil profile is stored here and the
// Build step switches to the two-tier (base mix + problem areas) recommendation.
let PASTURE = null;

// Pre-fill the editable chips from the pasture's dominant / area-weighted
// conditions. Problem-area extremes (a wet 15%, an acidic knob) are NOT forced
// onto the chips — they're handled separately as targeted add-ins so they don't
// distort the whole-field base mix.
function applyPastureFindings(pasture, terrain, climate) {
  const prof = pasture ? pasture.profile : null;
  if (prof) {
    if (prof.weightedPhBand) selectValue('ph', prof.weightedPhBand, true);
    if (prof.pluralityDrainage) selectValue('drainage', prof.pluralityDrainage, true);
    if (prof.widespread.acidic) addChallenge('acidic', true);
    if (prof.widespread.steep) addChallenge('slopes', true);
  }
  const cold = (terrain && terrain.high) || (climate && climate.cold);
  if (terrain || climate) selectValue('elevation', cold ? 'high' : 'low', true);
  if (climate && climate.lowRainfall) addChallenge('droughty', true);

  AUTOFILL = {
    aspectDeg: terrain ? terrain.aspectDeg : null,
    slopePct: (prof && prof.dominant && prof.dominant.slope != null) ? prof.dominant.slope
      : (terrain && terrain.slopeDegDEM != null ? Math.round(Math.tan(terrain.slopeDegDEM * Math.PI / 180) * 100) : null),
    recentDroughtStress: climate ? climate.droughtStress : 0
  };
}

function setLookupStatus(html, kind) {
  const box = document.getElementById('lookup-status');
  if (!html) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.className = 'lookup-status ' + (kind || '');
  box.innerHTML = (kind === 'loading' ? '<span class="spinner"></span> ' : '') + html;
}

function summaryRow(label, value, source) {
  const row = el('div', 'sum-row');
  row.appendChild(el('span', 'sum-label', label));
  row.appendChild(el('span', 'sum-value', value));
  if (source) row.appendChild(el('span', 'sum-source', source));
  return row;
}

function soilItem(s) {
  const item = el('div', 'soil-item');
  const bar = el('div', 'soil-bar');
  const fill = el('span'); fill.style.width = Math.max(4, s.weightPct) + '%';
  bar.appendChild(fill);
  bar.appendChild(el('span', 'soil-pct', s.weightPct + '%'));
  item.appendChild(bar);
  const bits = [];
  if (s.ph != null) bits.push('pH ' + s.ph);
  if (s.drainageClass) bits.push(s.drainageClass.toLowerCase());
  if (s.slope != null) bits.push(s.slope + '% slope');
  item.appendChild(el('div', 'soil-info',
    '<strong>' + (s.component || 'Soil') + '</strong> — ' + s.muname + '<br><small>' + bits.join(' · ') + '</small>'));
  return item;
}

function renderPastureSummary(pasture, terrain, climate, place) {
  const box = document.getElementById('lookup-summary');
  box.hidden = false;
  box.innerHTML = '';
  box.appendChild(el('div', 'sum-head', '✓ Here\'s what we found for <strong>' +
    (place ? place.replace(/</g, '') : 'your pasture') + '</strong>'));

  if (pasture && pasture.soils && pasture.soils.length) {
    const p = pasture.profile;
    const n = pasture.soils.length;
    box.appendChild(el('p', 'soils-intro', n === 1
      ? 'Your pasture is mostly one soil type:'
      : 'Your pasture spans <strong>' + n + ' soil types</strong>' +
        (p.phRange ? ', with pH from ' + p.phRange.min + ' to ' + p.phRange.max : '') + ':'));
    const soilsWrap = el('div', 'soils-list');
    pasture.soils.forEach(function (s) { soilsWrap.appendChild(soilItem(s)); });
    box.appendChild(soilsWrap);
    if (p.problemAreas && p.problemAreas.length) {
      box.appendChild(el('p', 'soils-note', '📍 We spotted ' + p.problemAreas.length +
        ' distinct problem area' + (p.problemAreas.length > 1 ? 's' : '') +
        ' — your results include targeted species for ' +
        p.problemAreas.map(function (a) { return a.label.toLowerCase(); }).join(' and ') + '.'));
    }
  } else {
    box.appendChild(el('p', 'soils-intro', 'No SSURGO soil data was returned for this spot — fill the soil questions in by hand.'));
  }

  const grid = el('div', 'sum-grid');
  if (terrain) {
    if (terrain.elevationFt != null) grid.appendChild(summaryRow('Elevation', terrain.elevationFt.toLocaleString() + ' ft', 'USGS 3DEP'));
    if (terrain.aspect) grid.appendChild(summaryRow('Aspect', terrain.aspect + '-facing' +
      (terrain.aspect.indexOf('S') !== -1 ? ' (warmer, drier)' : (terrain.aspect.indexOf('N') !== -1 ? ' (cooler, moister)' : '')), 'USGS 3DEP'));
  }
  if (climate) {
    grid.appendChild(summaryRow('Hardiness zone', climate.hardinessZone + ' (avg. low ' + climate.avgExtremeMinF + '°F)', 'Open-Meteo'));
    grid.appendChild(summaryRow('Frost-free days', climate.frostFreeDays + ' days/yr', 'Open-Meteo'));
    grid.appendChild(summaryRow('Annual rainfall', climate.annualPrecipIn + ' in/yr', 'Open-Meteo'));
    if (climate.recentPrecipPctNormal != null) {
      const dry = climate.droughtStress > 0.15;
      const row = summaryRow('Recent rainfall', climate.recentPrecipPctNormal + '% of normal (last 90 days) — ' +
        climate.droughtLabel + (dry ? ' · leaning the mix toward drought resilience' : ''), 'Open-Meteo');
      if (dry) row.classList.add('sum-row-alert');
      grid.appendChild(row);
    }
  }
  box.appendChild(grid);
  box.appendChild(el('p', 'sum-note',
    '📝 These are <strong>map estimates</strong> for your field — we\'ve pre-filled the questions below from them. ' +
    'Review and change anything that doesn\'t match, and confirm pH with a real soil test before buying seed.'));
}

/* ---- interactive map (Leaflet) ----------------------------------------- */

let MAP = null, MARKER = null, PLACE = null;
const DRAW = { on: false, pts: [], layer: null };

function showMap(coords, label) {
  PLACE = label;
  document.getElementById('map-block').hidden = false;
  if (!MAP) {
    MAP = L.map('pasture-map');
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery &copy; Esri, USDA FSA, USGS' }).addTo(MAP);
    MAP.on('click', onMapClick);
  }
  MAP.setView([coords.lat, coords.lon], 16);
  if (MARKER) MARKER.setLatLng([coords.lat, coords.lon]);
  else MARKER = L.marker([coords.lat, coords.lon], { draggable: true }).addTo(MAP);
  setTimeout(function () { MAP.invalidateSize(); }, 120);
  setLookupStatus('📌 Positioned at <strong>' + (label ? label.replace(/</g, '') : 'your location') +
    '</strong>. Drag the pin onto your pasture, then scan.', '');
}

function onMapClick(e) {
  if (!DRAW.on) return;
  DRAW.pts.push([e.latlng.lng, e.latlng.lat]);
  if (DRAW.layer) MAP.removeLayer(DRAW.layer);
  DRAW.layer = L.polygon(DRAW.pts.map(function (p) { return [p[1], p[0]]; }),
    { color: '#c8853c', weight: 2, fillOpacity: 0.15 }).addTo(MAP);
}

function toggleDraw() {
  const drawBtn = document.getElementById('draw-btn');
  const clearBtn = document.getElementById('clear-draw-btn');
  if (!DRAW.on) {
    DRAW.on = true; DRAW.pts = [];
    if (DRAW.layer) { MAP.removeLayer(DRAW.layer); DRAW.layer = null; }
    if (MARKER) MARKER.setOpacity(0.35);
    drawBtn.textContent = '✓ Done drawing';
    clearBtn.hidden = false;
    setLookupStatus('✏️ Click around your field\'s edge to trace it, then press “Done drawing”.', '');
  } else {
    DRAW.on = false;
    drawBtn.textContent = '✏️ Draw field boundary';
    if (DRAW.pts.length >= 3) setLookupStatus('Boundary set (' + DRAW.pts.length +
      ' points). Now press “Find the soils in this pasture”.', '');
    else setLookupStatus('Need at least 3 points to make a field — keep clicking, or clear.', 'error');
  }
}

function clearDraw() {
  DRAW.on = false; DRAW.pts = [];
  if (DRAW.layer) { MAP.removeLayer(DRAW.layer); DRAW.layer = null; }
  if (MARKER) MARKER.setOpacity(1);
  document.getElementById('draw-btn').textContent = '✏️ Draw field boundary';
  document.getElementById('clear-draw-btn').hidden = true;
  setLookupStatus('Boundary cleared — we\'ll scan the area around the pin instead.', '');
}

async function locate(getCoords, place) {
  document.getElementById('lookup-summary').hidden = true;
  setLookupStatus('Finding your coordinates…', 'loading');
  try {
    const coords = await getCoords();
    showMap(coords, place || coords.label);
  } catch (e) {
    setLookupStatus('⚠️ ' + e.message, 'error');
  }
}

async function scanPasture() {
  if (!MARKER) { setLookupStatus('Find your location on the map first.', 'error'); return; }
  let poly, center;
  if (DRAW.pts.length >= 3) {
    poly = DRAW.pts.concat([DRAW.pts[0]]);
    center = {
      lat: DRAW.pts.reduce(function (a, p) { return a + p[1]; }, 0) / DRAW.pts.length,
      lon: DRAW.pts.reduce(function (a, p) { return a + p[0]; }, 0) / DRAW.pts.length
    };
  } else {
    const ll = MARKER.getLatLng();
    center = { lat: ll.lat, lon: ll.lng };
    poly = window.APP_GEO.pinSquare(center.lat, center.lon, 5);
  }

  setLookupStatus('Reading every soil type in your pasture, plus elevation and climate…', 'loading');
  const settled = await Promise.allSettled([
    window.APP_GEO.lookupPastureSoils(poly),
    window.APP_GEO.lookupTerrain(center.lat, center.lon),
    window.APP_GEO.lookupClimate(center.lat, center.lon)
  ]);
  const pasture = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const terrain = settled[1].status === 'fulfilled' ? settled[1].value : null;
  const climate = settled[2].status === 'fulfilled' ? settled[2].value : null;

  if (!pasture && !terrain && !climate) {
    setLookupStatus('⚠️ Couldn\'t reach the map services. Please fill in the questions below by hand.', 'error');
    return;
  }
  PASTURE = pasture;
  applyPastureFindings(pasture, terrain, climate);
  renderPastureSummary(pasture, terrain, climate, PLACE);
  setLookupStatus('', '');
  document.getElementById('lookup-summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function initLookup() {
  const addr = document.getElementById('address-input');
  document.getElementById('lookup-btn').addEventListener('click', function () {
    const q = addr.value.trim();
    if (!q) { addr.focus(); setLookupStatus('Type an address, or use “Use my location”.', 'error'); return; }
    locate(function () { return window.APP_GEO.geocode(q); }, null);
  });
  addr.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('lookup-btn').click(); }
  });
  document.getElementById('geoloc-btn').addEventListener('click', function () {
    locate(function () { return window.APP_GEO.browserLocation(); }, 'your current location');
  });
  document.getElementById('scan-btn').addEventListener('click', scanPasture);
  document.getElementById('draw-btn').addEventListener('click', toggleDraw);
  document.getElementById('clear-draw-btn').addEventListener('click', clearDraw);
}

/* ---- boot -------------------------------------------------------------- */

let DATA = null;

async function init() {
  buildForm();
  initLookup();
  const btn = document.getElementById('build-btn');
  btn.addEventListener('click', async function () {
    if (!DATA) {
      btn.textContent = 'Loading data…';
      try { DATA = await loadData(); }
      catch (e) {
        document.getElementById('results').innerHTML =
          '<div class="empty-state"><h2>Couldn\'t load the plant database</h2><p>' + e.message +
          '</p><p>If you opened this file directly, run it through a local web server or GitHub Pages so the data files can load.</p></div>';
        document.getElementById('results').classList.add('visible');
        btn.textContent = 'Build my seed mix →';
        return;
      }
      btn.textContent = 'Build my seed mix →';
    }
    const answers = readAnswers();
    if (PASTURE && PASTURE.profile && PASTURE.soils && PASTURE.soils.length) {
      const prec = window.APP_RECOMMENDER.recommendPasture(answers, PASTURE.profile, DATA);
      renderPastureResults(prec, DATA);
    } else {
      renderResults(window.APP_RECOMMENDER.recommend(answers, DATA), DATA);
    }
  });

  // Pre-load data in the background so the first click is instant.
  loadData().then(function (d) { DATA = d; }).catch(function () { /* handled on click */ });
}

document.addEventListener('DOMContentLoaded', init);
