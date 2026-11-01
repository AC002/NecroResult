// Draft validation and battle report generation. DOM-free.
import { CAMPAIGN_PAGE_BASE, CASUALTY_RESULTS, MAX_GANGS, SPECIAL_ACTIONS, UNARMED } from './config.js';

export const SCHEMA_VERSION = 1;
const XP_ERROR = 'XP must be a whole number ≥ 0';

export function fighterKey(gangId, fighterName) {
  return gangId + '::' + fighterName;
}

export function isValidXp(xp) {
  if (typeof xp === 'number') return Number.isInteger(xp) && xp >= 0;
  if (typeof xp === 'string') return /^\d+$/.test(xp.trim());
  return false;
}

function xpToNumber(xp) {
  return typeof xp === 'number' ? xp : Number(xp.trim());
}

/** Map fighterKey → {gang, fighter} for the context's gangs. */
export function buildFighterIndex(context) {
  const index = new Map();
  for (const gang of context?.gangs ?? []) {
    for (const fighter of gang.fighters ?? []) {
      index.set(fighterKey(gang.id, fighter.name), { gang, fighter });
    }
  }
  return index;
}

/** Returns a list of human-readable errors; empty means the draft is valid. */
export function validateDraft(draft, context) {
  const errors = [];
  const index = buildFighterIndex(context);
  const selected = Array.isArray(draft?.selectedGangIds) ? draft.selectedGangIds : [];
  if (selected.length < 1 || selected.length > MAX_GANGS) {
    errors.push(`Select between 1 and ${MAX_GANGS} gangs`);
  }

  (draft?.casualties ?? []).forEach((row, i) => {
    const p = `Casualty row ${i + 1}`;
    const attacker = row?.attackerKey ? index.get(row.attackerKey) : undefined;
    if (!row?.attackerKey) errors.push(`${p}: attacker is missing`);
    else if (!attacker) errors.push(`${p}: attacker is no longer in the selected gangs' rosters`);

    if (!row?.weapon) errors.push(`${p}: weapon is missing`);
    else if (attacker && row.weapon !== UNARMED && !attacker.fighter.weapons.includes(row.weapon)) {
      errors.push(`${p}: ${attacker.fighter.name} does not have the weapon "${row.weapon}"`);
    }

    if (!row?.victimKey) errors.push(`${p}: victim is missing`);
    else if (!index.has(row.victimKey)) errors.push(`${p}: victim is no longer in the selected gangs' rosters`);
    else if (row.victimKey === row.attackerKey) errors.push(`${p}: victim cannot be the attacker`);

    if (!row?.result) errors.push(`${p}: result is missing`);
    else if (!CASUALTY_RESULTS.includes(row.result)) errors.push(`${p}: result "${row.result}" is not allowed`);

    if (!isValidXp(row?.xp)) errors.push(`${p}: ${XP_ERROR}`);
  });

  (draft?.specialActions ?? []).forEach((row, i) => {
    const p = `Special action row ${i + 1}`;
    if (!row?.fighterKey) errors.push(`${p}: fighter is missing`);
    else if (!index.has(row.fighterKey)) errors.push(`${p}: fighter is no longer in the selected gangs' rosters`);

    if (!row?.action) errors.push(`${p}: action is missing`);
    else if (!SPECIAL_ACTIONS.includes(row.action)) errors.push(`${p}: action "${row.action}" is not allowed`);

    if (!isValidXp(row?.xp)) errors.push(`${p}: ${XP_ERROR}`);
  });

  return errors;
}

function fighterRef(index, key) {
  const { gang, fighter } = index.get(key);
  return { gangId: gang.id, gangName: gang.name, fighter: fighter.name };
}

/** Build the report object. Throws if the draft does not validate. */
export function buildReport(campaign, draft, context, now = new Date()) {
  const errors = validateDraft(draft, context);
  if (errors.length) throw new Error('Cannot build report: ' + errors.join('; '));
  const index = buildFighterIndex(context);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    campaign: { id: campaign.id, name: campaign.name, url: CAMPAIGN_PAGE_BASE + campaign.id },
    gangs: context.gangs.map((g) => ({ id: g.id, name: g.name, type: g.type, owner: g.owner })),
    casualties: draft.casualties.map((row) => ({
      attacker: fighterRef(index, row.attackerKey),
      weapon: row.weapon,
      victim: fighterRef(index, row.victimKey),
      result: row.result,
      xp: xpToNumber(row.xp),
    })),
    specialActions: draft.specialActions.map((row) => ({
      fighter: fighterRef(index, row.fighterKey),
      action: row.action,
      xp: xpToNumber(row.xp),
    })),
  };
}

const who = (ref) => `${ref.fighter} [${ref.gangName}]`;

/** Plain-text summary of a report. */
export function reportToText(report) {
  const lines = [];
  lines.push(`Battle report — ${report.campaign.name}`);
  lines.push(`Date: ${report.generatedAt.slice(0, 10)}`);
  lines.push(
    `Gangs: ${report.gangs
      .map((g) => {
        const extra = [g.type, g.owner].filter(Boolean).join(', ');
        return extra ? `${g.name} (${extra})` : g.name;
      })
      .join(' vs ')}`,
  );
  lines.push('');
  lines.push('Casualties:');
  if (!report.casualties.length) lines.push('(none)');
  for (const c of report.casualties) {
    lines.push(`- ${who(c.attacker)} with ${c.weapon} → ${who(c.victim)}: ${c.result} (+${c.xp} XP)`);
  }
  lines.push('');
  lines.push('Special actions:');
  if (!report.specialActions.length) lines.push('(none)');
  for (const a of report.specialActions) {
    lines.push(`- ${who(a.fighter)}: ${a.action} (+${a.xp} XP)`);
  }
  return lines.join('\n') + '\n';
}
