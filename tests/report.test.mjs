import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, fighterKey, isValidXp, reportToText, validateDraft } from '../js/report.js';

const G1 = '93766ae9-11cd-4943-8640-1f306cde9f9e';
const G2 = 'd08c7d02-c5c3-420d-a621-a5e19c2d4807';
const campaign = { id: 'd6abc5f8-0fdc-42cd-b040-70472106bc3a', name: 'Rebelia w Gnieździe Myszy', type: 'Uprising Campaign', gangs: [] };
const context = {
  gangs: [
    { id: G1, name: 'Ściągacze Długów', type: 'House Delaque', owner: 'Sir_Spaghetti', fighters: [{ name: 'Bob', weapons: ['Lasgun', 'Knife'] }, { name: 'Łukasz', weapons: [] }] },
    { id: G2, name: 'SIEĆ', type: 'House Van Saar', owner: 'KrytyK', fighters: [{ name: 'Joe', weapons: ['Autopistol'] }] },
  ],
};
const BOB = fighterKey(G1, 'Bob');
const LUK = fighterKey(G1, 'Łukasz');
const JOE = fighterKey(G2, 'Joe');

function draft(overrides = {}) {
  return {
    campaignInput: campaign.id,
    selectedGangIds: [G1, G2],
    casualties: [{ attackerKey: BOB, weapon: 'Lasgun', victimKey: JOE, result: 'Out of action', xp: '2' }],
    specialActions: [{ fighterKey: BOB, action: 'Rally', xp: '1' }],
    ...overrides,
  };
}
const cas = (o) => ({ attackerKey: BOB, weapon: 'Lasgun', victimKey: JOE, result: 'Out of action', xp: '2', ...o });
const act = (o) => ({ fighterKey: BOB, action: 'Rally', xp: '1', ...o });

test('fighterKey', () => {
  assert.equal(fighterKey('g', 'Bob'), 'g::Bob');
});

test('valid drafts produce no errors', () => {
  assert.deepEqual(validateDraft(draft(), context), []);
  assert.deepEqual(validateDraft(draft({ casualties: [], specialActions: [] }), context), []);
  assert.deepEqual(validateDraft(draft({ casualties: [cas({ attackerKey: LUK, weapon: 'Unarmed', xp: 0 })] }), context), []);
  assert.deepEqual(validateDraft(draft({ selectedGangIds: [G1], casualties: [cas({ victimKey: LUK, weapon: 'Knife', result: 'Seriously injured' })] }), {
    gangs: [context.gangs[0]],
  }), []);
});

test('gang selection count', () => {
  assert.deepEqual(validateDraft(draft({ selectedGangIds: [], casualties: [], specialActions: [] }), { gangs: [] }), ['Select between 1 and 2 gangs']);
  assert.deepEqual(validateDraft(draft({ selectedGangIds: [G1, G2, 'x'] }), context), ['Select between 1 and 2 gangs']);
});

test('casualty errors', () => {
  const one = (row) => validateDraft(draft({ casualties: [cas(), row], specialActions: [] }), context);
  assert.deepEqual(one(cas({ attackerKey: '', weapon: '' })), ['Casualty row 2: attacker is missing', 'Casualty row 2: weapon is missing']);
  assert.deepEqual(one(cas({ attackerKey: fighterKey(G1, 'Ghost') })), ["Casualty row 2: attacker is no longer in the selected gangs' rosters"]);
  assert.deepEqual(one(cas({ weapon: '' })), ['Casualty row 2: weapon is missing']);
  assert.deepEqual(one(cas({ weapon: 'Autopistol' })), ['Casualty row 2: Bob does not have the weapon "Autopistol"']);
  assert.deepEqual(one(cas({ victimKey: '' })), ['Casualty row 2: victim is missing']);
  assert.deepEqual(one(cas({ victimKey: fighterKey(G2, 'Gone') })), ["Casualty row 2: victim is no longer in the selected gangs' rosters"]);
  assert.deepEqual(one(cas({ victimKey: BOB })), ['Casualty row 2: victim cannot be the attacker']);
  assert.deepEqual(one(cas({ result: '' })), ['Casualty row 2: result is missing']);
  assert.deepEqual(one(cas({ result: 'Dead' })), ['Casualty row 2: result "Dead" is not allowed']);
  assert.deepEqual(one(cas({ xp: '-1' })), ['Casualty row 2: XP must be a whole number ≥ 0']);
});

test('stale references after a gang is deselected', () => {
  const ctx = { gangs: [context.gangs[0]] };
  assert.deepEqual(validateDraft(draft({ selectedGangIds: [G1], specialActions: [act({ fighterKey: JOE })] }), ctx), [
    "Casualty row 1: victim is no longer in the selected gangs' rosters",
    "Special action row 1: fighter is no longer in the selected gangs' rosters",
  ]);
});

test('special action errors', () => {
  const one = (row) => validateDraft(draft({ casualties: [], specialActions: [row] }), context);
  assert.deepEqual(one(act({ fighterKey: '' })), ['Special action row 1: fighter is missing']);
  assert.deepEqual(one(act({ action: '' })), ['Special action row 1: action is missing']);
  assert.deepEqual(one(act({ action: 'Dance' })), ['Special action row 1: action "Dance" is not allowed']);
  assert.deepEqual(one(act({ xp: 'abc' })), ['Special action row 1: XP must be a whole number ≥ 0']);
});

test('xp edge cases', () => {
  for (const bad of ['', '-1', '1.5', 'abc', ' ', -1, 1.5, NaN, null, undefined]) {
    assert.equal(isValidXp(bad), false, String(bad));
    assert.deepEqual(validateDraft(draft({ casualties: [], specialActions: [act({ xp: bad })] }), context), [
      'Special action row 1: XP must be a whole number ≥ 0',
    ]);
  }
  for (const good of ['0', '3', ' 3 ', '12', 0, 3]) {
    assert.equal(isValidXp(good), true, String(good));
    assert.deepEqual(validateDraft(draft({ casualties: [], specialActions: [act({ xp: good })] }), context), []);
  }
});

const NOW = new Date('2026-11-01T12:34:56.000Z');

test('buildReport exact output', () => {
  const report = buildReport(
    campaign,
    draft({
      casualties: [cas(), cas({ attackerKey: JOE, weapon: 'Unarmed', victimKey: LUK, result: 'Seriously injured', xp: '0' })],
    }),
    context,
    NOW,
  );
  assert.deepEqual(report, {
    schemaVersion: 1,
    generatedAt: '2026-11-01T12:34:56.000Z',
    campaign: {
      id: 'd6abc5f8-0fdc-42cd-b040-70472106bc3a',
      name: 'Rebelia w Gnieździe Myszy',
      url: 'https://www.mundamanager.com/campaigns/d6abc5f8-0fdc-42cd-b040-70472106bc3a',
    },
    gangs: [
      { id: G1, name: 'Ściągacze Długów', type: 'House Delaque', owner: 'Sir_Spaghetti' },
      { id: G2, name: 'SIEĆ', type: 'House Van Saar', owner: 'KrytyK' },
    ],
    casualties: [
      {
        attacker: { gangId: G1, gangName: 'Ściągacze Długów', fighter: 'Bob' },
        weapon: 'Lasgun',
        victim: { gangId: G2, gangName: 'SIEĆ', fighter: 'Joe' },
        result: 'Out of action',
        xp: 2,
      },
      {
        attacker: { gangId: G2, gangName: 'SIEĆ', fighter: 'Joe' },
        weapon: 'Unarmed',
        victim: { gangId: G1, gangName: 'Ściągacze Długów', fighter: 'Łukasz' },
        result: 'Seriously injured',
        xp: 0,
      },
    ],
    specialActions: [{ fighter: { gangId: G1, gangName: 'Ściągacze Długów', fighter: 'Bob' }, action: 'Rally', xp: 1 }],
  });
  // JSON serialization keeps Polish characters intact
  assert.ok(JSON.stringify(report).includes('Ściągacze Długów'));
  assert.ok(JSON.stringify(report).includes('SIEĆ'));
});

test('buildReport throws on an invalid draft', () => {
  assert.throws(() => buildReport(campaign, draft({ casualties: [cas({ victimKey: '' })] }), context, NOW), /victim is missing/);
});

test('reportToText', () => {
  const text = reportToText(buildReport(campaign, draft(), context, NOW));
  const lines = text.split('\n');
  assert.ok(lines.includes('Battle report — Rebelia w Gnieździe Myszy'));
  assert.ok(lines.includes('Date: 2026-11-01'));
  assert.ok(lines.includes('Gangs: Ściągacze Długów (House Delaque, Sir_Spaghetti) vs SIEĆ (House Van Saar, KrytyK)'));
  assert.ok(lines.includes('Casualties:'));
  assert.ok(lines.includes('- Bob [Ściągacze Długów] with Lasgun → Joe [SIEĆ]: Out of action (+2 XP)'));
  assert.ok(lines.includes('Special actions:'));
  assert.ok(lines.includes('- Bob [Ściągacze Długów]: Rally (+1 XP)'));
  assert.ok(!text.includes('(none)'));

  const empty = reportToText(buildReport(campaign, draft({ casualties: [], specialActions: [] }), context, NOW));
  const el = empty.split('\n');
  assert.equal(el[el.indexOf('Casualties:') + 1], '(none)');
  assert.equal(el[el.indexOf('Special actions:') + 1], '(none)');
});
