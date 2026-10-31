const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync('cards/solar-energy-flow-card/solar-energy-flow-card.js', 'utf8');
let Card;
const context = vm.createContext({ HTMLElement: class {
  attachShadow() {
    assert.equal(this.shadowRoot, undefined);
    const elements = new Map();
    this.shadowRoot = {
      innerHTML: '',
      querySelector: key => ['#chart', '#brush'].includes(key) ? null : get(key),
      getElementById: key => get(key),
    };
    function get(key) {
      if (!elements.has(key)) elements.set(key, { querySelector: child => get(key + ' ' + child), setAttribute(name, value) { this[name] = value; } });
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
  assert.equal(card.shadowRoot.querySelector('.status').textContent, title);
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
  execFileSync(process.execPath, ['scripts/build.cjs', '--check']);
});


test('title is absent by default, empty or hidden; explicit titles remain supported', () => {
  const card = new Card();
  for (const extra of [{}, { title: '' }, { title: 'Hidden', header: { show: false } }]) {
    card.setConfig({ ...config, ...extra });
    assert.ok(!card.shadowRoot.innerHTML.includes('class="title"'));
  }
  card.setConfig({ ...config, header: { title: 'My chart', show: true } });
  assert.ok(card.shadowRoot.innerHTML.includes('class="title"'));
  assert.equal(card.shadowRoot.querySelector('.title').textContent, 'My chart');
});

test('Apex options preserve styles, tooltips, zero annotation, and isolated brush IDs', () => {
  const card = new Card();
  card.setConfig({ ...config, hours_12: false, apex_config: { chart: { height: 420 },
    annotations: { yaxis: [{ y: 500 }] } }, brush: { selection_span: '6h' } });
  const options = card.chartOptions();
  assert.equal(options.chart.height, 420);
  assert.equal(options.series[0].type, 'area');
  assert.equal(options.stroke.width[0], 1);
  assert.equal(options.stroke.curve[0], 'smooth');
  assert.equal(options.fill.opacity[0], 0.25);
  assert.equal(options.xaxis.labels.format, 'HH:mm');
  assert.equal(options.tooltip.shared, true);
  assert.equal(options.annotations.yaxis[1].y, 0);
  assert.equal(options.annotations.yaxis[1].strokeDashArray, 6);
  const brush = card.chartOptions(true);
  assert.equal(brush.series.length, 2);
  assert.equal(brush.chart.brush.target, options.chart.id);
  assert.notEqual(brush.chart.id, options.chart.id);
  assert.equal(brush.chart.selection.xaxis.max - brush.chart.selection.xaxis.min, 6 * 3600000);
  const another = new Card(); another.setConfig(config);
  assert.notEqual(another.chartId, card.chartId);
});

test('five-minute buckets align across series and preserve gaps and the end of recorded data', () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const start = card.bounds().start;
  card.history = [[
    { entity_id: 'sensor.solar', state: '10', last_changed: new Date(start).toISOString() },
    { state: '30', last_changed: new Date(start + 60000).toISOString() },
    { state: '50', last_changed: new Date(start + 600000).toISOString() },
  ]];
  const points = card.seriesData(card.series[0]);
  assert.equal(points[0][1], 20);
  assert.equal(points[1][1], null);
  assert.equal(points[2][1], 50);
  assert.equal(points[3][1], null);
  assert.equal(points.length, card.seriesData(card.series[1]).length);
});

test('series YAML supports overrides and raw gaps; invalid settings fail before requesting data', () => {
  const card = new Card();
  card.setConfig({ series: [{ entity: 'sensor.solar', name: 'PV', color: '#ffb300', type: 'area', opacity: 0.4 }],
    all_series_config: { stroke_width: 2, group_by: { duration: '10min' } }, experimental: { brush: false } });
  assert.equal(card.series[0].group_by.duration, '10min');
  assert.equal(card.chartOptions().stroke.width[0], 2);
  assert.ok(!card.shadowRoot.innerHTML.includes('id="brush"'));
  assert.throws(() => card.setConfig({ ...config, all_series_config: { group_by: { duration: '0min' } } }), /positive/);
  assert.throws(() => card.setConfig({ ...config, all_series_config: { group_by: { duration: '1ms' } } }), /10000/);
  assert.throws(() => card.setConfig({ ...config, series: [] }), /between/);
  assert.throws(() => card.setConfig({ series: [{ entity: 'sensor.solar', opacity: 2 }] }), /opacity/);
});

test('history cache is opt-in and reuses a response on explicit reload', async () => {
  const card = new Card(); card.setConfig({ ...config, cache: true });
  let calls = 0;
  card.hass = { callApi: async () => { calls++; return []; } };
  await flush(); await card.load();
  assert.equal(calls, 1);
  card.config.cache = false; await card.load();
  assert.equal(calls, 2);
});

test('group fill and extension are explicit, and raw mode preserves nulls', () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const start = card.bounds().start;
  card.history = [[
    { entity_id: 'sensor.solar', state: '10', last_changed: new Date(start).toISOString() },
    { state: 'unavailable', last_changed: new Date(start + 60000).toISOString() },
    { state: '30', last_changed: new Date(start + 600000).toISOString() },
  ]];
  const series = card.series[0];
  series.group_by.fill = 'last';
  assert.equal(card.seriesData(series)[1][1], 10);
  assert.equal(card.seriesData(series)[3][1], null);
  series.extend_to = 'end';
  assert.equal(card.seriesData(series).at(-1)[1], 30);
  assert.equal(card.seriesData(series).at(-1)[0], card.bounds().end);
  series.group_by.func = 'raw';
  assert.equal(card.seriesData(series)[1][1], null);
  assert.equal(card.seriesData(series).length, 3);
});


const summaryConfig = { ...config, summary: { entities: { solar: 'sensor.solar_energy' } } };
function energyFixture(card, values, unit = 'kWh') {
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const start = card.bounds().start;
  card.summaryRange = { start, end: start + 6 * 3600000 };
  card.summaryHistory = [values.map(([hour, state, attributes], index) => ({
    ...(index === 0 ? { entity_id: 'sensor.solar_energy' } : {}), state: String(state),
    last_updated: new Date(start + hour * 3600000).toISOString(),
    attributes: { unit_of_measurement: unit, ...attributes },
  }))];
  return start;
}

test('energy summary uses counter change for the visible range, not lifetime value', () => {
  const card = new Card(); card.setConfig(summaryConfig);
  const start = energyFixture(card, [[0, 100], [2, 102], [4, 104], [6, 106]]);
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, 6);
  card.updateSummary({ start: start + 2 * 3600000, end: start + 4 * 3600000 });
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, 2);
  assert.equal(card.shadowRoot.querySelector('[data-energy="solar"] .summary-value').textContent, '2.00 kWh');
});

test('energy units are converted and zero consumption stays distinct from missing readings', () => {
  const card = new Card(); card.setConfig(summaryConfig);
  energyFixture(card, [[0, 2000], [6, 3500]], 'Wh');
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, 1.5);
  energyFixture(card, [[0, 0.1], [6, 0.102]], 'MWh');
  assert.ok(Math.abs(card.energyTotal(card.summaryEntities[0]).value - 2) < 1e-8);
  energyFixture(card, [[0, 100]]);
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, 0);
  energyFixture(card, [[1, 100], [6, 101]]);
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, null);
  energyFixture(card, [[0, 100], [6, 'unavailable']]);
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, null);
  energyFixture(card, [[0, 100], [6, 106]], 'W');
  assert.match(card.energyTotal(card.summaryEntities[0]).reason, /unit/);
});

test('counter resets are reported, while net counters can decrease', () => {
  const card = new Card(); card.setConfig(summaryConfig);
  energyFixture(card, [[0, 100], [2, 105], [6, 2]]);
  assert.match(card.energyTotal(card.summaryEntities[0]).reason, /reset/);
  card.summaryEntities[0].mode = 'net';
  assert.equal(card.energyTotal(card.summaryEntities[0]).value, -98);
  energyFixture(card, [[0, 100, {last_reset:'2025-01-01'}], [6, 101, {last_reset:'2026-01-01'}]]);
  assert.match(card.energyTotal(card.summaryEntities[0]).reason, /reset/);
});

test('energy history failure does not prevent the power chart loading', async () => {
  const card = new Card(); card.setConfig(summaryConfig);
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const paths = [];
  card.hass = { callApi: async (_, path) => {
    paths.push(path);
    if (!path.includes('no_attributes=true')) throw new Error('energy offline');
    return [];
  } };
  await flush();
  assert.equal(card.ready, true);
  assert.equal(card.error, '');
  assert.match(card.summaryError, /energy offline/);
  assert.equal(paths.length, 2);
  assert.ok(paths.find(path => !path.includes('no_attributes=true')).includes('significant_changes_only=0'));
});

test('energy summary is opt-in, supports disabling, and validates sensor configuration', () => {
  const card = new Card(); card.setConfig(config);
  assert.equal(card.summaryEntities.length, 0);
  assert.ok(!card.shadowRoot.innerHTML.includes('class="energy-summary"'));
  card.setConfig({ ...summaryConfig, summary: { ...summaryConfig.summary, show: false } });
  assert.equal(card.summaryEntities.length, 0);
  assert.throws(() => card.setConfig({ ...config, summary: { show: true } }), /summary.entities/);
  assert.throws(() => card.setConfig({ ...summaryConfig, summary: { entities: { solar: 'switch.invalid' } } }), /sensor/);
  assert.throws(() => card.setConfig({ ...summaryConfig, summary: { entities: { solar: {entity:'sensor.energy', unit:'W'} } } }), /unit/);
});

test('stale energy history cannot overwrite the newly selected date', async () => {
  const card = new Card(); card.setConfig(summaryConfig);
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const pending = [];
  card.hass = { callApi: (_, path) => path.includes('no_attributes=true')
    ? Promise.resolve([]) : new Promise(resolve => pending.push(resolve)) };
  await flush();
  card.date = vm.runInContext('new Date(2026, 0, 2, 12)', context);
  const current = card.load(); await flush();
  pending[1]([[{ entity_id: 'sensor.solar_energy', state: '200', last_changed: '2026-01-02T00:00:00Z', attributes: {unit_of_measurement: 'kWh'} }]]);
  await current;
  pending[0]([[{ entity_id: 'sensor.solar_energy', state: '100', last_changed: '2026-01-01T00:00:00Z', attributes: {unit_of_measurement: 'kWh'} }]]);
  await flush();
  assert.equal(card.summaryHistory[0][0].state, '200');
  assert.equal(card.summaryError, '');
});

test('equation boxes keep measured Home and account for the residual loss balance', () => {
  const card = new Card();
  const entities = Object.fromEntries(['load', 'battery_charge', 'grid', 'solar', 'battery_discharge'].map(key => [key, `sensor.${key}_energy`]));
  card.setConfig({ ...config, summary: { entities } });
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const start = card.bounds().start;
  card.summaryRange = { start, end: start + 3600000 };
  const totals = { solar: 10.39, grid: 4.03, battery_discharge: 1.07, battery_charge: 1.46, load: 13.23 };
  card.summaryHistory = Object.entries(entities).map(([key, entity]) => [
    { entity_id: entity, state: '100', last_changed: new Date(start).toISOString(), attributes: {unit_of_measurement:'kWh'} },
    { state: String(100 + totals[key]), last_changed: new Date(start + 3600000).toISOString(), attributes: {unit_of_measurement:'kWh'} },
  ]);
  const items = card.summaryItems();
  assert.equal(items.map(item => item.key).join(','), 'solar,grid,battery_discharge,battery_charge,load,balance');
  assert.equal(items.map(item => item.operator).join(''), '++−=+');
  assert.ok(Math.abs(card.summaryTotal(items[5]).value - 0.8) < 1e-8);
  assert.ok(Math.abs(card.summaryTotal(items[4]).value - 13.23) < 1e-8);
  assert.equal(items[4].color, '#ab47bc');
  card.summaryHistory.pop();
  assert.equal(card.summaryTotal(items[5]).value, null);
});

test('battery directions share history but mask opposite signs and use the restored palette', () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 0, 1, 12)', context);
  const start = card.bounds().start;
  card.history = [[{entity_id:'sensor.battery',state:'40',last_changed:new Date(start).toISOString()},
    {state:'-20',last_changed:new Date(start + 60000).toISOString()}]];
  const charge = card.series.find(series => series.direction === 'positive');
  const discharge = card.series.find(series => series.direction === 'negative');
  charge.group_by.func = discharge.group_by.func = 'raw';
  assert.equal(charge.entity, discharge.entity);
  assert.equal(charge.color, '#26a69a'); assert.equal(discharge.color, '#26a69a');
  assert.equal(card.seriesData(charge)[0][1], 40); assert.equal(card.seriesData(charge)[1][1], null);
  assert.equal(card.seriesData(discharge)[0][1], null); assert.equal(card.seriesData(discharge)[1][1], -20);
  assert.equal(card.series.find(series => series.key === 'load').color, '#ab47bc');
});
