import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportRosters,
  getGangFighters,
  importRosters,
  loadRoster,
  parseRosterImport,
  parseRosterText,
  rosterToText,
  saveRoster,
} from '../js/roster.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

test('parseRosterText rules', () => {
  const text = [
    '# comment line',
    '',
    '   ',
    '  Bob :  Lasgun , Fighting knife,, lasgun ',
    'Joe',
    'Ann: ',
    'bob: Autopistol, LASGUN',
    'Zed: Plasma gun: overcharged, Club',
    ': nameless',
    '\tKat:Stub gun\r',
  ].join('\n');
  assert.deepEqual(parseRosterText(text), [
    { name: 'Bob', weapons: ['Lasgun', 'Fighting knife', 'Autopistol'] },
    { name: 'Joe', weapons: [] },
    { name: 'Ann', weapons: [] },
    { name: 'Zed', weapons: ['Plasma gun: overcharged', 'Club'] },
    { name: 'Kat', weapons: ['Stub gun'] },
  ]);
  assert.deepEqual(parseRosterText(''), []);
  assert.deepEqual(parseRosterText('# only\n\n'), []);
});

test('parseRosterText handles Windows line endings and Polish names', () => {
  assert.deepEqual(parseRosterText('Źdźbło: Łańcuch\r\nŚwięty\r\n'), [
    { name: 'Źdźbło', weapons: ['Łańcuch'] },
    { name: 'Święty', weapons: [] },
  ]);
});

test('rosterToText round-trips', () => {
  const fighters = [
    { name: 'Bob', weapons: ['Lasgun', 'Fighting knife'] },
    { name: 'Joe', weapons: [] },
    { name: 'Żaba', weapons: ['Autopistol'] },
  ];
  const text = rosterToText(fighters);
  assert.equal(text, 'Bob: Lasgun, Fighting knife\nJoe\nŻaba: Autopistol');
  assert.deepEqual(parseRosterText(text), fighters);
  assert.equal(rosterToText([]), '');
});

test('save/load roster in storage', () => {
  const s = memoryStorage();
  assert.equal(loadRoster(s, 'g1'), null);
  const fighters = [{ name: 'Bob', weapons: ['Lasgun'] }];
  saveRoster(s, 'g1', 'Ściągacze Długów', fighters);
  assert.ok(s.getItem('necroresult.roster.g1'));
  assert.deepEqual(loadRoster(s, 'g1'), { gangName: 'Ściągacze Długów', fighters });
});

test('loadRoster returns null for corrupt values', () => {
  const s = memoryStorage({
    'necroresult.roster.a': '{not json',
    'necroresult.roster.b': '{"gangName":"x","fighters":"nope"}',
    'necroresult.roster.c': '{"fighters":[{"name":"","weapons":[]}]}',
    'necroresult.roster.d': 'null',
  });
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(loadRoster(s, id), null, id);
});

test('exportRosters collects only roster keys', () => {
  const s = memoryStorage({ 'necroresult.draft': '{}', other: 'x', 'necroresult.roster.bad': '{oops' });
  saveRoster(s, 'g2', 'SIEĆ', [{ name: 'Joe', weapons: [] }]);
  saveRoster(s, 'g1', 'A', [{ name: 'Bob', weapons: ['Lasgun'] }]);
  assert.deepEqual(exportRosters(s), {
    app: 'NecroResult',
    version: 1,
    rosters: {
      g1: { gangName: 'A', fighters: [{ name: 'Bob', weapons: ['Lasgun'] }] },
      g2: { gangName: 'SIEĆ', fighters: [{ name: 'Joe', weapons: [] }] },
    },
  });
});

test('export → import round-trip', () => {
  const a = memoryStorage();
  saveRoster(a, 'g1', 'SIEĆ', [{ name: 'Bob', weapons: ['Lasgun'] }]);
  const text = JSON.stringify(exportRosters(a));
  assert.deepEqual(parseRosterImport(text), {
    g1: { gangName: 'SIEĆ', fighters: [{ name: 'Bob', weapons: ['Lasgun'] }] },
  });
  const b = memoryStorage();
  assert.equal(importRosters(b, text), 1);
  assert.deepEqual(loadRoster(b, 'g1'), { gangName: 'SIEĆ', fighters: [{ name: 'Bob', weapons: ['Lasgun'] }] });
});

test('parseRosterImport rejects bad input and import writes nothing', () => {
  const ok = { app: 'NecroResult', version: 1, rosters: {} };
  const bad = [
    ['{not json', /not valid JSON/],
    ['[]', /not a NecroResult roster export/],
    [JSON.stringify({ ...ok, app: 'Other' }), /not a NecroResult roster export/],
    [JSON.stringify({ ...ok, version: 2 }), /unsupported export version 2/],
    [JSON.stringify({ app: 'NecroResult', rosters: {} }), /unsupported export version/],
    [JSON.stringify({ ...ok, rosters: [] }), /"rosters" must be an object/],
    [JSON.stringify({ ...ok, rosters: { g: { gangName: 'G' } } }), /no "fighters" array/],
    [JSON.stringify({ ...ok, rosters: { g: { gangName: 'G', fighters: [{ name: '', weapons: [] }] } } }), /fighter 1/],
    [JSON.stringify({ ...ok, rosters: { g: { gangName: 'G', fighters: [{ name: 'Bob' }] } } }), /fighter 1/],
    [JSON.stringify({ ...ok, rosters: { g: { gangName: 'G', fighters: [{ name: 'Bob', weapons: [1] }] } } }), /fighter 1/],
    [JSON.stringify({ ...ok, rosters: { g: { gangName: 5, fighters: [] } } }), /invalid "gangName"/],
  ];
  for (const [text, re] of bad) assert.throws(() => parseRosterImport(text), re, text);

  // first gang valid, second invalid: nothing must be written
  const s = memoryStorage();
  saveRoster(s, 'g1', 'Old', [{ name: 'Keep', weapons: [] }]);
  const before = JSON.stringify(s.dump());
  const mixed = JSON.stringify({
    ...ok,
    rosters: {
      g1: { gangName: 'New', fighters: [{ name: 'Replace', weapons: [] }] },
      g2: { gangName: 'Bad', fighters: [{ name: 'X', weapons: 'Lasgun' }] },
    },
  });
  assert.throws(() => importRosters(s, mixed), /fighter 1 of gang Bad/);
  assert.equal(JSON.stringify(s.dump()), before);
});

test('getGangFighters prefers API fighters, then storage, then []', () => {
  const s = memoryStorage();
  saveRoster(s, 'g1', 'G', [{ name: 'Stored', weapons: [] }]);
  const api = [{ name: 'Api', weapons: ['Lasgun'] }];
  assert.deepEqual(getGangFighters({ id: 'g1', fighters: api }, s), api);
  assert.deepEqual(getGangFighters({ id: 'g1', fighters: [] }, s), [{ name: 'Stored', weapons: [] }]);
  assert.deepEqual(getGangFighters({ id: 'g1', fighters: null }, s), [{ name: 'Stored', weapons: [] }]);
  assert.deepEqual(getGangFighters({ id: 'g2', fighters: null }, s), []);
});
