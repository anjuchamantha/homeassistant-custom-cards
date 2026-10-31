const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('cards/solar-energy-flow-card/solar-energy-flow-card.js', 'utf8');
let Card;
const context = vm.createContext({ HTMLElement: class {
  attachShadow() {
    assert.equal(this.shadowRoot, undefined);
    const elements = new Map();
    this.shadowRoot = {
      innerHTML: '',
      querySelector: key => key === 'canvas' ? null : get(key),
      getElementById: key => get(key),
    };
    function get(key) {
      if (!elements.has(key)) elements.set(key, {});
      return elements.get(key);
    }
  }
}, customElements: { define: (_, value) => { Card = value; } }, window: {} });
vm.runInContext(source, context);
const config = { entities: { solar: 'sensor.solar', battery: 'sensor.battery', grid: 'sensor.grid', load: 'sensor.load' } };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('configuration can be repeated; dynamic strings are rendered as text', () => {
  const card = new Card();
  const title = '<img src=x onerror=alert(1)>';
  card.setConfig({ ...config, title });
  card.setConfig({ ...config, title });
  assert.equal(card.shadowRoot.querySelector('.title').textContent, title);
  assert.ok(!card.shadowRoot.innerHTML.includes(title));
  card.error = title;
  card.render();
  assert.equal(card.shadowRoot.querySelector('.error').textContent, title);
  assert.ok(!card.shadowRoot.innerHTML.includes(title));
  assert.throws(() => card.setConfig({ entities: {} }), /sensor entity IDs/);
});

test('minimal REST history uses the first state entity ID and skips unavailable values', async () => {
  const card = new Card(); card.setConfig(config);
  card.hass = { callApi: async () => [[
    { entity_id: 'sensor.solar', state: '12', last_changed: '2026-10-01T00:00:00Z' },
    { state: '34', last_changed: '2026-10-01T01:00:00Z' },
    { state: 'unavailable', last_changed: '2026-10-01T02:00:00Z' },
    { state: '', last_changed: '2026-10-01T03:00:00Z' },
    { state: '1', last_changed: 'invalid' },
  ]] };
  await flush();
  assert.equal(card.values('solar').length, 2);
  assert.equal(card.values('solar')[1].v, 34);
  assert.equal(card.values('grid').length, 0);
});

test('requests span local midnight to next midnight, including DST', async () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 2, 8, 12)', context);
  let request;
  card.hass = { callApi: async (_, path) => { request = path; return []; } };
  await flush();
  const [path, query] = request.split('?');
  const start = new Date(decodeURIComponent(path.slice('history/period/'.length)));
  const end = new Date(new URLSearchParams(query).get('end_time'));
  assert.equal(start.getHours(), 0); assert.equal(end.getHours(), 0);
  assert.equal(end.getDate(), start.getDate() + 1);
  assert.equal((end - start) / 3600000, process.env.TZ === 'America/New_York' ? 23 : 24);
});

test('only the newest request may update the card; in-flight hass updates do not duplicate requests', async () => {
  const card = new Card(); card.setConfig(config);
  const pending = [];
  const hass = { callApi: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  card.hass = hass; card.hass = hass;
  assert.equal(pending.length, 1);
  const second = card.load();
  pending[1].resolve([[{ entity_id: 'sensor.solar', state: '42', last_changed: '2026-01-01' }]]);
  await second;
  pending[0].reject(new Error('stale error')); await flush();
  assert.equal(card.error, ''); assert.equal(card.values('solar')[0].v, 42);
  assert.equal(card.loading, false);
});

test('failures do not retry on every hass update; explicit reload recovers', async () => {
  const card = new Card(); card.setConfig(config);
  let calls = 0;
  const hass = { callApi: async () => { calls++; throw new Error('offline'); } };
  card.hass = hass; await flush(); card.hass = hass;
  assert.equal(calls, 1); assert.match(card.error, /offline/);
  card._hass = { callApi: async () => [] }; await card.load();
  assert.equal(card.ready, true); assert.equal(card.error, '');
});

test('HACS distribution matches source', () => {
  assert.equal(fs.readFileSync('dist/solar-energy-flow-card.js', 'utf8'), source);
});
