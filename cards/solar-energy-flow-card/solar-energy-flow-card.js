class SolarEnergyFlowCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entities ||
        ['solar', 'battery', 'grid', 'load'].some(key =>
          typeof config.entities[key] !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(config.entities[key]))) {
      throw new Error('Configure solar, battery, grid, and load with sensor entity IDs.');
    }
    if (config.title !== undefined && typeof config.title !== 'string') {
      throw new Error('title must be a string.');
    }
    this.config = {
      title: 'Solar power history',
      entities: {},
      ...config,
    };
    this.date = this.date || new Date();
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.ready = false;
    this.history = [];
    this.error = '';
    this.requestId = (this.requestId || 0) + 1;
    this.render();
    if (this._hass) this.load();
  }

  set hass(value) {
    this._hass = value;
    if (!this.ready && !this.loading && !this.error) this.load();
  }

  getCardSize() { return 7; }

  dayString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async load() {
    if (!this._hass || !this.config) return;
    const requestId = this.requestId = (this.requestId || 0) + 1;
    const startDate = new Date(this.date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    const ids = Object.values(this.config.entities).filter(Boolean).join(',');
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const path = `history/period/${encodeURIComponent(start)}?end_time=${encodeURIComponent(end)}&filter_entity_id=${encodeURIComponent(ids)}&minimal_response=true&no_attributes=true`;
      const history = await this._hass.callApi('GET', path);
      if (requestId !== this.requestId) return;
      if (!Array.isArray(history) || history.some(series => !Array.isArray(series))) {
        throw new Error('Unexpected history response.');
      }
      this.history = history;
      this.ready = true;
      this.error = '';
    } catch (e) {
      if (requestId !== this.requestId) return;
      this.history = [];
      this.ready = false;
      this.error = `History request failed: ${e.message || e}`;
    }
    this.loading = false;
    this.render();
  }

  values(key) {
    const id = this.config.entities[key];
    const series = (this.history || []).find(states => states[0]?.entity_id === id) || [];
    return series.filter(s => s.state != null && String(s.state).trim() !== '').map(s => ({
      t: new Date(s.last_changed || s.last_updated).getTime(),
      v: Number(s.state),
    })).filter(x => Number.isFinite(x.v) && Number.isFinite(x.t));
  }

  draw(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, rect.width), h = 360;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const c = canvas.getContext('2d'); c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);
    const pad = { l: 48, r: 18, t: 18, b: 42 };
    const start = new Date(this.date); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const x0 = start.getTime(), x1 = end.getTime();
    const keys = ['solar', 'battery', 'grid', 'load'];
    const colors = { solar: '#ffab00', battery: '#26a69a', grid: '#42a5f5', load: '#ab47bc' };
    const data = Object.fromEntries(keys.map(k => [k, this.values(k)]));
    const all = keys.flatMap(k => data[k].map(p => p.v));
    const max = all.reduce((m, v) => Math.max(m, Math.abs(v)), 100);
    const min = all.reduce((m, v) => Math.min(m, v), 0);
    const X = t => pad.l + ((t - x0) / (x1 - x0)) * (w - pad.l - pad.r);
    const Y = v => pad.t + ((max - v) / (max - min || 1)) * (h - pad.t - pad.b);
    c.strokeStyle = '#d9d9d9'; c.fillStyle = '#666'; c.font = '12px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * i / 4, y = Y(v);
      c.beginPath(); c.moveTo(pad.l, y); c.lineTo(w - pad.r, y); c.stroke();
      c.fillText(`${Math.round(v)} W`, 4, y + 4);
    }
    for (let i = 0; i <= 6; i++) {
      const t = x0 + (x1 - x0) * i / 6, x = X(t);
      c.fillText(`${String(new Date(t).getHours()).padStart(2, '0')}:00`, x - 14, h - 14);
    }
    keys.forEach(k => {
      const points = data[k].filter(p => p.t >= x0 && p.t <= x1);
      if (!points.length) return;
      c.strokeStyle = colors[k]; c.lineWidth = 2; c.beginPath();
      points.forEach((p, i) => i ? c.lineTo(X(p.t), Y(p.v)) : c.moveTo(X(p.t), Y(p.v)));
      c.stroke();
    });
  }

  render() {
    if (!this.shadowRoot) return;
    const day = this.dayString(this.date);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}.card{background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:12px;box-shadow:var(--ha-card-box-shadow,0 2px 6px #0002);padding:16px;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family, sans-serif)}
      .head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.title{font-size:1.25rem;font-weight:500;flex:1}.controls{display:flex;align-items:center;gap:6px}button,input{font:inherit;border:1px solid var(--divider-color,#ddd);border-radius:6px;background:var(--secondary-background-color,#f7f7f7);padding:6px 9px;color:inherit}button{cursor:pointer}canvas{display:block;width:100%;height:360px;margin-top:8px}.legend{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;font-size:.9rem}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}.error{color:var(--error-color,#db4437)}
    </style><ha-card class="card"><div class="head"><div class="title"></div><div class="controls"><button id="prev">‹</button><input id="date" type="date" value="${day}"><button id="next">›</button><button id="today">Today</button></div></div><div>${this.loading ? 'Loading history…' : this.error ? `<span class="error"></span>` : ''}</div><canvas></canvas><div class="legend"><span><i class="dot" style="background:#ffab00"></i>Solar</span><span><i class="dot" style="background:#26a69a"></i>Battery</span><span><i class="dot" style="background:#42a5f5"></i>Grid</span><span><i class="dot" style="background:#ab47bc"></i>Load</span></div></ha-card>`;
    this.shadowRoot.querySelector('.title').textContent = this.config.title;
    const error = this.shadowRoot.querySelector('.error');
    if (error) error.textContent = this.error;
    this.shadowRoot.getElementById('prev').onclick = () => { this.date.setDate(this.date.getDate() - 1); this.load(); };
    this.shadowRoot.getElementById('next').onclick = () => { this.date.setDate(this.date.getDate() + 1); this.load(); };
    this.shadowRoot.getElementById('today').onclick = () => { this.date = new Date(); this.load(); };
    this.shadowRoot.getElementById('date').onchange = e => { if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return; this.date = new Date(`${e.target.value}T12:00:00`); this.load(); };
    const canvas = this.shadowRoot.querySelector('canvas');
    if (canvas && this.ready && !this.loading) this.draw(canvas);
  }
}
customElements.define('solar-energy-flow-card', SolarEnergyFlowCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'solar-energy-flow-card', name: 'Solar Energy Flow Card', description: 'Date-selectable solar, battery, grid and load history.' });
