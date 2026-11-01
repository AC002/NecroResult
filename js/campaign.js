// Campaign link parsing, fetching and normalization. DOM-free.
import { API_BASE } from './config.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_UUID_RE = new RegExp(`^${UUID}$`, 'i');
// The UUID must directly follow a `campaigns/` path segment and end the segment.
const CAMPAIGN_PATH_RE = new RegExp(`(?:^|/)campaigns/(${UUID})(?=[/?#]|$)`, 'i');
const INVALID_ID_MESSAGE = 'Not a valid Munda Manager campaign link or ID';

/** Extract a lowercase campaign UUID from a campaign URL, API data URL or bare UUID. */
export function parseCampaignId(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || /\s/.test(text)) throw new Error(INVALID_ID_MESSAGE);
  if (BARE_UUID_RE.test(text)) return text.toLowerCase();

  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    // Full URL: must be http(s) on a mundamanager.com host.
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error(INVALID_ID_MESSAGE);
    }
    const hostOk = url.hostname === 'mundamanager.com' || url.hostname.endsWith('.mundamanager.com');
    if (!/^https?:$/.test(url.protocol) || !hostOk) throw new Error(INVALID_ID_MESSAGE);
    const m = url.pathname.match(CAMPAIGN_PATH_RE);
    if (!m) throw new Error(INVALID_ID_MESSAGE);
    return m[1].toLowerCase();
  }

  // Scheme-less link such as "www.mundamanager.com/campaigns/<id>".
  const m = text.match(CAMPAIGN_PATH_RE);
  if (!m) throw new Error(INVALID_ID_MESSAGE);
  return m[1].toLowerCase();
}

export function buildDataUrl(id) {
  return API_BASE + id + '/data?format=json';
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function weaponName(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.weapon_name ?? item.equipment_name ?? item.name ?? '';
  return '';
}

/** Adapter for a gang `fighters` array, should the API ever provide one. */
export function normalizeApiFighters(fighters) {
  if (!Array.isArray(fighters)) return null;
  const out = [];
  for (const f of fighters) {
    if (!f || typeof f !== 'object') continue;
    const name = str(f.fighter_name ?? f.name);
    if (!name) continue;
    const seen = new Set();
    const weapons = [];
    for (const w of Array.isArray(f.weapons) ? f.weapons : []) {
      const wn = str(weaponName(w));
      if (!wn || seen.has(wn.toLowerCase())) continue;
      seen.add(wn.toLowerCase());
      weapons.push(wn);
    }
    out.push({ name, weapons });
  }
  return out;
}

/** Convert the raw API response into `{id, name, type, gangs[]}`. */
export function normalizeCampaign(json) {
  if (!json || typeof json !== 'object' || !json.campaign || typeof json.campaign !== 'object') {
    throw new Error('Unexpected campaign data format');
  }
  const c = json.campaign;
  const gangs = [];
  const seen = new Set();
  for (const member of Array.isArray(json.members) ? json.members : []) {
    if (!member || typeof member !== 'object') continue;
    const owner = str(member.user_info?.username ?? member.username);
    for (const g of Array.isArray(member.gangs) ? member.gangs : []) {
      if (!g || typeof g !== 'object' || !g.id || seen.has(g.id)) continue;
      seen.add(g.id);
      gangs.push({
        id: str(g.id),
        name: str(g.name),
        type: str(g.type ?? g.gang_type),
        colour: str(g.colour),
        owner,
        status: str(g.status),
        fighters: normalizeApiFighters(g.fighters),
      });
    }
  }
  return {
    id: str(c.id),
    name: str(c.campaign_name ?? c.name),
    type: str(c.campaign_type_name),
    gangs,
  };
}

/** Fetch and normalize a campaign. Throws Errors with user-facing messages. */
export async function fetchCampaign(input, fetchImpl = globalThis.fetch) {
  const id = parseCampaignId(input);
  let res;
  try {
    res = await fetchImpl(buildDataUrl(id));
  } catch {
    throw new Error('Network error — could not reach Munda Manager');
  }
  if (res.status === 404) throw new Error('Campaign not found (check the link)');
  if (res.status === 429) throw new Error('Munda Manager rate limit hit (10 requests/min) — wait a minute and retry');
  if (!res.ok) throw new Error(`Server error: HTTP ${res.status}`);
  let json;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new Error('Invalid data received from Munda Manager');
  }
  return normalizeCampaign(json);
}
