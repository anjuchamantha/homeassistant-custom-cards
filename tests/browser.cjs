const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/card.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(fs.readFileSync('dist/solar-energy-flow-card.js'));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:12px;font-family:Arial;--primary-text-color:#28313b;--divider-color:#ddd}solar-energy-flow-card{display:block;max-width:1100px}ha-card{display:block;border:1px solid #ddd;border-radius:18px;background:white}</style></head><body><script src="/card.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    page.setDefaultTimeout(15000);
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => customElements.define('ha-card', class extends HTMLElement {
      constructor() { super(); this.attachShadow({mode: 'open'}).innerHTML = '<style>:host{display:block;background:white;border:1px solid #ddd;border-radius:18px;box-shadow:0 2px 5px #0001}</style><slot></slot>'; }
    }));
    await page.evaluate(() => {
      const card = document.createElement('solar-energy-flow-card');
      window.card = card;
      const entities = { solar: 'sensor.solar', battery: 'sensor.battery', grid: 'sensor.grid', load: 'sensor.load' };
      window.exampleConfig = { type: 'custom:solar-energy-flow-card', entities };
      card.setConfig(window.exampleConfig);
      document.body.append(card);
      card.date = new Date(2026, 0, 1, 12);
      const makeHistory = start => Object.entries(entities).map(([key, entity], index) => {
        return Array.from({ length: 1440 }, (_, minute) => ({
          ...(minute === 0 ? { entity_id: entity } : {}),
          state: String(key === 'battery' ? 500 * Math.sin(minute / 70) : Math.max(0, (index + 1) * 180 + Math.sin(minute / 40) * 160)),
          last_changed: new Date(start + minute * 60000).toISOString(),
        }));
      });
      window.historyRequests = [];
      card.hass = { callApi: async (_, path) => {
        window.historyRequests.push(path);
        const start = new Date(decodeURIComponent(path.split('?')[0].slice('history/period/'.length))).getTime();
        return makeHistory(start);
      } };
    });
    await page.waitForFunction(() => window.card.charts?.length === 2 && window.card.shadowRoot.querySelectorAll('.apexcharts-svg').length === 2);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.locator('solar-energy-flow-card .title').count(), 0);
    assert.equal(await page.locator('solar-energy-flow-card .status').innerText(), '');
    const baseline = page.locator('solar-energy-flow-card .apexcharts-yaxis-annotations line').first();
    assert.equal(await baseline.getAttribute('stroke-dasharray'), '6');
    const main = page.locator('solar-energy-flow-card #chart');
    assert.equal(await main.locator('.apexcharts-toolbar').count(), 1);
    const original = await page.evaluate(() => window.card.charts[0].w.globals.maxX - window.card.charts[0].w.globals.minX);
    await main.locator('.apexcharts-zoomin-icon').click();
    assert.ok(await page.evaluate(() => window.card.charts[0].w.globals.maxX - window.card.charts[0].w.globals.minX) < original);
    await main.locator('.apexcharts-reset-icon').click();
    await page.waitForFunction(range => window.card.charts[0].w.globals.maxX - window.card.charts[0].w.globals.minX >= range, original);
    const box = await main.locator('.apexcharts-inner').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.card.shadowRoot.querySelector('.apexcharts-tooltip.apexcharts-active'));
    await main.locator('.apexcharts-menu-icon').click();
    assert.ok(await main.locator('.exportCSV').isVisible());
    await main.locator('.apexcharts-menu-icon').click();
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => getComputedStyle(window.card.shadowRoot.querySelector('.apexcharts-tooltip')).opacity === '0');
    if (process.env.CARD_SCREENSHOT_DIR) {
      await page.locator('solar-energy-flow-card').screenshot({ path: `${process.env.CARD_SCREENSHOT_DIR}/solar-card-desktop.png` });
    }
    // A title is optional, and text values must not become markup.
    await page.evaluate(async () => {
      window.card.setConfig({ ...window.exampleConfig, title: '<img src=x onerror=alert(1)>' });
      await window.card.chartTask;
    });
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.locator('solar-energy-flow-card .title img').count(), 0);
    assert.equal(await page.locator('solar-energy-flow-card .title').innerText(), '<img src=x onerror=alert(1)>');
    // Phone width, no title: controls and chart must fit the card.
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(async () => {
      window.card.setConfig(window.exampleConfig);
      await window.card.chartTask;
    });
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('solar-energy-flow-card .status').innerText(), '');
    if (process.env.CARD_SCREENSHOT_DIR) {
      await page.locator('solar-energy-flow-card').screenshot({ path: `${process.env.CARD_SCREENSHOT_DIR}/solar-card-mobile.png` });
    }
    // The separate slider moves the overview into prior days while keeping a six-hour main window.
    await page.evaluate(() => window.card.setConfig({ ...window.exampleConfig, brush: { selection_span: '6h' } }));
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    const anchor = await page.evaluate(() => window.card.bounds().start);
    const slider = page.locator('solar-energy-flow-card #timeline-slider');
    const beforePreview = await page.evaluate(() => window.historyRequests.length);
    await slider.evaluate(input => { input.value = '-1440'; input.dispatchEvent(new Event('input')); });
    assert.equal(await page.evaluate(() => window.historyRequests.length), beforePreview);
    await slider.evaluate(input => input.dispatchEvent(new Event('change')));
    await page.waitForFunction(() => window.card.timelineOffset === -1440 && window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    const moved = await page.evaluate(() => ({
      start: window.card.bounds().start,
      main: [window.card.charts[0].w.globals.minX, window.card.charts[0].w.globals.maxX],
      brush: [window.card.charts[1].w.globals.minX, window.card.charts[1].w.globals.maxX],
      samples: window.card.seriesData(window.card.series[0]).filter(point => point[1] !== null).length,
      request: window.historyRequests.at(-1),
    }));
    assert.ok(moved.start < anchor);
    assert.equal(moved.main[1] - moved.main[0], 6 * 3600000);
    assert.equal(moved.brush[0], moved.start);
    assert.equal(moved.main[0], moved.start);
    assert.ok(moved.samples > 0);
    assert.ok(moved.request.includes(encodeURIComponent(new Date(moved.start).toISOString())));
    await slider.focus(); await slider.press('Home');
    await page.waitForFunction(() => window.card.timelineOffset === -7 * 1440 && window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    await page.locator('solar-energy-flow-card #timeline-latest').click();
    await page.waitForFunction(() => window.card.timelineOffset === 0 && window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.evaluate(() => window.card.bounds().start), anchor);
    assert.equal(await page.evaluate(() => window.card.charts[0].w.globals.maxX - window.card.charts[0].w.globals.minX), 6 * 3600000);
    assert.equal(await page.locator('solar-energy-flow-card #date').inputValue(), '2026-01-01');
    // Disable brush, reconfigure as series, navigate, and detach/reconnect safely.
    await page.evaluate(() => window.card.setConfig({
      series: Object.values(window.exampleConfig.entities).map((entity, index) => ({ entity, type: index === 3 ? 'line' : 'area', show: { in_brush: index === 0 } })),
      experimental: { brush: false }, apex_config: { chart: { height: 320 } },
    }));
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.locator('solar-energy-flow-card #brush').count(), 0);
    assert.equal(await page.locator('solar-energy-flow-card #timeline-slider').count(), 0);
    await page.locator('solar-energy-flow-card #prev').click();
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    await page.evaluate(async () => { window.card.remove(); await window.card.chartTask; document.body.append(window.card); await window.card.chartTask; });
    assert.equal(await page.locator('solar-energy-flow-card .status').innerText(), '');
    // Explicit series labels must not inject markup through Apex's HTML legend/tooltip.
    await page.evaluate(() => window.card.setConfig({
      series: [{ entity: 'sensor.solar', name: '<img src=x onerror="window.injected=1">' }],
      experimental: { brush: false },
    }));
    await page.waitForFunction(() => window.card.ready && !window.card.loading);
    await page.evaluate(() => window.card.chartTask);
    assert.equal(await page.locator('solar-energy-flow-card img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    // Multiple cards and their brush instances must remain independent.
    await page.evaluate(async () => {
      window.second = document.createElement('solar-energy-flow-card');
      window.second.setConfig(window.exampleConfig);
      document.body.append(window.second);
      window.second.date = window.card.date;
      window.second.hass = window.card._hass;
      await new Promise(resolve => setTimeout(resolve, 0));
      await window.second.chartTask;
    });
    assert.equal(await page.locator('solar-energy-flow-card').count(), 2);
    assert.equal(await page.evaluate(() => window.card.chartId !== window.second.chartId), true);
    assert.equal(await page.evaluate(() => window.second.charts.length), 2);
    assert.deepEqual(failures, []);
    console.log('Browser checks passed: desktop/mobile, zero baseline, title safety, zoom/reset, tooltip/export, brush, cross-day timeline slider, date changes, and reconnection.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
