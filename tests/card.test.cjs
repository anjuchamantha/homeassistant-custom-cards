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
      if (!elements.has(key)) elements.set(key, { setAttribute(name, value) { this[name] = value; } });
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


test('timeline slider requests older history and preserves the selected main graph window', async () => {
  const card = new Card(); card.setConfig({ ...config, brush: { selection_span: '6h' } });
  card.date = vm.runInContext('new Date(2026, 9, 31, 12)', context);
  const original = card.bounds();
  const requests = [];
  card.hass = { callApi: async (_, path) => { requests.push(path); return []; } };
  await flush();
  card.charts = [{ w: { globals: { minX: original.start + 3600000, maxX: original.start + 4 * 3600000 } } }];
  await card.moveTimeline(-1440);
  const earlier = card.bounds();
  assert.equal(new Date(earlier.start).getDate(), 30);
  const view = card.chartOptions().xaxis;
  assert.equal(view.min, earlier.start + 3600000);
  assert.equal(view.max, earlier.start + 4 * 3600000);
  assert.equal(card.chartOptions(true).xaxis.min, earlier.start);
  assert.equal(card.chartOptions(true).chart.selection.xaxis.min, view.min);
  assert.ok(requests.at(-1).includes(encodeURIComponent(new Date(earlier.start).toISOString())));
  card.charts = [];
  await card.moveTimeline(0);
  assert.equal(card.bounds().start, original.start);
  assert.equal(card.viewBounds().max - card.viewBounds().min, 3 * 3600000);
});

test('timeline previews do not fetch until release; range is bounded and date navigation resets it', async () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 9, 31, 12)', context);
  let requests = 0;
  card.hass = { callApi: async () => { requests++; return []; } };
  await flush();
  const slider = card.shadowRoot.getElementById('timeline-slider');
  slider.oninput({ target: { value: '-1440' } });
  assert.equal(requests, 1);
  assert.match(card.shadowRoot.getElementById('timeline-window').textContent, /30/);
  await slider.onchange({ target: { value: '-1440' } });
  assert.equal(requests, 2);
  assert.equal(card.timelineOffset, -1440);
  await card.moveTimeline(-999999);
  assert.equal(card.timelineOffset, -7 * 1440);
  await card.selectDay(vm.runInContext('new Date(2026, 9, 31, 12)', context));
  assert.equal(card.timelineOffset, 0);
  assert.equal(card.timelineSelection, null);
});

test('timeline can be disabled and validates lookback settings', () => {
  const card = new Card(); card.setConfig({ ...config, brush: { timeline: { show: false } } });
  assert.ok(!card.shadowRoot.innerHTML.includes('id="timeline-slider"'));
  card.setConfig({ ...config, experimental: { brush: false } });
  assert.ok(!card.shadowRoot.innerHTML.includes('id="timeline-slider"'));
  for (const history_days of [0, -1, 1.5, 366, '7']) {
    assert.throws(() => card.setConfig({ ...config, brush: { timeline: { history_days } } }), /history_days/);
  }
});

test('timeline calendar-day shifts preserve local hour across daylight saving', () => {
  const card = new Card(); card.setConfig(config);
  card.date = vm.runInContext('new Date(2026, 2, 9, 12)', context);
  const before = card.bounds(-1440);
  assert.equal(new Date(before.start).getDate(), 8);
  assert.equal(new Date(before.start).getHours(), 0);
  assert.equal(new Date(before.end).getHours(), 0);
  assert.equal((before.end - before.start) / 3600000, process.env.TZ === 'America/New_York' ? 23 : 24);
});


test('timeline ignores a chart range from the previous overview during rapid navigation', async () => {
  const card = new Card(); card.setConfig({ ...config, brush: { selection_span: '6h' } });
  card.date = vm.runInContext('new Date(2026, 9, 31, 12)', context);
  card.hass = { callApi: async () => [] }; await flush();
  const original = card.bounds();
  card.timelineOffset = -1440;
  card.timelineSelection = { min: 0, max: 6 * 3600000 };
  card.charts = [{ w: { globals: { minX: original.start, maxX: original.start + 6 * 3600000 } } }];
  await card.moveTimeline(-2880);
  assert.equal(card.viewBounds().max - card.viewBounds().min, 6 * 3600000);
});
