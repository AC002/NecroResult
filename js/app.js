// UI layer: the only module that touches document/window/localStorage.
// All API and user data is inserted with textContent / DOM properties, never as HTML.
import { CASUALTY_RESULTS, DEFAULT_CAMPAIGN_URL, MAX_GANGS, SPECIAL_ACTIONS, UNARMED } from './config.js';
import { fetchCampaign } from './campaign.js';
import {
  exportRosters,
  getGangFighters,
  importRosters,
  loadRoster,
  parseRosterText,
  rosterToText,
  saveRoster,
} from './roster.js';
import { buildFighterIndex, buildReport, fighterKey, reportToText, validateDraft } from './report.js';

const DRAFT_KEY = 'necroresult.draft';

// ---------- storage ----------

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function getStorage() {
  try {
    const s = window.localStorage;
    const probe = 'necroresult.__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return createMemoryStorage(); // private mode / storage disabled: work without persistence
  }
}

const storage = getStorage();

// ---------- draft ----------

function defaultDraft() {
  return { campaignInput: DEFAULT_CAMPAIGN_URL, selectedGangIds: [], casualties: [], specialActions: [] };
}

const asString = (v) => (typeof v === 'string' ? v : '');
const asXp = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '0');
const isObj = (v) => v !== null && typeof v === 'object';

function sanitizeDraft(d) {
  if (!isObj(d)) return defaultDraft();
  const ids = Array.isArray(d.selectedGangIds) ? d.selectedGangIds.filter((x) => typeof x === 'string' && x) : [];
  return {
    campaignInput: typeof d.campaignInput === 'string' && d.campaignInput.trim() ? d.campaignInput : DEFAULT_CAMPAIGN_URL,
    selectedGangIds: [...new Set(ids)].slice(0, MAX_GANGS),
    casualties: (Array.isArray(d.casualties) ? d.casualties : []).filter(isObj).map((r) => ({
      attackerKey: asString(r.attackerKey),
      weapon: asString(r.weapon),
      victimKey: asString(r.victimKey),
      result: asString(r.result),
      xp: asXp(r.xp),
    })),
    specialActions: (Array.isArray(d.specialActions) ? d.specialActions : []).filter(isObj).map((r) => ({
      fighterKey: asString(r.fighterKey),
      action: asString(r.action),
      xp: asXp(r.xp),
    })),
  };
}

function loadDraft() {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    return raw ? sanitizeDraft(JSON.parse(raw)) : defaultDraft();
  } catch {
    return defaultDraft(); // corrupt draft is ignored
  }
}

function saveDraft() {
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(state.draft));
  } catch {
    /* quota or disabled storage: keep working in memory */
  }
}

const state = {
  campaign: null,
  draft: loadDraft(),
  loading: false,
  report: null,
  pendingRosterText: new Map(), // gangId → unsaved textarea text
};

function draftChanged() {
  saveDraft();
  clearReport();
}

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k.startsWith('aria-') || k === 'role') node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...children);
  return node;
}

function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = 'status' + (kind ? ' ' + kind : '');
}

/**
 * Fill a <select>. `items` is either a list of strings or a list of
 * `{label, options: [{value, label}]}` groups. A value that is no longer
 * present shows as the empty placeholder (validation flags it).
 */
function fillSelect(select, items, value, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const item of items) {
    if (typeof item === 'string') {
      select.append(el('option', { value: item, text: item }));
    } else {
      const group = el('optgroup', { label: item.label });
      for (const opt of item.options) group.append(el('option', { value: opt.value, text: opt.label }));
      select.append(group);
    }
  }
  select.value = value || '';
  if (select.value !== (value || '')) select.value = '';
}

function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text, sourceTextarea) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      sourceTextarea.focus();
      sourceTextarea.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- context ----------

function selectedGangs() {
  if (!state.campaign) return [];
  return state.draft.selectedGangIds.map((id) => state.campaign.gangs.find((g) => g.id === id)).filter(Boolean);
}

function buildContext() {
  return {
    gangs: selectedGangs().map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      owner: g.owner,
      fighters: getGangFighters(g, storage),
    })),
  };
}

function fighterGroups(context, excludeKey = '') {
  return context.gangs.map((g) => ({
    label: g.name,
    options: g.fighters
      .map((f) => ({ value: fighterKey(g.id, f.name), label: f.name }))
      .filter((o) => o.value !== excludeKey),
  }));
}

// ---------- campaign ----------

async function loadCampaign() {
  if (state.loading) return;
  const input = $('campaign-input').value;
  state.draft.campaignInput = input;
  saveDraft();
  state.loading = true;
  $('load-button').disabled = true;
  setStatus($('status'), 'Loading campaign…', 'loading');
  try {
    const campaign = await fetchCampaign(input);
    state.campaign = campaign;
    const ids = new Set(campaign.gangs.map((g) => g.id));
    state.draft.selectedGangIds = state.draft.selectedGangIds.filter((id) => ids.has(id));
    draftChanged();
    const n = campaign.gangs.length;
    setStatus($('status'), `Loaded: ${campaign.name} (${n} gang${n === 1 ? '' : 's'})`, 'ok');
  } catch (err) {
    setStatus($('status'), err?.message || String(err), 'error');
  } finally {
    state.loading = false;
    $('load-button').disabled = false;
    renderAll();
  }
}

// ---------- gangs ----------

function renderGangs() {
  const list = $('gang-list');
  list.replaceChildren();
  if (!state.campaign) {
    list.append(el('p', { className: 'hint', text: 'Load a campaign to see its gangs.' }));
    return;
  }
  if (!state.campaign.gangs.length) {
    list.append(el('p', { className: 'hint', text: 'This campaign has no gangs yet.' }));
    return;
  }
  const selected = state.draft.selectedGangIds;
  const full = selected.length >= MAX_GANGS;
  for (const gang of state.campaign.gangs) {
    const checked = selected.includes(gang.id);
    const box = el('input', { type: 'checkbox', value: gang.id, checked, disabled: full && !checked });
    box.addEventListener('change', () => {
      const ids = state.draft.selectedGangIds;
      if (box.checked && !ids.includes(gang.id) && ids.length < MAX_GANGS) ids.push(gang.id);
      if (!box.checked) state.draft.selectedGangIds = ids.filter((id) => id !== gang.id);
      draftChanged();
      renderGangs();
      renderRosters();
      renderRows();
    });
    const swatch = el('span', { className: 'swatch', 'aria-hidden': 'true' });
    swatch.style.backgroundColor = gang.colour || 'transparent';
    list.append(
      el(
        'label',
        { className: 'gang' + (box.disabled ? ' disabled' : '') },
        box,
        swatch,
        el('strong', { text: gang.name }),
        el('span', { className: 'gang-type', text: gang.type }),
        el('span', { className: 'gang-owner', text: `(${gang.owner || 'unknown player'})` }),
      ),
    );
  }
}

// ---------- rosters ----------

function fighterCountText(n) {
  return `${n} fighter${n === 1 ? '' : 's'}`;
}

function renderRosters() {
  const container = $('roster-list');
  container.replaceChildren();
  const gangs = selectedGangs();
  if (!gangs.length) {
    container.append(el('p', { className: 'hint', text: 'Select a gang above to enter its roster.' }));
    return;
  }
  for (const gang of gangs) {
    const hasApiFighters = Array.isArray(gang.fighters) && gang.fighters.length > 0;
    const fighters = getGangFighters(gang, storage);
    const count = el('span', { className: 'count', text: fighterCountText(fighters.length) });
    const details = el(
      'details',
      { className: 'roster', open: fighters.length === 0 },
      el('summary', {}, el('strong', { text: gang.name }), ' — ', count),
    );

    if (hasApiFighters) {
      details.append(el('p', { className: 'hint', text: 'Fighters provided by Munda Manager (read-only):' }));
      const ul = el('ul', { className: 'api-fighters' });
      for (const f of gang.fighters) ul.append(el('li', { text: rosterToText([f]) }));
      details.append(ul);
    } else {
      const saved = rosterToText(loadRoster(storage, gang.id)?.fighters ?? []);
      const textarea = el('textarea', {
        rows: 8,
        spellcheck: false,
        value: state.pendingRosterText.has(gang.id) ? state.pendingRosterText.get(gang.id) : saved,
        placeholder: 'Example:\nBob: Lasgun, Fighting knife\nJoe: Autopistol',
        'aria-label': `Roster for ${gang.name}`,
      });
      const note = el('span', { className: 'hint' });
      const markDirty = () => {
        note.textContent = textarea.value !== saved ? 'Unsaved changes' : '';
      };
      markDirty();
      textarea.addEventListener('input', () => {
        state.pendingRosterText.set(gang.id, textarea.value);
        markDirty();
      });
      const save = el('button', { type: 'button', text: 'Save roster' });
      save.addEventListener('click', () => {
        const parsed = parseRosterText(textarea.value);
        try {
          saveRoster(storage, gang.id, gang.name, parsed);
        } catch (err) {
          setStatus($('roster-status'), `Could not save roster: ${err?.message || err}`, 'error');
          return;
        }
        state.pendingRosterText.delete(gang.id);
        setStatus($('roster-status'), `Saved roster for ${gang.name} (${fighterCountText(parsed.length)})`, 'ok');
        clearReport();
        renderRosters();
        renderRows();
      });
      details.append(textarea, el('div', { className: 'row tools' }, save, note));
    }
    container.append(details);
  }
}

function onExportRosters() {
  const data = exportRosters(storage);
  download('necroresult-rosters.json', JSON.stringify(data, null, 2) + '\n');
  const n = Object.keys(data.rosters).length;
  setStatus($('roster-status'), `Exported ${n} roster${n === 1 ? '' : 's'}`, 'ok');
}

async function onImportRosters(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const n = importRosters(storage, text); // parses fully before writing anything
    state.pendingRosterText.clear();
    setStatus($('roster-status'), `Imported ${n} roster${n === 1 ? '' : 's'} from ${file.name}`, 'ok');
    clearReport();
    renderRosters();
    renderRows();
  } catch (err) {
    setStatus($('roster-status'), err?.message || String(err), 'error');
  } finally {
    input.value = '';
  }
}

// ---------- casualty & action rows ----------

function emptyRow(colspan, text) {
  return el('tr', { className: 'empty' }, el('td', { colSpan: colspan, text }));
}

function removeButton(label, onClick) {
  const b = el('button', { type: 'button', className: 'remove', text: '✕', title: label, 'aria-label': label });
  b.addEventListener('click', onClick);
  return b;
}

function xpInput(row, label) {
  const input = el('input', { type: 'number', min: '0', step: '1', inputMode: 'numeric', 'aria-label': label });
  input.value = row.xp;
  input.addEventListener('input', () => {
    row.xp = input.value;
    draftChanged();
  });
  return input;
}

function casualtyRow(row, i, context, index) {
  const n = i + 1;
  const attacker = el('select', { 'aria-label': `Casualty ${n}: attacker` });
  const weapon = el('select', { 'aria-label': `Casualty ${n}: weapon` });
  const victim = el('select', { 'aria-label': `Casualty ${n}: victim` });
  const result = el('select', { 'aria-label': `Casualty ${n}: result` });

  const refreshDependents = () => {
    const a = index.get(row.attackerKey);
    const weapons = a
      ? [...a.fighter.weapons.filter((w) => w.toLowerCase() !== UNARMED.toLowerCase()), UNARMED]
      : [];
    fillSelect(weapon, weapons, row.weapon, a ? 'Weapon…' : 'Pick attacker first');
    weapon.disabled = !a;
    fillSelect(victim, fighterGroups(context, row.attackerKey), row.victimKey, 'Victim…');
  };

  fillSelect(attacker, fighterGroups(context), row.attackerKey, 'Fighter…');
  fillSelect(result, CASUALTY_RESULTS, row.result, 'Result…');
  refreshDependents();

  attacker.addEventListener('change', () => {
    row.attackerKey = attacker.value;
    row.weapon = ''; // weapon list depends on the attacker
    if (row.victimKey === row.attackerKey) row.victimKey = '';
    refreshDependents();
    draftChanged();
  });
  weapon.addEventListener('change', () => {
    row.weapon = weapon.value;
    draftChanged();
  });
  victim.addEventListener('change', () => {
    row.victimKey = victim.value;
    draftChanged();
  });
  result.addEventListener('change', () => {
    row.result = result.value;
    draftChanged();
  });

  const remove = removeButton(`Remove casualty ${n}`, () => {
    state.draft.casualties.splice(state.draft.casualties.indexOf(row), 1);
    draftChanged();
    renderRows();
  });

  return el(
    'tr',
    {},
    el('td', {}, attacker),
    el('td', {}, weapon),
    el('td', {}, victim),
    el('td', {}, result),
    el('td', {}, xpInput(row, `Casualty ${n}: XP`)),
    el('td', {}, remove),
  );
}

function actionRow(row, i, context) {
  const n = i + 1;
  const fighter = el('select', { 'aria-label': `Special action ${n}: fighter` });
  const action = el('select', { 'aria-label': `Special action ${n}: action` });
  fillSelect(fighter, fighterGroups(context), row.fighterKey, 'Fighter…');
  fillSelect(action, SPECIAL_ACTIONS, row.action, 'Action…');
  fighter.addEventListener('change', () => {
    row.fighterKey = fighter.value;
    draftChanged();
  });
  action.addEventListener('change', () => {
    row.action = action.value;
    draftChanged();
  });
  const remove = removeButton(`Remove special action ${n}`, () => {
    state.draft.specialActions.splice(state.draft.specialActions.indexOf(row), 1);
    draftChanged();
    renderRows();
  });
  return el(
    'tr',
    {},
    el('td', {}, fighter),
    el('td', {}, action),
    el('td', {}, xpInput(row, `Special action ${n}: XP`)),
    el('td', {}, remove),
  );
}

function renderRows() {
  const context = buildContext();
  const index = buildFighterIndex(context);

  const cBody = $('casualty-rows');
  cBody.replaceChildren();
  state.draft.casualties.forEach((row, i) => cBody.append(casualtyRow(row, i, context, index)));
  if (!state.draft.casualties.length) cBody.append(emptyRow(6, 'No casualties.'));

  const aBody = $('action-rows');
  aBody.replaceChildren();
  state.draft.specialActions.forEach((row, i) => aBody.append(actionRow(row, i, context)));
  if (!state.draft.specialActions.length) aBody.append(emptyRow(4, 'No special actions.'));
}

// ---------- report ----------

function clearReport() {
  state.report = null;
  $('report-output').hidden = true;
  $('report-errors').hidden = true;
  $('report-errors').replaceChildren();
}

function onGenerate() {
  clearReport();
  const context = buildContext();
  const errors = state.campaign ? validateDraft(state.draft, context) : ['Load a campaign first'];
  if (errors.length) {
    const list = $('report-errors');
    list.append(...errors.map((e) => el('li', { text: e })));
    list.hidden = false;
    return;
  }
  const report = buildReport(state.campaign, state.draft, context);
  state.report = report;
  $('report-json').value = JSON.stringify(report, null, 2);
  $('report-text').value = reportToText(report);
  setStatus($('report-status'), '');
  $('report-output').hidden = false;
}

async function onCopy(textareaId, label) {
  const ta = $(textareaId);
  const ok = await copyText(ta.value, ta);
  setStatus($('report-status'), ok ? `${label} copied to clipboard` : `Could not copy — select the ${label} and copy manually`, ok ? 'ok' : 'error');
}

function onDownload() {
  if (!state.report) return;
  download(`battle-report-${localDate()}.json`, JSON.stringify(state.report, null, 2) + '\n');
}

// ---------- init ----------

function renderAll() {
  renderGangs();
  renderRosters();
  renderRows();
}

function init() {
  const input = $('campaign-input');
  input.defaultValue = state.draft.campaignInput; // also reflected as the value attribute
  input.value = state.draft.campaignInput;
  input.addEventListener('input', () => {
    state.draft.campaignInput = input.value;
    saveDraft();
  });
  $('campaign-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadCampaign();
  });
  $('add-casualty').addEventListener('click', () => {
    state.draft.casualties.push({ attackerKey: '', weapon: '', victimKey: '', result: '', xp: '0' });
    draftChanged();
    renderRows();
  });
  $('add-action').addEventListener('click', () => {
    state.draft.specialActions.push({ fighterKey: '', action: '', xp: '0' });
    draftChanged();
    renderRows();
  });
  $('export-rosters').addEventListener('click', onExportRosters);
  $('import-rosters').addEventListener('change', onImportRosters);
  $('generate-report').addEventListener('click', onGenerate);
  $('copy-json').addEventListener('click', () => onCopy('report-json', 'JSON'));
  $('copy-text').addEventListener('click', () => onCopy('report-text', 'text'));
  $('download-json').addEventListener('click', onDownload);

  renderAll();
  loadCampaign(); // auto-load on page open
}

init();
