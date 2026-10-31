/* global SolarEnergyCharts */
const ENERGY_KEYS = ['solar', 'battery', 'grid', 'load'];
const ENERGY_COLORS = ['#ffb300', '#26a69a', '#42a5f5', '#ab47bc'];
const ENERGY_SUMMARY_SHORT = { solar: 'Solar', load: 'Home', grid: 'Grid', grid_import: 'Import', grid_export: 'Export', battery_charge: 'Charge', battery_discharge: 'Discharge' };
const ENERGY_SUMMARY = {
  solar: 'Solar generated', load: 'Home consumed', grid: 'Grid energy',
  grid_import: 'Grid imported', grid_export: 'Grid exported',
  battery_charge: 'Battery charged', battery_discharge: 'Battery discharged',
};
let energyChartId = 0;

// Merge only data properties: YAML configuration must never modify object prototypes.
function energyMerge(...sources) {
  const out = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      out[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? energyMerge(out[key], value) : value;
    }
  }
  return out;
}

function energyDuration(value) {
  const match = typeof value === 'string' && value.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d|day)$/);
  if (!match) throw new Error(`Invalid duration: ${value}. Use e.g. 5min, 24h, or 1d.`);
  const units = { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, day: 86400000 };
  const result = Number(match[1]) * units[match[2]];
  if (!Number.isFinite(result) || result <= 0) throw new Error('Duration must be positive.');
  return result;
}

class SolarEnergyFlowCard extends HTMLElement {
  setConfig(config) {
    if (!config || (config.series !== undefined && !Array.isArray(config.series))) {
      throw new Error('Configure entities or a series list.');
    }
    if (config.title != null && typeof config.title !== 'string') throw new Error('title must be a string.');
    if (config.header?.title != null && typeof config.header.title !== 'string') throw new Error('header.title must be a string.');
    if (config.header?.show !== undefined && typeof config.header.show !== 'boolean') throw new Error('header.show must be boolean.');
    if (config.span?.start && config.span.start !== 'day') throw new Error('Only span.start: day is supported.');
    this.config = energyMerge({ hours_12: true, stacked: false, cache: false, graph_span: '1d' }, config);
    for (const key of ['hours_12', 'stacked', 'cache']) {
      if (typeof this.config[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
    }
    if (config.experimental?.brush !== undefined && typeof config.experimental.brush !== 'boolean') throw new Error('experimental.brush must be boolean.');
    if (config.brush?.selection_span) energyDuration(config.brush.selection_span);
    const span = energyDuration(this.config.graph_span);
    if (span > 7 * 86400000) throw new Error('graph_span must be at most 7d.');
    const defaults = { stroke_width: 1, curve: 'smooth', float_precision: 0, extend_to: false,
      group_by: { func: 'avg', duration: '5min', fill: 'null' } };
    const input = config.series || ENERGY_KEYS.map((key, i) => ({
      entity: config.entities?.[key], name: `${key[0].toUpperCase()}${key.slice(1)} (W)`,
      color: ENERGY_COLORS[i], type: key === 'load' ? 'line' : 'area',
      opacity: [0.25, 0.2, 0.3, 0][i], show: { in_brush: key === 'solar' || key === 'load' }, key,
    }));
    if (!input.length || input.length > 24) throw new Error('Configure between 1 and 24 series.');
    this.series = input.map((item, i) => {
      const series = energyMerge(defaults, config.all_series_config, item);
      if (!/^sensor\.[a-z0-9_]+$/.test(series.entity || '')) throw new Error('Configure solar, battery, grid, and load with sensor entity IDs, or use series.');
      if (series.name !== undefined && typeof series.name !== 'string') throw new Error('Series name must be a string.');
      if (series.color !== undefined && !/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(series.color)) throw new Error('Series color must be a hex color.');
      if (!['line', 'area'].includes(series.type || 'line')) throw new Error('Series type must be line or area.');
      if (!['smooth', 'straight', 'stepline'].includes(series.curve)) throw new Error('Unsupported curve.');
      if (!Number.isFinite(series.stroke_width) || series.stroke_width < 0 || series.stroke_width > 10) throw new Error('stroke_width must be between 0 and 10.');
      if (!Number.isInteger(series.float_precision) || series.float_precision < 0 || series.float_precision > 10) throw new Error('float_precision must be between 0 and 10.');
      if (series.opacity !== undefined && (!Number.isFinite(series.opacity) || series.opacity < 0 || series.opacity > 1)) throw new Error('opacity must be between 0 and 1.');
      if (![false, 'end', 'now'].includes(series.extend_to)) throw new Error('extend_to must be false, end, or now.');
      if (!['avg', 'min', 'max', 'sum', 'first', 'last', 'diff', 'median', 'raw'].includes(series.group_by.func)) throw new Error('Unsupported group_by.func.');
      if (!['null', 'zero', 'last'].includes(series.group_by.fill)) throw new Error('group_by.fill must be null (quoted), zero, or last.');
      const duration = energyDuration(series.group_by.duration);
      if (span / duration > 10000) throw new Error('group_by.duration produces more than 10000 buckets.');
      return energyMerge({ name: series.entity, color: ENERGY_COLORS[i % 4], type: 'line', opacity: 0.2 }, series);
    });
    if (config.summary !== undefined && (!config.summary || typeof config.summary !== 'object' || Array.isArray(config.summary))) throw new Error('summary must be a mapping.');
    const summary = config.summary || {};
    if (summary.show !== undefined && typeof summary.show !== 'boolean') throw new Error('summary.show must be boolean.');
    if (summary.precision !== undefined && (!Number.isInteger(summary.precision) || summary.precision < 0 || summary.precision > 6)) throw new Error('summary.precision must be between 0 and 6.');
    if (summary.entities !== undefined && (!summary.entities || typeof summary.entities !== 'object' || Array.isArray(summary.entities))) throw new Error('summary.entities must be a mapping.');
    this.summaryEntities = Object.entries(summary.entities || {}).map(([key, value]) => {
      const item = typeof value === 'string' ? { entity: value } : value;
      if (!Object.hasOwn(ENERGY_SUMMARY, key) || !item || !/^sensor\.[a-z0-9_]+$/.test(item.entity || '')) throw new Error('Use supported summary keys and sensor entity IDs.');
      if (item.unit !== undefined && !['Wh', 'kWh', 'MWh'].includes(item.unit)) throw new Error('Summary unit must be Wh, kWh, or MWh.');
      if (item.mode !== undefined && !['increasing', 'net'].includes(item.mode)) throw new Error('Summary mode must be increasing or net.');
      return { key, label: ENERGY_SUMMARY[key], entity: item.entity, unit: item.unit, mode: item.mode || (key === 'grid' ? 'net' : 'increasing') };
    });
    if (summary.show === false) this.summaryEntities = [];
    if (summary.show === true && !this.summaryEntities.length) throw new Error('Configure summary.entities to show energy totals.');
    this.summaryHistory = [];
    this.summaryError = '';
    this.summaryRange = null;
    this.date = this.date || new Date();
    this.chartId = this.chartId || `solar-energy-${++energyChartId}`;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.ready = false;
    this.history = [];
    this.error = '';
    this.cache = new Map();
    this.requestId = (this.requestId || 0) + 1;
    this.render();
    if (this._hass) this.load();
  }

  set hass(value) {
    this._hass = value;
    if (!this.ready && !this.loading && !this.error) this.load();
  }

  connectedCallback() { if (this.config) this.render(); }
  disconnectedCallback() { this.layoutObserver?.disconnect(); this.renderId = (this.renderId || 0) + 1; this.destroyCharts(); }
  getCardSize() { return Math.ceil((this.config?.apex_config?.chart?.height || 550) / 50) + 3; }
  getGridOptions() { return { columns: 24, rows: 11, min_columns: 6, min_rows: 6 }; }

  dayString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  bounds() {
    const start = new Date(this.date); start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    // One day follows calendar time, including daylight-saving transitions.
    if (['1d', '1day', '24h', '24hr'].includes(this.config.graph_span)) end.setDate(end.getDate() + 1);
    else end.setTime(start.getTime() + energyDuration(this.config.graph_span));
    return { start: start.getTime(), end: end.getTime() };
  }

  async load() {
    if (!this._hass || !this.config) return;
    const requestId = this.requestId = (this.requestId || 0) + 1;
    const { start, end } = this.bounds();
    const ids = [...new Set(this.series.map(series => series.entity))].join(',');
    const path = `history/period/${encodeURIComponent(new Date(start).toISOString())}?end_time=${encodeURIComponent(new Date(end).toISOString())}&filter_entity_id=${encodeURIComponent(ids)}&minimal_response=true&no_attributes=true`;
    this.loading = true;
    this.error = '';
    this.summaryHistory = [];
    this.summaryError = '';
    this.summaryRange = { start, end: Math.min(end, Date.now()) };
    this.render();
    // Energy-counter history keeps attributes so unit changes and explicit resets are visible.
    const summaryIds = [...new Set(this.summaryEntities.map(item => item.entity))].join(',');
    const summaryPath = `history/period/${encodeURIComponent(new Date(start).toISOString())}?end_time=${encodeURIComponent(new Date(Math.min(end, Date.now())).toISOString())}&filter_entity_id=${encodeURIComponent(summaryIds)}&significant_changes_only=0`;
    const summaryTask = this.summaryEntities.length && start < Date.now()
      ? Promise.resolve().then(() => this._hass.callApi('GET', summaryPath)).then(history => {
        if (!Array.isArray(history) || history.some(series => !Array.isArray(series))) throw new Error('Unexpected energy history response.');
        return { history, error: '' };
      }).catch(error => ({ history: [], error: `Energy history unavailable: ${error?.message || error}` }))
      : Promise.resolve({ history: [], error: '' });
    try {
      const cached = this.cache.get(path);
      const history = this.config.cache && cached && Date.now() - cached.time < 30000
        ? cached.history : await this._hass.callApi('GET', path);
      if (requestId !== this.requestId) return;
      if (!Array.isArray(history) || history.some(series => !Array.isArray(series))) throw new Error('Unexpected history response.');
      const summary = await summaryTask;
      if (requestId !== this.requestId) return;
      this.history = history;
      this.summaryHistory = summary.history;
      this.summaryError = summary.error;
      if (this.config.cache) {
        this.cache.set(path, { history, time: Date.now() });
        if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
      }
      this.ready = true;
    } catch (e) {
      if (requestId !== this.requestId) return;
      this.history = [];
      this.ready = false;
      this.error = `History request failed: ${e?.message || e}`;
    }
    this.loading = false;
    this.render();
  }

  energyTotal(item, range = this.summaryRange || this.bounds()) {
    const end = Math.min(range.end, Date.now());
    if (!(end > range.start)) return { value: null, reason: 'No elapsed time in range' };
    if (this.summaryError) return { value: null, reason: this.summaryError };
    const states = (this.summaryHistory || []).find(series => series[0]?.entity_id === item.entity) || [];
    if (!states.length) return { value: null, reason: 'No recorded energy history' };
    const units = { Wh: 0.001, kWh: 1, MWh: 1000 };
    let unit = item.unit || states[0]?.attributes?.unit_of_measurement || this._hass?.states?.[item.entity]?.attributes?.unit_of_measurement;
    let reset;
    const points = states.map(state => {
      if (!item.unit && state.attributes?.unit_of_measurement) unit = state.attributes.unit_of_measurement;
      if (state.attributes && Object.hasOwn(state.attributes, 'last_reset')) reset = state.attributes.last_reset;
      const raw = state.state;
      const number = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
      return { t: new Date(state.last_updated || state.last_changed).getTime(),
        v: Number.isFinite(number) && units[unit] ? number * units[unit] : null, unit, reset };
    }).filter(point => Number.isFinite(point.t) && point.t <= end).sort((a, b) => a.t - b.t);
    const baseline = points.filter(point => point.t <= range.start).at(-1);
    if (!baseline) return { value: null, reason: 'No reading at start of range' };
    const selected = [baseline, ...points.filter(point => point.t > range.start)];
    const last = selected.at(-1);
    if (!units[baseline.unit] || !units[last.unit]) return { value: null, reason: 'Energy unit must be Wh, kWh, or MWh' };
    if (baseline.v === null || last.v === null) return { value: null, reason: 'Energy reading unavailable at range boundary' };
    let previous = baseline;
    for (const point of selected.slice(1)) {
      if (point.reset !== previous.reset) return { value: null, reason: 'Counter reset in range' };
      if (point.v !== null) {
        if (item.mode !== 'net' && previous.v !== null && point.v < previous.v - 1e-9) return { value: null, reason: 'Counter decreased or reset in range' };
        previous = point;
      }
    }
    return { value: last.v - baseline.v, reason: '' };
  }

  updateSummary(range) {
    if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
      const bounds = this.bounds();
      this.summaryRange = { start: Math.max(bounds.start, range.start), end: Math.min(bounds.end, range.end, Date.now()) };
    }
    if (!this.summaryEntities?.length || !this.shadowRoot) return;
    const caption = this.shadowRoot.querySelector('.summary-caption');
    if (caption) caption.textContent = this.loading ? 'Energy · loading…' : 'Energy · selected time range';
    for (const item of this.summaryEntities) {
      const element = this.shadowRoot.querySelector(`[data-energy="${item.key}"]`);
      if (!element) continue;
      const result = this.loading || this.error ? { value: null, reason: this.error || 'Loading energy history' } : this.energyTotal(item);
      element.querySelector('.summary-label').textContent = ENERGY_SUMMARY_SHORT[item.key];
      element.querySelector('.summary-value').textContent = result.value === null ? '—' : `${result.value.toFixed(this.config.summary?.precision ?? 2)} kWh`;
      element.querySelector('.summary-note').textContent = result.reason;
      element.title = `${item.label}: ${result.value === null ? result.reason : element.querySelector('.summary-value').textContent}`;
      element.setAttribute('aria-label', element.title);
    }
  }

  rawValues(entity) {
    const states = (this.history || []).find(series => series[0]?.entity_id === entity) || [];
    return states.map(state => {
      const raw = state.state;
      const number = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
      return { t: new Date(state.last_changed || state.last_updated).getTime(), v: Number.isFinite(number) ? number : null };
    }).filter(point => Number.isFinite(point.t)).sort((a, b) => a.t - b.t);
  }

  values(key) {
    const entity = this.config.entities?.[key] || this.series.find(series => series.key === key)?.entity;
    return this.rawValues(entity).filter(point => point.v !== null);
  }

  seriesData(series) {
    const { start, end } = this.bounds();
    const limit = Math.min(end, Date.now());
    const raw = this.rawValues(series.entity).filter(point => point.t >= start && point.t <= limit);
    if (series.group_by.func === 'raw') return raw.map(point => [point.t, point.v]);
    const duration = energyDuration(series.group_by.duration);
    const buckets = new Map();
    for (const point of raw) {
      const index = Math.floor((point.t - start) / duration);
      if (!buckets.has(index)) buckets.set(index, []);
      if (point.v !== null) buckets.get(index).push(point.v);
    }
    const result = [];
    let last = null;
    for (let t = start, i = 0; t < limit; t += duration, i++) {
      const values = buckets.get(i) || [];
      let value = series.group_by.fill === 'zero' ? 0 : series.group_by.fill === 'last' ? last : null;
      if (values.length) {
        switch (series.group_by.func) {
          case 'avg': value = values.reduce((a, b) => a + b, 0) / values.length; break;
          case 'min': value = values.reduce((a, b) => Math.min(a, b)); break;
          case 'max': value = values.reduce((a, b) => Math.max(a, b)); break;
          case 'sum': value = values.reduce((a, b) => a + b, 0); break;
          case 'first': value = values[0]; break;
          case 'last': value = values[values.length - 1]; break;
          case 'diff': value = values[values.length - 1] - values[0]; break;
          case 'median': {
            const sorted = values.slice().sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
            value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; break;
          }
        }
        last = value;
      }
      // extend_to:false must never invent readings beyond the last recorded state.
      if (t > (raw[raw.length - 1]?.t ?? -Infinity) && series.extend_to === false) value = null;
      result.push([t, value]);
    }
    if (series.extend_to !== false && last !== null) {
      const target = series.extend_to === 'end' ? end : limit;
      const lastTime = raw[raw.length - 1]?.t ?? start;
      for (const point of result) if (point[0] > lastTime) point[1] = last;
      result.push([target, last]);
    }
    return result;
  }

  summaryChartHeight(height) {
    if (!this.summaryEntities.length || typeof height !== 'number') return height;
    const row = this.shadowRoot?.querySelector('.header-row')?.getBoundingClientRect?.();
    const controls = this.shadowRoot?.querySelector('.controls')?.getBoundingClientRect?.();
    // A wrapped compact summary uses chart space, keeping the card's total height unchanged.
    const extra = row && controls ? Math.max(0, row.height - controls.height) : 0;
    return Math.max(1, height - extra);
  }

  observeSummaryLayout() {
    this.layoutObserver?.disconnect();
    if (!this.summaryEntities.length || typeof ResizeObserver === 'undefined') return;
    const renderId = this.renderId;
    this.layoutObserver = new ResizeObserver(() => {
      if (renderId !== this.renderId) return;
      const chart = this.charts?.[0];
      const height = this.summaryChartHeight(this.config.apex_config?.chart?.height ?? 550);
      if (chart && typeof height === 'number' && Math.abs(Number(chart.w.config.chart.height) - height) > 0.5) {
        chart.updateOptions({ chart: { height } }, false, false).catch(() => {});
      }
    });
    const row = this.shadowRoot.querySelector('.header-row');
    if (row) this.layoutObserver.observe(row);
  }

  chartOptions(isBrush = false) {
    const { start, end } = this.bounds();
    const visible = isBrush ? this.series.filter(series => series.show?.in_brush === true) : this.series;
    const selected = visible.length ? visible : this.series;
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(this) : null;
    const text = css?.getPropertyValue('--primary-text-color').trim() || '#59636e';
    const grid = css?.getPropertyValue('--divider-color').trim() || '#dddddd';
    const dark = this._hass?.themes?.darkMode || false;
    const options = energyMerge({
      chart: { id: isBrush ? `${this.chartId}-brush` : this.chartId, type: 'line', height: isBrush ? 100 : 550,
        foreColor: text, background: 'transparent', fontFamily: 'inherit', stacked: this.config.stacked,
        animations: { enabled: false }, parentHeightOffset: 0,
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        toolbar: { show: !isBrush, tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } } },
      theme: { mode: dark ? 'dark' : 'light' },
      colors: selected.map(series => series.color),
      stroke: { width: selected.map(series => series.stroke_width), curve: selected.map(series => series.curve) },
      fill: { type: 'solid', opacity: selected.map(series => series.type === 'area' ? series.opacity : 1) },
      dataLabels: { enabled: false }, markers: { size: 0 },
      grid: { borderColor: grid, strokeDashArray: 4 },
      legend: { show: !isBrush, position: 'bottom' },
      xaxis: { type: 'datetime', min: start, max: end, labels: { datetimeUTC: false,
        format: this.config.hours_12 ? 'hh:mm TT' : 'HH:mm' }, tooltip: { enabled: !isBrush } },
      yaxis: { show: !isBrush, forceNiceScale: true, title: { text: 'Power (W)' }, decimalsInFloat: 0 },
      tooltip: { enabled: !isBrush, shared: true, intersect: false, x: { format: this.config.hours_12 ? 'dd MMM yyyy, hh:mm:ss TT' : 'dd MMM yyyy, HH:mm:ss' },
        y: { formatter: (value, { seriesIndex }) => value == null ? '—' : `${Number(value).toFixed(selected[seriesIndex]?.float_precision ?? 0)} W` } },
      noData: { text: 'No recorded history for this date' },
    }, isBrush ? this.config.brush?.apex_config : this.config.apex_config);
    // Identity, history data, and date boundaries belong to this card, not raw Apex options.
    if (!isBrush) options.chart.height = this.summaryChartHeight(options.chart.height);
    options.chart.id = isBrush ? `${this.chartId}-brush` : this.chartId;
    options.chart.events = energyMerge(options.chart.events, { beforeResetZoom: () => {
      // Apex's brush keeps its old selection after toolbar reset unless it is reset too.
      const renderId = this.renderId;
      if (!isBrush) Promise.resolve().then(() => {
        if (renderId !== this.renderId) return;
        const overview = this.charts?.find(chart => chart.w.config.chart.id === `${this.chartId}-brush`);
        if (overview) return overview.updateOptions({ chart: { selection: { xaxis: { min: start, max: end } } } }, false, false);
      }).catch(() => {});
      return { xaxis: { min: start, max: end } };
    } });
    if (!isBrush && this.summaryEntities.length) {
      const renderId = this.renderId;
      const sync = chart => {
        if (renderId === this.renderId) this.updateSummary({ start: chart.w.globals.minX, end: chart.w.globals.maxX });
      };
      // Brush updates also trigger the main chart's updated event.
      for (const event of ['mounted', 'updated', 'zoomed', 'scrolled']) {
        const previous = options.chart.events[event];
        options.chart.events[event] = (chart, ...args) => { sync(chart); if (typeof previous === 'function') previous(chart, ...args); };
      }
    }
    options.series = selected.map(series => ({ name: series.name.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])), type: series.type, data: this.seriesData(series) }));
    options.xaxis = energyMerge(options.xaxis, { type: 'datetime', min: start, max: end });
    const values = options.series.flatMap(series => series.data.map(point => point[1])).filter(value => value !== null);
    // Include zero even when every sample is positive or negative.
    if (!Array.isArray(options.yaxis)) {
      if (options.yaxis.min === undefined) options.yaxis.min = values.reduce((min, value) => Math.min(min, value), 0);
      if (options.yaxis.max === undefined) options.yaxis.max = values.reduce((max, value) => Math.max(max, value), 100);
    }
    options.annotations = energyMerge(options.annotations, { yaxis: [
      ...(options.annotations?.yaxis || []),
      { y: 0, borderColor: text, strokeDashArray: 6, label: { text: isBrush ? '' : '0 W', position: 'right',
        borderColor: 'transparent', style: { color: text, background: 'transparent', fontSize: '11px' } } },
    ] });
    if (isBrush) {
      const width = this.config.brush?.selection_span ? energyDuration(this.config.brush.selection_span) : end - start;
      options.chart.brush = { enabled: true, target: this.chartId, autoScaleYaxis: true };
      options.chart.selection = { enabled: true, xaxis: { min: start, max: Math.min(end, start + width) } };
      options.chart.toolbar = { show: false };
    }
    return options;
  }

  destroyCharts() {
    for (const chart of this.charts || []) { try { chart.destroy(); } catch (_) { /* A detached chart may already be destroyed. */ } }
    this.charts = [];
  }

  mountCharts() {
    const renderId = this.renderId;
    const main = this.shadowRoot.querySelector('#chart');
    const brush = this.shadowRoot.querySelector('#brush');
    // Serialize renders so a date switch cannot destroy an engine mid-render.
    this.chartTask = (this.chartTask || Promise.resolve()).catch(() => {}).then(async () => {
      this.destroyCharts();
      if (renderId !== this.renderId || this.isConnected === false) return;
      for (const [element, isBrush] of [[main, false], [brush, true]]) {
        if (!element || renderId !== this.renderId) break;
        const chart = new SolarEnergyCharts(element, this.chartOptions(isBrush));
        this.charts.push(chart);
        await chart.render();
      }
      if (renderId !== this.renderId || this.isConnected === false) this.destroyCharts();
      else this.observeSummaryLayout();
    }).catch(error => {
      this.destroyCharts();
      if (renderId !== this.renderId) return;
      const status = this.shadowRoot.querySelector('.status');
      if (status) status.textContent = `Chart could not render: ${error?.message || error}`;
    });
  }

  render() {
    if (!this.shadowRoot) return;
    this.layoutObserver?.disconnect();
    this.renderId = (this.renderId || 0) + 1;
    const day = this.dayString(this.date);
    const title = this.config.header?.title ?? this.config.title ?? '';
    const showTitle = this.config.header?.show !== false && title.trim() !== '';
    const showBrush = this.config.experimental?.brush !== false;
    const summaryMarkup = this.summaryEntities.length ? `<section class="energy-summary" aria-label="Energy summary for selected time range"><p class="summary-caption"></p><div class="summary-grid">${this.summaryEntities.map(item => `<div class="summary-item" data-energy="${item.key}" tabindex="0"><div class="summary-label"></div><div class="summary-value"></div><div class="summary-note"></div></div>`).join('')}</div></section>` : '';
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;min-width:0}ha-card{padding:12px;overflow:hidden}
      .head{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}.header-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
      .title{font-size:1.2rem;font-weight:500;overflow-wrap:anywhere}
      .controls{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex:1;min-width:0}
      button,input{font:inherit;border:1px solid var(--divider-color,#ddd);border-radius:8px;background:var(--secondary-background-color,#f7f7f7);padding:7px 9px;color:var(--primary-text-color,inherit);min-width:0}
      button{cursor:pointer;flex-shrink:0}input{max-width:165px}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color,#03a9f4)}
      #chart,#brush{min-width:0}.status{font-size:.9rem;color:var(--secondary-text-color,#697586)}
      .header-row:has(.energy-summary) .controls{flex:0 1 auto}
      .energy-summary{flex:1 1 350px;max-width:550px;min-width:0;margin-left:auto;overflow-x:auto}
      .summary-grid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(62px,1fr);gap:6px}
      .summary-item{min-width:0;text-align:right;line-height:1.25;border-radius:3px}
      .summary-label{font-size:10px;color:var(--secondary-text-color,#697586);white-space:nowrap}
      .summary-value{font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--primary-text-color,inherit)}
      .summary-caption,.summary-note{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .summary-item:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:-2px}
      .apexcharts-tooltip,.apexcharts-menu{color:#222}.apexcharts-theme-dark{color:#eee}
      @media(max-width:400px){ha-card{padding:8px}.controls{gap:4px}button,input{padding:6px}input{width:130px}}
    </style><ha-card><div class="head">${showTitle ? '<div class="title"></div>' : ''}<div class="header-row"><div class="controls"><button id="prev" aria-label="Previous day">‹</button><input id="date" aria-label="History date" type="date" value="${day}"><button id="next" aria-label="Next day">›</button><button id="today">Today</button></div>${summaryMarkup}</div></div><div class="status" role="status"></div><div id="chart"></div>${showBrush ? '<div id="brush"></div>' : ''}</ha-card>`;
    const heading = this.shadowRoot.querySelector('.title');
    if (showTitle && heading) heading.textContent = title;
    const status = this.shadowRoot.querySelector('.status');
    if (status) status.textContent = this.loading ? 'Loading history…' : this.error || '';
    this.shadowRoot.getElementById('prev').onclick = () => { this.date.setDate(this.date.getDate() - 1); this.load(); };
    this.shadowRoot.getElementById('next').onclick = () => { this.date.setDate(this.date.getDate() + 1); this.load(); };
    this.shadowRoot.getElementById('today').onclick = () => { this.date = new Date(); this.load(); };
    this.shadowRoot.getElementById('date').onchange = event => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return;
      this.date = new Date(`${event.target.value}T12:00:00`); this.load();
    };
    this.updateSummary();
    if (this.ready && !this.loading && !this.error) this.mountCharts();
    else this.chartTask = (this.chartTask || Promise.resolve()).catch(() => {}).then(() => this.destroyCharts());
  }
}
customElements.define('solar-energy-flow-card', SolarEnergyFlowCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'solar-energy-flow-card', name: 'Solar Energy Flow Card', description: 'Date-selectable solar power history with zoom, tooltips, and brush selection.' });
