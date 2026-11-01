// Roster text format, per-gang storage and import/export. DOM-free.
// Storage objects follow the Web Storage interface: length, key(i), getItem, setItem.

export const ROSTER_KEY_PREFIX = 'necroresult.roster.';
export const EXPORT_APP = 'NecroResult';
export const EXPORT_VERSION = 1;

/** Merge fighters: names case-insensitively (first spelling wins), weapons deduped case-insensitively. */
function mergeFighters(entries) {
  const byName = new Map();
  const out = [];
  for (const { name, weapons } of entries) {
    const n = String(name).trim();
    if (!n) continue;
    let fighter = byName.get(n.toLowerCase());
    if (!fighter) {
      fighter = { name: n, weapons: [], seen: new Set() };
      byName.set(n.toLowerCase(), fighter);
      out.push(fighter);
    }
    for (const w of weapons) {
      const wn = String(w).trim();
      if (!wn || fighter.seen.has(wn.toLowerCase())) continue;
      fighter.seen.add(wn.toLowerCase());
      fighter.weapons.push(wn);
    }
  }
  return out.map(({ name, weapons }) => ({ name, weapons }));
}

/** Parse `Name: weapon1, weapon2` lines into `[{name, weapons}]`. */
export function parseRosterText(text) {
  const entries = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    const name = (colon === -1 ? line : line.slice(0, colon)).trim();
    const weapons = colon === -1 ? [] : line.slice(colon + 1).split(',');
    entries.push({ name, weapons });
  }
  return mergeFighters(entries);
}

export function rosterToText(fighters) {
  return (fighters ?? [])
    .map((f) => (f.weapons && f.weapons.length ? `${f.name}: ${f.weapons.join(', ')}` : f.name))
    .join('\n');
}

function isValidFighter(f) {
  return (
    f !== null &&
    typeof f === 'object' &&
    typeof f.name === 'string' &&
    f.name.trim() !== '' &&
    Array.isArray(f.weapons) &&
    f.weapons.every((w) => typeof w === 'string')
  );
}

function isValidEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    (entry.gangName === undefined || typeof entry.gangName === 'string') &&
    Array.isArray(entry.fighters) &&
    entry.fighters.every(isValidFighter)
  );
}

export function loadRoster(storage, gangId) {
  let raw;
  try {
    raw = storage.getItem(ROSTER_KEY_PREFIX + gangId);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  try {
    const entry = JSON.parse(raw);
    if (!isValidEntry(entry)) return null;
    return { gangName: entry.gangName ?? '', fighters: mergeFighters(entry.fighters) };
  } catch {
    return null;
  }
}

export function saveRoster(storage, gangId, gangName, fighters) {
  storage.setItem(ROSTER_KEY_PREFIX + gangId, JSON.stringify({ gangName: gangName ?? '', fighters: fighters ?? [] }));
}

export function exportRosters(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (typeof key === 'string' && key.startsWith(ROSTER_KEY_PREFIX)) keys.push(key);
  }
  keys.sort();
  const rosters = {};
  for (const key of keys) {
    const gangId = key.slice(ROSTER_KEY_PREFIX.length);
    const entry = loadRoster(storage, gangId);
    if (gangId && entry) rosters[gangId] = entry;
  }
  return { app: EXPORT_APP, version: EXPORT_VERSION, rosters };
}

/** Validate an export file's text. Returns `{gangId: {gangName, fighters}}` or throws. Writes nothing. */
export function parseRosterImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Import failed: the file is not valid JSON');
  }
  if (!data || typeof data !== 'object' || data.app !== EXPORT_APP) {
    throw new Error('Import failed: not a NecroResult roster export');
  }
  if (data.version !== EXPORT_VERSION) {
    throw new Error(`Import failed: unsupported export version ${JSON.stringify(data.version)} (expected ${EXPORT_VERSION})`);
  }
  if (!data.rosters || typeof data.rosters !== 'object' || Array.isArray(data.rosters)) {
    throw new Error('Import failed: "rosters" must be an object');
  }
  const result = {};
  for (const [gangId, entry] of Object.entries(data.rosters)) {
    if (!gangId.trim()) throw new Error('Import failed: empty gang id');
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.fighters)) {
      throw new Error(`Import failed: roster for gang ${gangId} has no "fighters" array`);
    }
    if (entry.gangName !== undefined && typeof entry.gangName !== 'string') {
      throw new Error(`Import failed: roster for gang ${gangId} has an invalid "gangName"`);
    }
    entry.fighters.forEach((f, i) => {
      if (!isValidFighter(f)) {
        throw new Error(
          `Import failed: fighter ${i + 1} of gang ${entry.gangName || gangId} must be {name: non-empty text, weapons: list of text}`,
        );
      }
    });
    result[gangId] = { gangName: entry.gangName ?? '', fighters: mergeFighters(entry.fighters) };
  }
  return result;
}

/** Parse fully, then write every roster. Returns the number of rosters imported. */
export function importRosters(storage, text) {
  const rosters = parseRosterImport(text);
  for (const [gangId, { gangName, fighters }] of Object.entries(rosters)) {
    saveRoster(storage, gangId, gangName, fighters);
  }
  return Object.keys(rosters).length;
}

/** API fighters when present, else the stored roster, else []. */
export function getGangFighters(gang, storage) {
  if (Array.isArray(gang?.fighters) && gang.fighters.length > 0) return gang.fighters;
  return loadRoster(storage, gang?.id)?.fighters ?? [];
}
