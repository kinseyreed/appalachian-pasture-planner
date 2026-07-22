/*
 * Appalachian Pasture Planner — UI controller
 * Loads the data files, renders the questionnaire, and displays the mix.
 */

/* ---- option definitions (also drive the rendered form) ----------------- */

// Goal factors — each rendered as a 0-7 importance slider.
const GOAL_FACTORS = [
  { id: 'extend-grazing', label: 'Extend the grazing season' },
  { id: 'summer-forage', label: 'Summer production (beat the slump)' },
  { id: 'drought', label: 'Drought resilience' },
  { id: 'stand-longevity', label: 'Stand longevity (persistence)' },
  { id: 'soil-health', label: 'Improve soil health' },
  { id: 'nitrogen', label: 'Fix nitrogen / cut fertilizer' },
  { id: 'reduce-fescue-tox', label: 'Reduce toxic-fescue problems' },
  { id: 'pollinators', label: 'Pollinators & wildlife' },
  { id: 'erosion', label: 'Erosion control' },
  { id: 'hay', label: 'Hay / stored feed' },
  { id: 'quick-establish', label: 'Quick establishment' },
  { id: 'weeds', label: 'Out-compete weeds' },
  { id: 'low-input', label: 'Low input / low cost' }
];

const TEXTURE_OPTIONS = [
  { id: 'light', label: 'Sandy / light', hint: 'Gritty, drains fast' },
  { id: 'medium', label: 'Loam / medium', hint: 'Typical pasture loam' },
  { id: 'heavy', label: 'Clay / heavy', hint: 'Sticky wet, hard when dry' },
  { id: 'unknown', label: 'Not sure', hint: "We'll use the soil map" }
];

// Soil structure — rendered as a single 0-7 slider in the fertility section.
// (Acidity, wetness, droughtiness and slope are derived from the pH, drainage
// and mapped-terrain answers instead of being asked again.)
const COMPACTION_FACTOR = [
  { id: 'compaction', label: 'Compaction (0 = loose and friable, 7 = hard pan / heavy traffic)' }
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

// Seeding methods — multi-select; a farmer can combine several (e.g. drill in
// fall, then frost-seed legumes in late winter).
const METHOD_OPTIONS = [
  { id: 'auto', label: 'Recommend the best method(s) for me', hint: 'We pick the optimum combination for this mix' },
  { id: 'drill-fall', label: 'No-till drill — late summer/fall', hint: '' },
  { id: 'drill-spring', label: 'No-till drill — spring', hint: '' },
  { id: 'frost-seed', label: 'Frost-seed legumes — late winter', hint: 'Broadcast onto short sod' },
  { id: 'broadcast-fall', label: 'Broadcast + cultipack — fall', hint: '' },
  { id: 'broadcast-spring', label: 'Broadcast + cultipack — spring', hint: '' },
  { id: 'tillage', label: 'Conventional tillage seedbed', hint: 'Full prep + cultipack' }
];

const GRAZING_OPTIONS = [
  { id: 'continuous-heavy', label: 'Continuous, heavily stocked', hint: 'Set-stocked, grazed short' },
  { id: 'continuous-light', label: 'Continuous, lightly stocked', hint: 'Set-stocked, low density' },
  { id: 'rot-overgrazed', label: 'Rotational but overgrazed', hint: 'Paddocks, short rest, grazed low' },
  { id: 'rot-managed', label: 'Well-managed rotational', hint: 'Adequate rest & residual' },
  { id: 'mob', label: 'Management-intensive / mob', hint: 'Frequent moves, long rest' }
];

const ELEVATION_OPTIONS = [
  { id: 'low', label: 'Lower / milder valleys', hint: '' },
  { id: 'high', label: 'Higher / colder mountains', hint: 'Above ~2,500 ft' }
];

const SEASON_OPTIONS = [
  { id: 'cool', label: 'Cool-season (spring & fall)', hint: 'Strong spring/fall growth; slumps in summer heat' },
  { id: 'warm', label: 'Warm-season (summer pasture)', hint: 'Beats the summer slump; dormant in cool months' },
  { id: 'both', label: 'Year-round mix', hint: 'Moderate growth all season — no big flushes' }
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
        // "Recommend for me" is exclusive of the specific methods.
        if (name === 'method' && chip.classList.contains('selected')) {
          const isAuto = chip.dataset.value === 'auto';
          container.querySelectorAll('.chip').forEach(function (c) {
            if (c === chip) return;
            if (isAuto || c.dataset.value === 'auto') c.classList.remove('selected');
          });
        }
      } else {
        container.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
      }
    });
    container.appendChild(chip);
  });
}

function renderSliders(container, factors) {
  factors.forEach(function (f) {
    const row = el('div', 'slider-row');
    row.innerHTML =
      '<label class="slider-label" for="pri-' + f.id + '">' + f.label + '</label>' +
      '<input type="range" id="pri-' + f.id + '" class="pri-slider" data-factor="' + f.id + '" min="0" max="7" step="1" value="0">' +
      '<output class="slider-val" for="pri-' + f.id + '">0</output>';
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', function () {
      out.textContent = input.value;
      row.classList.toggle('active', parseInt(input.value, 10) > 0);
    });
    container.appendChild(row);
  });
}

function buildForm() {
  renderChips(document.getElementById('q-season'), SEASON_OPTIONS, 'season', false);
  renderChips(document.getElementById('q-elevation'), ELEVATION_OPTIONS, 'elevation', false);
  renderChips(document.getElementById('q-ph'), PH_OPTIONS, 'ph', false);
  renderChips(document.getElementById('q-drainage'), DRAINAGE_OPTIONS, 'drainage', false);
  renderSliders(document.getElementById('q-goals'), GOAL_FACTORS);
  renderChips(document.getElementById('q-texture'), TEXTURE_OPTIONS, 'texture', false);
  renderSliders(document.getElementById('q-compaction'), COMPACTION_FACTOR);
  renderChips(document.getElementById('q-method'), METHOD_OPTIONS, 'method', true);
  renderChips(document.getElementById('q-grazing'), GRAZING_OPTIONS, 'grazing', false);

  // sensible defaults
  selectDefault('season', 'both');
  selectDefault('elevation', 'low');
  selectDefault('drainage', 'moderate');
  selectDefault('ph', 'unknown');
  selectDefault('method', 'auto');
  selectDefault('grazing', 'rot-managed');
  selectDefault('texture', 'unknown');
}

function readPriorities() {
  const p = {};
  document.querySelectorAll('.pri-slider').forEach(function (s) {
    if (s.dataset.factor === 'compaction') return; // handled separately
    const v = parseInt(s.value, 10);
    if (v > 0) p[s.dataset.factor] = v;
  });
  return p;
}

function numOrNull(id) {
  const el2 = document.getElementById(id);
  if (!el2 || el2.value === '') return null;
  const v = parseFloat(el2.value);
  return isNaN(v) ? null : v;
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
    priorities: readPriorities(),
    soilP: numOrNull('soil-p'),
    soilK: numOrNull('soil-k'),
    soilOM: numOrNull('soil-om'),
    fertilityUnknown: document.getElementById('fert-unknown').checked,
    texture: readSingle('texture'),
    compaction: parseInt((document.getElementById('pri-compaction') || {}).value || 0, 10),
    methods: readMulti('method'),
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
    card.appendChild(el('div', 'sc-note lime', 'Lime this ground up to ~pH 6.5 before seeding.'));
  }
  if (result.separatePaddock) {
    card.appendChild(el('div', 'sc-note paddock', 'Establish and graze this in its own paddock, separate from cool-season pasture.'));
  }
  if (sp.cautions) {
    card.appendChild(el('div', 'sc-caution', 'Caution: ' + sp.cautions));
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

// The interactive seed-mix table. CURRENT holds the editable mix so delete/add
// and the total-rate control all recompute the plan and groundcover live.
let CURRENT = null;
let LAST_ANSWERS = null;

function speciesDetailHtml(result, data) {
  const sp = result.species;
  let h = '<div class="detail-inner">';
  h += '<p class="d-summary">' + sp.summary + '</p>';
  if (sp.strengths) h += '<p class="d-line"><strong>Strengths:</strong> ' + sp.strengths + '</p>';
  if (result.reasons && result.reasons.length) {
    h += '<ul class="sc-reasons">' + result.reasons.map(function (r) {
      return '<li class="' + (r.indexOf('WV trial') === 0 ? 'reason local' : 'reason') + '">' + r + '</li>';
    }).join('') + '</ul>';
  }
  if (result.limeNote) h += '<div class="sc-note lime">Lime this ground up to ~pH 6.5 before seeding.</div>';
  if (sp.cautions) h += '<div class="sc-caution"><strong>Caution:</strong> ' + sp.cautions + '</div>';
  const row = CURRENT && CURRENT.planRows ? CURRENT.planRows[sp.id] : null;
  if (row) {
    h += '<div class="tag-editor">' +
      '<div class="tag-head">From your seed tag</div>' +
      '<p class="tag-help">Type what the label on the bag you ordered says. Bulk pounds and cost update to match. ' +
      'If the tag only lists germination, leave purity as is.</p>' +
      '<label>Purity <input type="number" class="tag-input" data-tag="purity" data-id="' + sp.id + '" value="' + (row.purity != null ? row.purity : '') + '" min="1" max="100" step="0.1">%</label>' +
      '<label>Germination (incl. hard/dormant) <input type="number" class="tag-input" data-tag="germ" data-id="' + sp.id + '" value="' + (row.germ != null ? row.germ : '') + '" min="1" max="100" step="0.1">%</label>' +
      '<div class="tag-result">= <strong>' + (Math.round(row.plsPct * 10) / 10) + '% PLS</strong> &rarr; ' +
      '<strong>' + row.bulkRate.toFixed(1) + ' bulk lb/ac</strong> to deliver ' + row.plsRate.toFixed(1) + ' lb PLS/ac' +
      (row.fromTag ? ' <button type="button" class="tag-reset" data-act="tag-reset" data-id="' + sp.id + '">reset to default</button>' : '') +
      '</div></div>';
  }
  if (sp.sources && sp.sources.length) {
    const ss = sp.sources.map(function (id) {
      const s = data.sources.sources[id]; if (!s) return '';
      return '<a href="' + s.url + '" target="_blank" rel="noopener">' + (s.org || s.title) + '</a>';
    }).filter(Boolean).join(', ');
    if (ss) h += '<div class="d-sources">Sources: ' + ss + '</div>';
  }
  return h + '</div>';
}

function renderSeedTable() {
  if (!CURRENT) return;
  const data = CURRENT.data, mix = CURRENT.mix, total = CURRENT.total;
  const plan = window.APP_RECOMMENDER.buildSeedPlan(
    mix, data.prep, CURRENT.totalUserSet ? total : null, CURRENT.tags, CURRENT.evenness, CURRENT.rates);
  if (!CURRENT.totalUserSet) CURRENT.total = plan.recommendedTotal;
  const totalInput = document.getElementById('total-pls');
  if (totalInput && document.activeElement !== totalInput) totalInput.value = Math.round(plan.totalPls * 10) / 10;
  const recEl = document.getElementById('rec-total');
  if (recEl) recEl.textContent = (Math.round(plan.recommendedTotal * 10) / 10) + ' lb';
  CURRENT.planRows = {};
  plan.rows.forEach(function (r) { CURRENT.planRows[r.species.id] = r; });
  const V = (data.vendors && data.vendors.vendors) || {};
  const c = plan.composition;

  document.getElementById('comp-summary').innerHTML = 'Estimated groundcover: ' +
    '<span class="comp-chip grass">Grasses ' + (c.grass || 0) + '%</span>' +
    '<span class="comp-chip legume">Legumes ' + (c.legume || 0) + '%</span>' +
    '<span class="comp-chip forb">Forbs ' + (c.forb || 0) + '%</span>' +
    '<span class="comp-target">aim ~50 / 35 / 15</span>';

  let html = '<thead><tr><th></th><th>Species</th><th class="num">Cover</th><th>Suggested variety</th><th>Seed box</th>' +
    '<th>Depth</th><th>When to plant</th><th class="num">PLS<br>lb/ac</th><th class="num">Bulk<br>lb/ac</th><th class="num">Est.<br>$/ac</th><th>Sources</th></tr></thead><tbody>';
  plan.rows.forEach(function (r) {
    const p = r.prep || {};
    const v = (p.varieties && p.varieties[0]) || { name: '—', note: '' };
    const srcs = (p.sources || []).map(function (id) {
      const x = V[id]; if (!x) return '';
      return '<a href="' + x.url + '" target="_blank" rel="noopener" title="' + x.name + ' — ' + (x.region || '') + '">' + x.name.split(' ')[0] + '</a>';
    }).filter(Boolean).join(', ');
    html += '<tr class="grp-' + r.group + '" data-row="' + r.species.id + '">' +
      '<td><button type="button" class="row-del" data-act="del" data-id="' + r.species.id + '" title="Remove from mix">×</button></td>' +
      '<td><button type="button" class="row-name" data-act="detail" data-id="' + r.species.id + '"><strong>' + r.species.commonName + '</strong><br><span class="tsci">' + r.species.scientificName + '</span></button></td>' +
      '<td class="num">' + r.coverPct.toFixed(0) + '%</td>' +
      '<td title="' + (v.note || '') + '">' + v.name + '</td>' +
      '<td>' + (p.seedBox || '—') + '</td>' +
      '<td>' + (p.depth || '—') + '</td>' +
      '<td>' + (p.seasonWindow || '—') + '</td>' +
      '<td class="num"><input type="number" class="rate-input' + (r.pinnedRate ? ' pinned' : '') + '" data-id="' + r.species.id + '" value="' + r.plsRate.toFixed(1) + '" min="0" step="0.1" title="Edit to set this species&#39; rate yourself">' +
      '<br><span class="pls-pct' + (r.fromTag ? ' tagged' : '') + '">' + Math.round(r.plsPct) + '% PLS</span></td>' +
      '<td class="num">' + r.bulkRate.toFixed(1) + '</td>' +
      '<td class="num">' + money(r.costLow, r.costHigh) + '</td>' +
      '<td class="src">' + srcs + '</td></tr>';
  });
  html += '</tbody><tfoot><tr><td></td><td>TOTAL per acre</td><td class="num">100%</td><td colspan="4"></td>' +
    '<td class="num">' + plan.totals.pls.toFixed(1) + '</td><td class="num">' + plan.totals.bulk.toFixed(1) + '</td>' +
    '<td class="num">' + money(plan.totals.costLow, plan.totals.costHigh) + '</td><td></td></tr></tfoot>';
  document.getElementById('seed-table-el').innerHTML = html;

  const setTxt = function (id, v) { const n = document.getElementById(id); if (n) n.textContent = v; };
  setTxt('m-rich', plan.richness);
  setTxt('rich-val', plan.richness);
  setTxt('m-simpson', plan.simpson.toFixed(2));
  setTxt('m-eff', plan.effectiveSpecies.toFixed(1));
  setTxt('even-val', CURRENT.evenness >= 0.95 ? 'even' : (CURRENT.evenness <= 0.3 ? 'top-heavy' : 'mixed'));

  const byBox = {};
  plan.rows.forEach(function (r) { const b = (r.prep && r.prep.seedBox) || 'Other'; (byBox[b] = byBox[b] || []).push(r); });
  let bh = '<h4>Filling your drill boxes</h4><div class="box-list">';
  Object.keys(byBox).forEach(function (b) {
    const rows = byBox[b]; const tot = rows.reduce(function (a, r) { return a + r.bulkRate; }, 0);
    bh += '<div class="box-item"><div class="box-name">' + b + ' — ' + tot.toFixed(1) + ' bulk lb/ac</div>' +
      '<div class="box-species">' + rows.map(function (r) { return r.species.commonName + ' (' + r.bulkRate.toFixed(1) + ')'; }).join(', ') + '</div></div>';
  });
  document.getElementById('box-summary').innerHTML = bh + '</div>';
}

function toggleDetailRow(id) {
  const tr = document.querySelector('#seed-table-el tr[data-row="' + id + '"]');
  if (!tr) return;
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('detail-row')) { next.remove(); CURRENT.openDetail = null; return; }
  CURRENT.openDetail = id;
  const result = CURRENT.mix.find(function (m) { return m.species.id === id; });
  if (!result) return;
  const dr = document.createElement('tr');
  dr.className = 'detail-row grp-' + result.species.type;
  dr.innerHTML = '<td></td><td colspan="10">' + speciesDetailHtml(result, CURRENT.data) + '</td>';
  tr.parentNode.insertBefore(dr, tr.nextSibling);
}

// Add or drop a species, keeping the grass/legume/forb balance sensible.
function adjustRichness(delta) {
  const season = CURRENT.ctx && CURRENT.ctx.season ? CURRENT.ctx.season : 'both';
  const seasonOk = function (sp) { return season === 'both' || sp.season === season; };
  if (delta > 0) {
    const counts = { grass: 0, legume: 0, forb: 0 };
    CURRENT.mix.forEach(function (m) { counts[m.species.type]++; });
    const inMix = {}; CURRENT.mix.forEach(function (m) { inMix[m.species.id] = 1; });
    const total = CURRENT.mix.length || 1;
    const targetShare = { grass: 0.4, legume: 0.35, forb: 0.25 };
    let bestGroup = 'grass', worstGap = -Infinity;
    Object.keys(counts).forEach(function (g) {
      const gap = targetShare[g] - counts[g] / total;
      if (gap > worstGap) { worstGap = gap; bestGroup = g; }
    });
    const avail = (CURRENT.scored || []).filter(function (r) {
      return !r.disqualified && !inMix[r.species.id] && seasonOk(r.species);
    }).sort(function (a, b) { return b.score - a.score; });
    const pick = avail.filter(function (r) { return r.species.type === bestGroup; })[0] || avail[0];
    if (pick) CURRENT.mix.push(pick);
  } else {
    if (CURRENT.mix.length <= 2) return;
    const counts = {};
    CURRENT.mix.forEach(function (m) { counts[m.species.type] = (counts[m.species.type] || 0) + 1; });
    let biggest = null, n = 0;
    Object.keys(counts).forEach(function (g) { if (counts[g] > n) { n = counts[g]; biggest = g; } });
    const pool = CURRENT.mix.filter(function (m) { return m.species.type === biggest; });
    const worst = pool.reduce(function (a, b) { return (a.score || 0) <= (b.score || 0) ? a : b; });
    CURRENT.mix = CURRENT.mix.filter(function (m) { return m !== worst; });
  }
  CURRENT.openDetail = null;
  renderSeedTable();
}

function downloadFile(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function csvCell(v) {
  const t = String(v == null ? '' : v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

function exportCsv() {
  const plan = window.APP_RECOMMENDER.buildSeedPlan(
    CURRENT.mix, CURRENT.data.prep, CURRENT.totalUserSet ? CURRENT.total : null,
    CURRENT.tags, CURRENT.evenness, CURRENT.rates);
  const V = (CURRENT.data.vendors && CURRENT.data.vendors.vendors) || {};
  const c = plan.composition;
  const lines = [];
  lines.push(['Appalachian Pasture Planner - seed mix plan'].map(csvCell).join(','));
  lines.push(['Saved', new Date().toLocaleString()].map(csvCell).join(','));
  lines.push(['Total seeding rate (lb PLS/acre)', (Math.round(plan.totalPls * 10) / 10)].map(csvCell).join(','));
  lines.push(['Recommended total (lb PLS/acre)', (Math.round(plan.recommendedTotal * 10) / 10)].map(csvCell).join(','));
  lines.push(['Estimated groundcover', 'Grasses ' + (c.grass || 0) + '%', 'Legumes ' + (c.legume || 0) + '%', 'Forbs ' + (c.forb || 0) + '%'].map(csvCell).join(','));
  lines.push(['Species richness', plan.richness, 'Simpson diversity', plan.simpson.toFixed(2), 'Effective species', plan.effectiveSpecies.toFixed(1)].map(csvCell).join(','));
  lines.push('');
  lines.push(['Species', 'Scientific name', 'Group', 'Cover %', 'Suggested variety', 'Seed box', 'Depth',
    'When to plant', 'PLS lb/ac', 'Purity % (from tag)', 'Germination % (from tag)', 'PLS %', 'Bulk lb/ac',
    'Est $/ac low', 'Est $/ac high', 'Seed sources'].map(csvCell).join(','));
  plan.rows.forEach(function (r) {
    const p = r.prep || {};
    const v = (p.varieties && p.varieties[0]) || { name: '' };
    const srcs = (p.sources || []).map(function (id) { return V[id] ? V[id].name : ''; }).filter(Boolean).join('; ');
    lines.push([r.species.commonName, r.species.scientificName, r.group, Math.round(r.coverPct),
      v.name, p.seedBox || '', p.depth || '', p.seasonWindow || '',
      r.plsRate.toFixed(1), r.purity != null ? r.purity : '', r.germ != null ? r.germ : '',
      Math.round(r.plsPct), r.bulkRate.toFixed(1), Math.round(r.costLow), Math.round(r.costHigh), srcs].map(csvCell).join(','));
  });
  lines.push(['TOTAL', '', '', 100, '', '', '', '', plan.totals.pls.toFixed(1), '', '', '',
    plan.totals.bulk.toFixed(1), Math.round(plan.totals.costLow), Math.round(plan.totals.costHigh), ''].map(csvCell).join(','));
  downloadFile('pasture-seed-mix.csv', 'text/csv;charset=utf-8', lines.join('\n'));
}

function savePlan() {
  const plan = {
    app: 'appalachian-pasture-planner', version: 1, savedAt: new Date().toISOString(),
    answers: CURRENT.answers || LAST_ANSWERS,
    speciesIds: CURRENT.mix.map(function (m) { return m.species.id; }),
    total: CURRENT.total, totalUserSet: CURRENT.totalUserSet,
    evenness: CURRENT.evenness, tags: CURRENT.tags, rates: CURRENT.rates
  };
  downloadFile('pasture-plan.json', 'application/json', JSON.stringify(plan, null, 2));
}

async function openPlan(file) {
  let p;
  try { p = JSON.parse(await file.text()); }
  catch (e) { alert('That file could not be read as a saved plan.'); return; }
  if (!p || p.app !== 'appalachian-pasture-planner') { alert('That does not look like a saved pasture plan.'); return; }
  if (!DATA) DATA = await loadData();
  const rec = window.APP_RECOMMENDER.recommend(p.answers || {}, DATA);
  const byId = {};
  rec.scored.forEach(function (r) { byId[r.species.id] = r; });
  const mix = (p.speciesIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
  if (mix.length) rec.mix = mix;
  LAST_ANSWERS = p.answers || null;
  renderResults(rec, DATA);
  setTimeout(function () {
    CURRENT.tags = p.tags || {};
    CURRENT.rates = p.rates || {};
    CURRENT.evenness = p.evenness == null ? 1 : p.evenness;
    CURRENT.total = p.total;
    CURRENT.totalUserSet = !!p.totalUserSet;
    const ev = document.getElementById('evenness');
    if (ev) ev.value = Math.round(CURRENT.evenness * 100);
    renderSeedTable();
  }, 30);
}

function findScored(id) {
  if (CURRENT.scored) { const r = CURRENT.scored.find(function (x) { return x.species.id === id; }); if (r) return r; }
  const sp = CURRENT.data.species.find(function (s) { return s.id === id; });
  return sp ? { species: sp, reasons: [], score: 0 } : null;
}

function renderAddPanel(filter) {
  const list = document.getElementById('add-list');
  const inMix = {}; CURRENT.mix.forEach(function (m) { inMix[m.species.id] = 1; });
  const q = (filter || '').toLowerCase();
  const items = CURRENT.data.species.filter(function (s) {
    return !inMix[s.id] && (!q || (s.commonName + ' ' + s.scientificName).toLowerCase().indexOf(q) !== -1);
  });
  const order = { grass: 0, legume: 1, forb: 2 };
  items.sort(function (a, b) { return order[a.type] - order[b.type] || a.commonName.localeCompare(b.commonName); });
  list.innerHTML = items.map(function (s) {
    return '<div class="add-item"><button type="button" class="add-btn" data-act="add" data-id="' + s.id + '">+ Add</button>' +
      '<span class="add-name"><strong>' + s.commonName + '</strong> <span class="add-tag ' + s.type + '">' + s.type + (s.native ? ' · native' : '') + '</span>' +
      '<br><span class="add-sum">' + s.summary + '</span></span></div>';
  }).join('') || '<p class="add-empty">No matching species.</p>';
}

function buildSeedTableSection(mix, data, scored, ctx) {
  CURRENT = { mix: mix.slice(), data: data, total: null, totalUserSet: false, scored: scored || [], tags: {}, rates: {}, planRows: {}, openDetail: null, evenness: 1, ctx: ctx || null, answers: LAST_ANSWERS };
  const section = el('section', 'seed-table-section');
  section.innerHTML =
    '<h3 class="section-h">Your seed-mix plan — what to buy &amp; how to plant it</h3>' +
    '<p class="seed-intro"><strong>Click a species name</strong> to see its details and to enter the purity and germination from your own seed tag (this recalculates its PLS and bulk pounds). Use the remove button to drop a species, or add more below — rates, groundcover and diversity update automatically.</p>' +
    '<div class="seed-ctrl no-print">' +
      '<div class="rate-row"><label for="total-pls"><strong>Total seeding rate</strong></label>' +
      '<input type="number" id="total-pls" min="1" max="80" step="0.5"> <span class="ctrl-hint">lb PLS/acre</span>' +
      '<button type="button" class="rate-reset" data-act="rate-reset">reset to recommended (<span id="rec-total">—</span>)</button></div>' +
      '<p class="rate-why"><strong>Where this number comes from:</strong> each species is seeded at its share of what a <em>pure stand</em> of that species would need, ' +
      'so the mix as a whole delivers about one full stand\'s worth of seed spread across the species. That total is recalculated whenever you add, remove or re-weight species.<br>' +
      '<strong>Why it matters:</strong> seed much lighter and the stand comes in thin, leaving gaps that weeds fill in the establishment year; seed much heavier and you pay for seed that mostly competes with itself and thins out anyway. ' +
      'Add roughly <strong>50% more if broadcasting</strong> rather than drilling, since less of the seed reaches soil.</p>' +
    '</div>' +
    '<div class="diversity-panel no-print">' +
    '<div class="div-controls">' +
      '<div class="div-ctl"><span class="div-label">Species richness</span>' +
        '<button type="button" class="rich-btn" data-act="rich-down" title="Remove a species">&minus;</button>' +
        '<output id="rich-val">0</output>' +
        '<button type="button" class="rich-btn" data-act="rich-up" title="Add a species">+</button></div>' +
      '<div class="div-ctl"><label class="div-label" for="evenness">Evenness</label>' +
        '<input type="range" id="evenness" min="0" max="100" step="5" value="100">' +
        '<output id="even-val">even</output></div>' +
    '</div>' +
    '<div class="div-metrics">' +
      '<span class="metric"><strong id="m-rich">0</strong> species</span>' +
      '<span class="metric"><strong id="m-simpson">0</strong> Simpson diversity</span>' +
      '<span class="metric"><strong id="m-eff">0</strong> effective species</span>' +
    '</div>' +
    '<p class="div-def"><strong>Simpson\'s index of diversity</strong> (D = 1 &minus; &Sigma;p&sup2;, where p is each species\' share of groundcover) ' +
    'runs from 0 to just under 1: <strong>0</strong> means one species owns the whole stand, and values near <strong>1</strong> mean cover is spread evenly across many species. ' +
    'The <em>effective species</em> number (1 &divide; &Sigma;p&sup2;) says how many equally-abundant species this mix behaves like. ' +
    'Raising richness adds the next best-suited species; raising evenness spreads cover more equally instead of concentrating it in the top performers.</p>' +
  '</div>' +
  '<div id="comp-summary" class="comp-summary"></div>' +
    '<div class="table-scroll"><table class="seed-table" id="seed-table-el"></table></div>' +
    '<div class="plan-io no-print">' +
      '<button type="button" class="btn btn-secondary" data-act="csv">Download for Excel (CSV)</button>' +
      '<button type="button" class="btn btn-secondary" data-act="save">Save plan</button>' +
      '<button type="button" class="btn btn-secondary" data-act="load">Open saved plan</button>' +
      '<input type="file" id="plan-file" accept="application/json,.json" hidden>' +
      '<p class="io-hint">Save your plan now, then reopen it once the seed arrives to enter the purity and germination from each tag. Files stay on your computer — nothing is uploaded.</p>' +
    '</div>' +
    '<div class="add-control no-print"><button type="button" class="btn btn-secondary" data-act="add-open">+ Add a species</button>' +
    '<div id="add-panel" class="add-panel" hidden><input type="text" id="add-search" placeholder="Search species…" autocomplete="off"><div id="add-list" class="add-list"></div></div></div>' +
    '<div id="box-summary" class="box-summary"></div>' +
    '<p class="seed-note">Costs and varieties are planning estimates ($ per pound of pure live seed) — confirm current quotes and regional ecotypes with the sources listed. ' +
    '<strong>Groundcover %</strong> is estimated from each species\' rate vs. a pure stand. <strong>Bulk lb</strong> is what you weigh out and buy. Inoculate all legumes before planting.</p>';

  section.addEventListener('click', function (e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'del') { CURRENT.mix = CURRENT.mix.filter(function (m) { return m.species.id !== id; }); renderSeedTable(); }
    else if (act === 'detail') { toggleDetailRow(id); }
    else if (act === 'add-open') { const p = document.getElementById('add-panel'); p.hidden = !p.hidden; if (!p.hidden) { renderAddPanel(''); document.getElementById('add-search').focus(); } }
    else if (act === 'csv') { exportCsv(); }
    else if (act === 'save') { savePlan(); }
    else if (act === 'load') { document.getElementById('plan-file').click(); }
    else if (act === 'rate-reset') {
      CURRENT.rates = {}; CURRENT.totalUserSet = false; CURRENT.openDetail = null; renderSeedTable();
    }
    else if (act === 'rich-up') { adjustRichness(1); }
    else if (act === 'rich-down') { adjustRichness(-1); }
    else if (act === 'tag-reset') {
      delete CURRENT.tags[id];
      renderSeedTable();
      if (CURRENT.openDetail === id) { CURRENT.openDetail = null; toggleDetailRow(id); }
    }
    else if (act === 'add') { const r = findScored(id); if (r && !CURRENT.mix.some(function (m) { return m.species.id === id; })) CURRENT.mix.push(r); renderSeedTable(); renderAddPanel(document.getElementById('add-search').value); }
  });
  section.addEventListener('change', function (e) {
    if (e.target.id === 'plan-file') {
      if (e.target.files && e.target.files[0]) openPlan(e.target.files[0]);
      e.target.value = '';
      return;
    }
    if (e.target.classList.contains('rate-input')) {
      const rid = e.target.getAttribute('data-id');
      const rv = parseFloat(e.target.value);
      if (isNaN(rv) || rv < 0) delete CURRENT.rates[rid]; else CURRENT.rates[rid] = rv;
      renderSeedTable();
      return;
    }
    if (!e.target.classList.contains('tag-input')) return;
    const id = e.target.getAttribute('data-id');
    const which = e.target.getAttribute('data-tag');
    const v = parseFloat(e.target.value);
    CURRENT.tags[id] = CURRENT.tags[id] || {};
    if (isNaN(v) || v <= 0) delete CURRENT.tags[id][which]; else CURRENT.tags[id][which] = Math.min(100, v);
    if (!Object.keys(CURRENT.tags[id]).length) delete CURRENT.tags[id];
    renderSeedTable();
    if (CURRENT.openDetail === id) { CURRENT.openDetail = null; toggleDetailRow(id); }
  });
  section.addEventListener('input', function (e) {
    if (e.target.id === 'total-pls') { CURRENT.total = parseFloat(e.target.value) || null; CURRENT.totalUserSet = true; renderSeedTable(); }
    else if (e.target.id === 'evenness') { CURRENT.evenness = parseInt(e.target.value, 10) / 100; renderSeedTable(); }
    else if (e.target.id === 'add-search') { renderAddPanel(e.target.value); }
  });

  setTimeout(renderSeedTable, 0);
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

  if (rec.usedLocal) {
    out.appendChild(el('div', 'local-banner',
      '<strong>Informed by West Virginia trial data.</strong> Species adjusted using local establishment results.'));
  }

  // Interactive seed-mix table (species details on click; add/remove; groundcover).
  const mainMix = rec.mix;
  out.appendChild(buildSeedTableSection(mainMix, data, rec.scored, rec.ctx));

  // Custom establishment plan written for this mix, soil and seeding methods.
  if (window.APP_RECOMMENDER.buildEstablishmentPlan) {
    const steps = window.APP_RECOMMENDER.buildEstablishmentPlan(rec.ctx, mainMix, data.prep);
    out.appendChild(el('h3', 'section-h', 'How to plant this mix and get it established'));
    out.appendChild(el('p', 'plan-intro',
      'Written for this mix, your soil, and the seeding methods you chose — in the order you should do them.'));
    const ol = el('ol', 'plan-list');
    steps.forEach(function (st) {
      const li = el('li', 'plan-step');
      li.appendChild(el('h4', 'plan-title', st.title));
      if (st.body) li.appendChild(el('p', 'plan-body', st.body));
      if (st.bullets && st.bullets.length) {
        const ul = el('ul', 'plan-bullets');
        st.bullets.forEach(function (b) { ul.appendChild(el('li', null, b)); });
        li.appendChild(ul);
      }
      ol.appendChild(li);
    });
    out.appendChild(ol);

    const planSrc = ['wvu-fertility', 'wvu-lime-tool', 'wvu-blend-calc', 'wvu-soil-report', 'wvu-pelleted-lime', 'psu-forage-maintenance',
      'umd-seeding', 'msu-pasture-est', 'ut-planting', 'ifas-calibration', 'psu-spreader-calib', 'umd-summer-grazing', 'uky-rest', 'pb1752'];
    const sw = el('p', 'plan-sources', 'Establishment guidance follows: ');
    const planSources = planSrc.map(function (id) { return data.sources.sources[id]; }).filter(Boolean);
    planSources.forEach(function (s, i) {
      const a = el('a', null, s.title);
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.title = s.org;
      sw.appendChild(a);
      if (i < planSources.length - 1) sw.appendChild(document.createTextNode(' · '));
    });
    out.appendChild(sw);
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
  const printBtn = el('button', 'btn btn-secondary', 'Print / Save PDF');
  printBtn.addEventListener('click', function () { window.print(); });
  const againBtn = el('button', 'btn btn-secondary', 'Start over');
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
  b.innerHTML = '<strong>Your pasture spans ' + nSoils + ' soil type' + (nSoils > 1 ? 's' : '') + '.</strong> ' +
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
  const icons = { wet: '', acid: '', dry: '' };
  problems.forEach(function (p) {
    const card = el('div', 'problem-area');
    card.appendChild(el('div', 'pa-head', (icons[p.area.key] || '') + '<strong>' + p.area.label +
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
  if (prof && prof.texture) selectValue('texture', prof.texture, true);
  const cold = (terrain && terrain.high) || (climate && climate.cold);
  if (terrain || climate) selectValue('elevation', cold ? 'high' : 'low', true);
  if (climate && climate.lowRainfall) addChallenge('droughty', true);

  AUTOFILL = {
    aspectDeg: terrain ? terrain.aspectDeg : null,
    slopePct: (prof && prof.dominant && prof.dominant.slope != null) ? prof.dominant.slope
      : (terrain && terrain.slopeDegDEM != null ? Math.round(Math.tan(terrain.slopeDegDEM * Math.PI / 180) * 100) : null),
    organicMatter: prof ? prof.organicMatter : null,
    texture: prof ? prof.texture : null,
    clayPct: prof ? prof.clayPct : null,
    recentDroughtStress: climate ? climate.droughtStress : 0
  };

  // Offer the mapped organic matter as a starting value if the farmer hasn't
  // entered their own soil test.
  const omField = document.getElementById('soil-om');
  if (omField && !omField.value && prof && prof.organicMatter != null) {
    omField.value = Math.round(prof.organicMatter * 10) / 10;
    omField.classList.add('from-map');
  }
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
  box.appendChild(el('div', 'sum-head', 'Here\'s what we found for <strong>' +
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
      box.appendChild(el('p', 'soils-note', 'We spotted ' + p.problemAreas.length +
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
    'These are <strong>map estimates</strong> for your field — we\'ve pre-filled the questions below from them. ' +
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
  setLookupStatus('Positioned at <strong>' + (label ? label.replace(/</g, '') : 'your location') +
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
    drawBtn.textContent = 'Done drawing';
    clearBtn.hidden = false;
    setLookupStatus('Click around your field\'s edge to trace it, then press “Done drawing”.', '');
  } else {
    DRAW.on = false;
    drawBtn.textContent = 'Draw field boundary';
    if (DRAW.pts.length >= 3) setLookupStatus('Boundary set (' + DRAW.pts.length +
      ' points). Now press “Find the soils in this pasture”.', '');
    else setLookupStatus('Need at least 3 points to make a field — keep clicking, or clear.', 'error');
  }
}

function clearDraw() {
  DRAW.on = false; DRAW.pts = [];
  if (DRAW.layer) { MAP.removeLayer(DRAW.layer); DRAW.layer = null; }
  if (MARKER) MARKER.setOpacity(1);
  document.getElementById('draw-btn').textContent = 'Draw field boundary';
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
    setLookupStatus('Problem: ' + e.message, 'error');
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
    setLookupStatus('Couldn\'t reach the map services. Please fill in the questions below by hand.', 'error');
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
    LAST_ANSWERS = answers;
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
