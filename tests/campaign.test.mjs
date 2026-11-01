import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDataUrl, fetchCampaign, normalizeCampaign, parseCampaignId } from '../js/campaign.js';

const ID = 'd6abc5f8-0fdc-42cd-b040-70472106bc3a';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/campaign.json', import.meta.url), 'utf8'));
const INVALID = /^Error: Not a valid Munda Manager campaign link or ID$/;

test('parseCampaignId accepts supported inputs', () => {
  const accepted = [
    ID,
    `  ${ID}  `,
    ID.toUpperCase(),
    `https://www.mundamanager.com/campaigns/${ID}`,
    `https://www.mundamanager.com/campaigns/${ID}/`,
    `https://www.mundamanager.com/campaigns/${ID}?tab=gangs`,
    `https://www.mundamanager.com/campaigns/${ID}#battles`,
    `https://www.mundamanager.com/campaigns/${ID}/?x=1#y`,
    `https://www.mundamanager.com/campaigns/${ID.toUpperCase()}`,
    `https://www.mundamanager.com/api/campaigns/${ID}/data?format=xml`,
    `https://www.mundamanager.com/api/campaigns/${ID}/data?format=json`,
    `www.mundamanager.com/campaigns/${ID}`,
  ];
  for (const input of accepted) assert.equal(parseCampaignId(input), ID, input);
});

test('parseCampaignId rejects everything else', () => {
  const rejected = [
    '',
    '   ',
    'hello',
    'd6abc5f8-0fdc-42cd-b040',
    `${ID}x`,
    `https://www.mundamanager.com/gang/${ID}`,
    `https://www.mundamanager.com/gang/${ID}?campaigns/`,
    `https://www.mundamanager.com/campaigns/`,
    `https://www.mundamanager.com/campaigns/${ID}extra`,
    `https://example.com/campaigns/${ID}`,
    `ftp://www.mundamanager.com/campaigns/${ID}`,
    undefined,
    null,
  ];
  for (const input of rejected) assert.throws(() => parseCampaignId(input), INVALID, String(input));
});

test('buildDataUrl', () => {
  assert.equal(buildDataUrl(ID), `https://www.mundamanager.com/api/campaigns/${ID}/data?format=json`);
});

test('normalizeCampaign on the real fixture', () => {
  const c = normalizeCampaign(fixture);
  assert.equal(c.id, ID);
  assert.equal(c.name, 'Rebelia w Gnieździe Myszy');
  assert.equal(c.type, 'Uprising Campaign');
  assert.equal(c.gangs.length, 5);
  const g = c.gangs.find((x) => x.id === '93766ae9-11cd-4943-8640-1f306cde9f9e');
  assert.ok(g);
  assert.deepEqual(g, {
    id: '93766ae9-11cd-4943-8640-1f306cde9f9e',
    name: 'Ściągacze Długów',
    type: 'House Delaque',
    colour: '#ec0404',
    owner: 'Sir_Spaghetti',
    status: 'ACCEPTED',
    fighters: null,
  });
  assert.ok(c.gangs.some((x) => x.name === 'SIEĆ'));
  for (const gang of c.gangs) assert.equal(gang.fighters, null);
});

test('normalizeCampaign tolerates missing members/gangs', () => {
  assert.deepEqual(normalizeCampaign({ campaign: { id: 'x', campaign_name: 'N' } }).gangs, []);
  assert.deepEqual(normalizeCampaign({ campaign: { id: 'x' }, members: [{ user_info: { username: 'a' } }, null] }).gangs, []);
  assert.throws(() => normalizeCampaign({ members: [] }), /^Error: Unexpected campaign data format$/);
  assert.throws(() => normalizeCampaign(null), /Unexpected campaign data format/);
});

test('normalizeCampaign uses a fighters array when present', () => {
  const c = normalizeCampaign({
    campaign: { id: 'c', campaign_name: 'C' },
    members: [
      {
        user_info: { username: 'u' },
        gangs: [
          {
            id: 'g1',
            name: 'G',
            type: 'T',
            colour: '#fff',
            status: 'ACCEPTED',
            fighters: [
              { fighter_name: 'Bob', name: 'ignored', weapons: [{ weapon_name: 'Lasgun' }, { equipment_name: 'Knife' }] },
              { name: 'Joe', weapons: ['Autopistol', { name: 'Club' }, { name: 'club' }, ''] },
              { name: 'Ann' },
              { weapons: ['nameless'] },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(c.gangs[0].fighters, [
    { name: 'Bob', weapons: ['Lasgun', 'Knife'] },
    { name: 'Joe', weapons: ['Autopistol', 'Club'] },
    { name: 'Ann', weapons: [] },
  ]);
});

function fakeFetch({ status = 200, body = '', reject = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (reject) throw new TypeError('Failed to fetch');
    return new Response(body, { status });
  };
  return { impl, calls };
}

test('fetchCampaign success', async () => {
  const { impl, calls } = fakeFetch({ body: JSON.stringify(fixture) });
  const c = await fetchCampaign(`https://www.mundamanager.com/campaigns/${ID}/`, impl);
  assert.deepEqual(calls, [`https://www.mundamanager.com/api/campaigns/${ID}/data?format=json`]);
  assert.equal(c.gangs.length, 5);
});

test('fetchCampaign error messages', async () => {
  const cases = [
    [{ status: 404, body: '{"error":"Campaign not found"}' }, 'Campaign not found (check the link)'],
    [{ status: 429, body: '' }, 'Munda Manager rate limit hit (10 requests/min) — wait a minute and retry'],
    [{ status: 500, body: 'oops' }, 'Server error: HTTP 500'],
    [{ reject: true }, 'Network error — could not reach Munda Manager'],
    [{ status: 200, body: '<html>not json' }, 'Invalid data received from Munda Manager'],
  ];
  for (const [opts, message] of cases) {
    const { impl } = fakeFetch(opts);
    await assert.rejects(fetchCampaign(ID, impl), (err) => err instanceof Error && err.message === message);
  }
});

test('fetchCampaign rejects an invalid link without fetching', async () => {
  const { impl, calls } = fakeFetch({ body: '{}' });
  await assert.rejects(fetchCampaign('nope', impl), INVALID);
  assert.equal(calls.length, 0);
});
