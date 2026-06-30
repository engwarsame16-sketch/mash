// ===================================================================
// Project Cost Manager — vanilla JS single-page app.
// Talks to the serverless API under /api which persists to Postgres.
// ===================================================================

// ---------- API client ----------
async function http(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const api = {
  get: (u) => http('GET', u),
  post: (u, b) => http('POST', u, b),
  put: (u, b) => http('PUT', u, b),
  patch: (u, b) => http('PATCH', u, b),
  del: (u) => http('DELETE', u),
};

// ---------- formatting helpers ----------
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k';
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function toDateInput(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toISOString().slice(0, 10);
}
function monthKey(d) { const date = new Date(d); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function monthLabel(key) { const [y, m] = key.split('-'); const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1)); return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }); }
function statusClass(s) { return 'status ' + String(s || 'Paid').toLowerCase(); }
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#65a30d', '#475569'];
const colorFor = (i) => PALETTE[i % PALETTE.length];

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ---------- theme ----------
const THEME_KEY = 'cm-theme';
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
function updateThemeButton() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const label = document.getElementById('themeLabel');
  const icon = document.getElementById('themeIcon');
  if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
  if (icon) icon.textContent = dark ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  updateThemeButton();
}

// ---------- period filtering ----------
const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'year', label: 'This year' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'month', label: 'This month' },
  { key: '30d', label: 'Last 30 days' },
];
function periodBounds(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const end = new Date(y, m, d, 23, 59, 59);
  switch (key) {
    case 'month': return [new Date(y, m, 1), new Date(y, m + 1, 0, 23, 59, 59)];
    case 'quarter': { const q = Math.floor(m / 3); return [new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0, 23, 59, 59)]; }
    case 'year': return [new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59)];
    case 'ytd': return [new Date(y, 0, 1), end];
    case '30d': { const f = new Date(y, m, d); f.setDate(f.getDate() - 29); return [f, end]; }
    default: return [null, null];
  }
}
function inPeriod(e, key) {
  const [f, t] = periodBounds(key);
  if (!f) return true;
  const dt = new Date(e.entry_date);
  return dt >= f && dt <= t;
}

// ---------- CSV export ----------
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((cell) => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- app state ----------
const state = {
  entries: null,
  options: null,
  budgets: null,
  period: 'all',
  // transactions controls
  q: '', filterWorkstream: '', filterCategory: '', filterStatus: '', filterStaff: '',
  fromDate: '', toDate: '',
  sortKey: 'date', sortDir: 'desc',
};

const ROUTES = [
  { hash: '#/', label: 'Dashboard', icon: '▣', render: renderDashboard },
  { hash: '#/transactions', label: 'Transactions', icon: '☰', render: renderTransactions },
  { hash: '#/staff', label: 'Staff', icon: '👥', render: renderStaff },
  { hash: '#/budgets', label: 'Budgets', icon: '◎', render: renderBudgets },
  { hash: '#/reports', label: 'Reports', icon: '◔', render: renderReports },
  { hash: '#/categories', label: 'Categories', icon: '⚙', render: renderCategories },
  { hash: '#/trash', label: 'Trash', icon: '🗑', render: renderTrash },
];

async function loadAll() {
  const [entries, options, budgets, trash] = await Promise.all([
    api.get('/api/entries'), api.get('/api/options'), api.get('/api/budgets'), api.get('/api/entries?trash=1'),
  ]);
  state.entries = entries;
  state.options = options;
  state.budgets = budgets;
  state.trash = trash;
}

function budgetMap() {
  const m = {};
  for (const b of state.budgets || []) m[`${b.scope}:${b.ref_key}`] = Number(b.amount);
  return m;
}

// ---------- aggregation ----------
function sumBy(entries, field) {
  const m = {};
  for (const e of entries) m[e[field]] = (m[e[field]] || 0) + Number(e.amount);
  return m;
}
function sortedPairs(obj) { return Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); }
function total(entries) { return entries.reduce((s, e) => s + Number(e.amount), 0); }

// ===================================================================
// SVG charts
// ===================================================================
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text) {
  const node = document.createElementNS(SVGNS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
}
function emptyBox(msg) { const w = document.createElement('div'); w.className = 'empty'; w.textContent = msg || 'No data yet'; return w; }

function donutChart(data) {
  const wrap = document.createElement('div');
  if (!data.length) return emptyBox();
  const size = 230, r = 90, ir = 56, cx = size / 2, cy = size / 2;
  const tot = data.reduce((s, d) => s + d.value, 0);
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: '230' });
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const frac = tot ? d.value / tot : 0;
    const a2 = angle + frac * Math.PI * 2;
    if (frac >= 0.9999) {
      svg.appendChild(el('circle', { cx, cy, r: (r + ir) / 2, fill: 'none', stroke: colorFor(i), 'stroke-width': r - ir }));
    } else if (frac > 0) {
      const large = a2 - angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const xi2 = cx + ir * Math.cos(a2), yi2 = cy + ir * Math.sin(a2);
      const xi1 = cx + ir * Math.cos(angle), yi1 = cy + ir * Math.sin(angle);
      const p = el('path', { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`, fill: colorFor(i) });
      p.appendChild(el('title', {}, `${d.name}: ${money(d.value)} (${((frac) * 100).toFixed(1)}%)`));
      svg.appendChild(p);
    }
    angle = a2;
  });
  svg.appendChild(el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'axis-text' }, 'Total'));
  svg.appendChild(el('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', 'font-size': '15', 'font-weight': '700', fill: 'currentColor' }, moneyShort(tot)));
  wrap.appendChild(svg);
  const legend = document.createElement('div');
  legend.className = 'legend';
  data.forEach((d, i) => {
    const item = document.createElement('div'); item.className = 'item';
    item.innerHTML = `<span class="dot" style="background:${colorFor(i)}"></span>${esc(d.name)} — ${money(d.value)}`;
    legend.appendChild(item);
  });
  wrap.appendChild(legend);
  return wrap;
}

function barChartH(data) {
  if (!data.length) return emptyBox();
  const wrap = document.createElement('div');
  const rowH = 34, padL = 150, padR = 70, padT = 6, w = 540;
  const h = padT * 2 + data.length * rowH;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = w - padL - padR;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: String(h) });
  data.forEach((d, i) => {
    const y = padT + i * rowH + 6;
    const bw = Math.max((d.value / max) * barW, 2);
    svg.appendChild(el('text', { x: padL - 8, y: y + 13, 'text-anchor': 'end', class: 'bar-label' }, d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name));
    const rect = el('rect', { x: padL, y, width: bw, height: 20, rx: 4, fill: colorFor(i) });
    rect.appendChild(el('title', {}, `${d.name}: ${money(d.value)}`));
    svg.appendChild(rect);
    svg.appendChild(el('text', { x: padL + bw + 6, y: y + 14, class: 'bar-val' }, moneyShort(d.value)));
  });
  wrap.appendChild(svg);
  return wrap;
}

function barChartV(data) {
  if (!data.length) return emptyBox();
  const wrap = document.createElement('div');
  const w = Math.max(540, data.length * 64), h = 290, padL = 56, padB = 38, padT = 16, padR = 16;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: String(h), preserveAspectRatio: 'xMidYMid meet' });
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (max / ticks) * t, y = padT + plotH - (val / max) * plotH;
    svg.appendChild(el('line', { x1: padL, y1: y, x2: w - padR, y2: y, class: 'axis-line' }));
    svg.appendChild(el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-text' }, moneyShort(val)));
  }
  const step = plotW / data.length, bw = Math.min(54, step - 18);
  data.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2, bh = (d.value / max) * plotH, y = padT + plotH - bh;
    const rect = el('rect', { x, y, width: bw, height: Math.max(bh, 1), rx: 4, fill: '#2563eb' });
    rect.appendChild(el('title', {}, `${d.label}: ${money(d.value)}`));
    svg.appendChild(rect);
    svg.appendChild(el('text', { x: x + bw / 2, y: h - padB + 16, 'text-anchor': 'middle', class: 'axis-text' }, d.label));
  });
  wrap.appendChild(svg);
  return wrap;
}

// Stacked vertical bars. data=[{label, parts:{key:val}}], keys ordered.
function stackedBarV(data, keys, colors) {
  if (!data.length) return emptyBox();
  const wrap = document.createElement('div');
  const w = Math.max(540, data.length * 64), h = 300, padL = 56, padB = 38, padT = 16, padR = 16;
  const totals = data.map((d) => keys.reduce((s, k) => s + (d.parts[k] || 0), 0));
  const max = Math.max(...totals, 1);
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: String(h), preserveAspectRatio: 'xMidYMid meet' });
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (max / ticks) * t, y = padT + plotH - (val / max) * plotH;
    svg.appendChild(el('line', { x1: padL, y1: y, x2: w - padR, y2: y, class: 'axis-line' }));
    svg.appendChild(el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-text' }, moneyShort(val)));
  }
  const step = plotW / data.length, bw = Math.min(54, step - 18);
  data.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    let yCursor = padT + plotH;
    keys.forEach((k) => {
      const val = d.parts[k] || 0;
      if (val <= 0) return;
      const bh = (val / max) * plotH;
      yCursor -= bh;
      const rect = el('rect', { x, y: yCursor, width: bw, height: bh, fill: colors[k] || '#94a3b8' });
      rect.appendChild(el('title', {}, `${d.label} · ${k}: ${money(val)}`));
      svg.appendChild(rect);
    });
    svg.appendChild(el('text', { x: x + bw / 2, y: h - padB + 16, 'text-anchor': 'middle', class: 'axis-text' }, d.label));
  });
  wrap.appendChild(svg);
  const legend = document.createElement('div'); legend.className = 'legend';
  keys.forEach((k) => { const it = document.createElement('div'); it.className = 'item'; it.innerHTML = `<span class="dot" style="background:${colors[k] || '#94a3b8'}"></span>${esc(k)}`; legend.appendChild(it); });
  wrap.appendChild(legend);
  return wrap;
}

// Area/line chart. data=[{label, value}]
function areaChart(data) {
  if (!data.length) return emptyBox();
  const wrap = document.createElement('div');
  const w = Math.max(540, data.length * 60), h = 280, padL = 56, padB = 36, padT = 16, padR = 16;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xAt = (i) => data.length > 1 ? padL + (i * plotW) / (data.length - 1) : padL + plotW / 2;
  const yAt = (v) => padT + plotH - (v / max) * plotH;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: String(h), preserveAspectRatio: 'xMidYMid meet' });
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (max / ticks) * t, y = yAt(val);
    svg.appendChild(el('line', { x1: padL, y1: y, x2: w - padR, y2: y, class: 'axis-line' }));
    svg.appendChild(el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-text' }, moneyShort(val)));
  }
  const pts = data.map((d, i) => `${xAt(i)},${yAt(d.value)}`);
  svg.appendChild(el('polygon', { points: `${padL},${padT + plotH} ${pts.join(' ')} ${padL + (data.length > 1 ? plotW : plotW / 2)},${padT + plotH}`, fill: '#2563eb', 'fill-opacity': '0.12' }));
  svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: '#2563eb', 'stroke-width': '2.5' }));
  data.forEach((d, i) => {
    const dot = el('circle', { cx: xAt(i), cy: yAt(d.value), r: 3.5, fill: '#2563eb' });
    dot.appendChild(el('title', {}, `${d.label}: ${money(d.value)}`));
    svg.appendChild(dot);
    if (data.length <= 18) svg.appendChild(el('text', { x: xAt(i), y: h - padB + 16, 'text-anchor': 'middle', class: 'axis-text' }, d.label));
  });
  wrap.appendChild(svg);
  return wrap;
}

// HTML progress-bar list. items=[{name, actual, budget}]
function progressList(items) {
  const wrap = document.createElement('div');
  if (!items.length) return emptyBox('No budgets set yet');
  for (const it of items) {
    const budget = Number(it.budget) || 0;
    const actual = Number(it.actual) || 0;
    const pct = budget > 0 ? (actual / budget) * 100 : (actual > 0 ? 100 : 0);
    const cls = budget === 0 ? '' : pct > 100 ? 'over' : pct >= 85 ? 'warn' : 'ok';
    const remaining = budget - actual;
    const row = document.createElement('div'); row.className = 'prog-row';
    row.innerHTML = `
      <div class="prog-top">
        <span class="prog-name">${esc(it.name)}</span>
        <span class="prog-vals"><b>${money(actual)}</b>${budget > 0 ? ` / ${money(budget)}` : ' spent'}${budget > 0 ? ` · <span class="${remaining < 0 ? 'prog-pct over' : ''}">${remaining < 0 ? 'over by ' + money(-remaining) : money(remaining) + ' left'}</span>` : ''}</span>
      </div>
      <div class="prog-track"><div class="prog-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
      ${budget > 0 ? `<div class="prog-pct ${pct > 100 ? 'over' : 'muted'}" style="text-align:right">${pct.toFixed(0)}% of budget</div>` : ''}`;
    wrap.appendChild(row);
  }
  return wrap;
}

// ===================================================================
// Shared view helpers
// ===================================================================
function pageHead(title, subtitle, actionsHtml = '') {
  return `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div><div class="head-actions">${actionsHtml}</div></div>`;
}
function errorBanner(msg) { return `<div class="error-banner">${esc(msg)}</div>`; }
function periodControl() {
  return `<div class="segmented" id="periodCtl">${PERIODS.map((p) => `<button data-period="${p.key}" class="${state.period === p.key ? 'active' : ''}">${p.label}</button>`).join('')}</div>`;
}
function wirePeriodControl(view) {
  const ctl = view.querySelector('#periodCtl');
  if (!ctl) return;
  ctl.querySelectorAll('button').forEach((b) => { b.onclick = () => { state.period = b.dataset.period; renderRoute(); }; });
}

// ===================================================================
// Dashboard
// ===================================================================
function renderDashboard(view) {
  const all = state.entries;
  const scoped = all.filter((e) => inPeriod(e, state.period));
  const bm = budgetMap();

  const totalAll = total(all);
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = all.filter((e) => monthKey(e.entry_date) === thisKey).reduce((s, e) => s + Number(e.amount), 0);
  const overallBudget = bm['overall:ALL'] || 0;
  const notPaid = all.filter((e) => e.status !== 'Paid').reduce((s, e) => s + Number(e.amount), 0);
  const budgetPct = overallBudget > 0 ? (totalAll / overallBudget) * 100 : 0;

  // monthly totals for the scoped period
  const monthMap = {};
  for (const e of scoped) {
    const k = monthKey(e.entry_date);
    monthMap[k] = (monthMap[k] || 0) + Number(e.amount);
  }
  const months = Object.keys(monthMap).sort();
  const monthly = months.map((k) => ({ label: monthLabel(k), value: monthMap[k] }));

  const recent = [...all].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date) || b.id - a.id).slice(0, 6);

  view.innerHTML =
    pageHead('Dashboard', 'Project cost overview — all figures in USD', `<button class="btn primary" id="addBtn">+ Add Entry</button>`) +
    `<div class="cards">
      <div class="card"><div class="label">Total Spent</div><div class="value green">${money(totalAll)}</div><div class="hint">${all.length} entries · all time</div></div>
      <div class="card"><div class="label">Spent This Month</div><div class="value red">${money(thisMonth)}</div><div class="hint">${monthLabel(thisKey)}</div></div>
      <div class="card"><div class="label">Overall Budget</div><div class="value brand">${overallBudget > 0 ? money(overallBudget - totalAll) : '—'}</div><div class="hint">${overallBudget > 0 ? `${budgetPct.toFixed(0)}% used · ${money(totalAll)} of ${money(overallBudget)}` : 'Set a budget on the Budgets page'}</div></div>
      <div class="card"><div class="label">Pending + Committed</div><div class="value amber">${money(notPaid)}</div><div class="hint">Not yet paid</div></div>
    </div>

    ${overallBudget > 0 ? `<div class="panel"><h3>Overall budget usage</h3><div id="ovBudget"></div></div>` : ''}

    <div class="toolbar"><span class="muted" style="font-weight:600">Charts period:</span>${periodControl()}<div class="spacer"></div><span class="muted">${scoped.length} of ${all.length} entries · ${money(total(scoped))}</span></div>

    <div class="panel"><h3>Spend by Cost Category</h3><div id="catChart"></div></div>
    <div class="panel"><h3>Spend by Workstream</h3><div id="wsChart"></div></div>
    <div class="panel"><h3>Monthly Spend</h3><div id="monthChart"></div></div>

    <div class="panel"><h3>Recent transactions <a href="#/transactions" class="link-btn" style="font-weight:600">View all →</a></h3>
      <table><thead><tr><th>Date</th><th>Description</th><th>Workstream</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${recent.length ? recent.map((e) => `<tr><td style="white-space:nowrap">${formatDate(e.entry_date)}</td><td>${esc(e.description)}</td><td>${esc(e.workstream)}</td><td><span class="${statusClass(e.status)}">${esc(e.status || 'Paid')}</span></td><td class="num amount red">${money(e.amount)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No entries yet</td></tr>'}</tbody></table>
    </div>`;

  if (overallBudget > 0) view.querySelector('#ovBudget').appendChild(progressList([{ name: 'Total project spend', actual: totalAll, budget: overallBudget }]));
  view.querySelector('#catChart').appendChild(donutChart(sortedPairs(sumBy(scoped, 'cost_category'))));
  view.querySelector('#wsChart').appendChild(barChartH(sortedPairs(sumBy(scoped, 'workstream'))));
  view.querySelector('#monthChart').appendChild(barChartV(monthly));

  view.querySelector('#addBtn').onclick = () => openEntryModal(null);
  wirePeriodControl(view);
}

// ===================================================================
// Transactions
// ===================================================================
function filteredTx() {
  const q = state.q.trim().toLowerCase();
  let rows = state.entries.filter((e) =>
    (!state.filterWorkstream || e.workstream === state.filterWorkstream) &&
    (!state.filterCategory || e.cost_category === state.filterCategory) &&
    (!state.filterStatus || (e.status || 'Paid') === state.filterStatus) &&
    (!state.filterStaff || e.staff === state.filterStaff) &&
    (!state.fromDate || toDateInput(e.entry_date) >= state.fromDate) &&
    (!state.toDate || toDateInput(e.entry_date) <= state.toDate) &&
    (!q || [e.description, e.notes, e.reference, e.workstream, e.cost_category, e.staff].some((f) => String(f || '').toLowerCase().includes(q)))
  );
  rows.sort((a, b) => {
    let cmp;
    if (state.sortKey === 'amount') cmp = Number(a.amount) - Number(b.amount);
    else if (state.sortKey === 'desc') cmp = String(a.description).localeCompare(String(b.description));
    else cmp = new Date(a.entry_date) - new Date(b.entry_date);
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function renderTransactions(view) {
  const o = state.options;
  const rows = filteredTx();
  const ftotal = rows.reduce((s, e) => s + Number(e.amount), 0);
  const hasFilters = state.q || state.filterWorkstream || state.filterCategory || state.filterStatus || state.filterStaff || state.fromDate || state.toDate;
  const arrow = (k) => (state.sortKey === k ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const opt = (sel, val, label) => `<option value="${esc(val)}"${sel === val ? ' selected' : ''}>${esc(label)}</option>`;

  view.innerHTML =
    pageHead('Transactions', 'All recorded cost entries', `<button class="btn" id="exportBtn">⬇ Export CSV</button><button class="btn primary" id="addBtn">+ Add Entry</button>`) +
    `<div class="toolbar">
      <input class="search" id="q" placeholder="Search description, notes, ref…" value="${esc(state.q)}" />
      <select id="fWs"><option value="">All Workstreams</option>${o.workstreams.map((w) => opt(state.filterWorkstream, w.name, w.name)).join('')}</select>
      <select id="fCat"><option value="">All Categories</option>${o.categories.map((c) => opt(state.filterCategory, c.name, c.name)).join('')}</select>
      <select id="fStaff"><option value="">All Staff</option>${o.staff.map((s) => opt(state.filterStaff, s.name, s.name)).join('')}</select>
      <select id="fStatus"><option value="">Any Status</option>${o.statuses.map((s) => opt(state.filterStatus, s, s)).join('')}</select>
    </div>
    <div class="toolbar">
      <span class="muted">From</span><input type="date" id="fFrom" value="${esc(state.fromDate)}" />
      <span class="muted">to</span><input type="date" id="fTo" value="${esc(state.toDate)}" />
      ${hasFilters ? '<button class="link-btn" id="clearF">Clear all filters</button>' : ''}
      <div class="spacer"></div>
      <span class="muted">${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · <strong style="color:var(--text)">${money(ftotal)}</strong></span>
    </div>
    <table>
      <thead><tr>
        <th class="sortable" data-sort="date">Date${arrow('date')}</th>
        <th class="sortable" data-sort="desc">Description${arrow('desc')}</th>
        <th>Workstream</th><th>Category</th><th>Paid to</th><th>Status</th>
        <th class="num sortable" data-sort="amount">Amount${arrow('amount')}</th><th></th>
      </tr></thead>
      <tbody>${rows.length === 0
      ? `<tr><td colspan="8" class="empty">${hasFilters ? 'No entries match the current filters.' : 'No cost entries yet. Click “Add Entry” to start.'}</td></tr>`
      : rows.map((e) => `<tr>
          <td style="white-space:nowrap">${formatDate(e.entry_date)}</td>
          <td>${esc(e.description)}${e.reference ? `<div class="muted" style="font-size:12px">Ref: ${esc(e.reference)}</div>` : ''}${e.notes ? `<div class="muted" style="font-size:12px">${esc(e.notes)}</div>` : ''}</td>
          <td>${esc(e.workstream)}</td>
          <td><span class="badge gray">${esc(e.cost_category)}</span></td>
          <td>${e.staff ? esc(e.staff) : '<span class="muted">—</span>'}</td>
          <td><span class="${statusClass(e.status)}">${esc(e.status || 'Paid')}</span></td>
          <td class="num amount red">${money(e.amount)}</td>
          <td class="num" style="white-space:nowrap"><button class="link-btn" data-edit="${e.id}">Edit</button>&nbsp;&nbsp;<button class="link-btn danger" data-del="${e.id}">Delete</button></td>
        </tr>`).join('')}</tbody>
    </table>`;

  const reRender = () => renderRoute();
  view.querySelector('#addBtn').onclick = () => openEntryModal(null);
  view.querySelector('#exportBtn').onclick = () => {
    const header = ['Date', 'Description', 'Amount (USD)', 'Workstream', 'Cost Category', 'Paid to', 'Status', 'Reference', 'Notes'];
    const data = rows.map((e) => [toDateInput(e.entry_date), e.description, Number(e.amount).toFixed(2), e.workstream, e.cost_category, e.staff || '', e.status || 'Paid', e.reference || '', e.notes || '']);
    downloadCSV('cost-entries.csv', [header, ...data]);
  };
  const qEl = view.querySelector('#q');
  qEl.oninput = (ev) => { state.q = ev.target.value; const r = filteredTx(); /* light refresh */ };
  qEl.onchange = (ev) => { state.q = ev.target.value; reRender(); };
  qEl.onkeydown = (ev) => { if (ev.key === 'Enter') { state.q = ev.target.value; reRender(); } };
  view.querySelector('#fWs').onchange = (ev) => { state.filterWorkstream = ev.target.value; reRender(); };
  view.querySelector('#fCat').onchange = (ev) => { state.filterCategory = ev.target.value; reRender(); };
  view.querySelector('#fStaff').onchange = (ev) => { state.filterStaff = ev.target.value; reRender(); };
  view.querySelector('#fStatus').onchange = (ev) => { state.filterStatus = ev.target.value; reRender(); };
  view.querySelector('#fFrom').onchange = (ev) => { state.fromDate = ev.target.value; reRender(); };
  view.querySelector('#fTo').onchange = (ev) => { state.toDate = ev.target.value; reRender(); };
  const clearF = view.querySelector('#clearF');
  if (clearF) clearF.onclick = () => { state.q = state.filterWorkstream = state.filterCategory = state.filterStatus = state.filterStaff = state.fromDate = state.toDate = ''; reRender(); };
  view.querySelectorAll('th[data-sort]').forEach((th) => {
    th.onclick = () => { const k = th.dataset.sort; if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = k; state.sortDir = 'desc'; } reRender(); };
  });
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openEntryModal(state.entries.find((e) => String(e.id) === b.dataset.edit)); });
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteEntry(state.entries.find((e) => String(e.id) === b.dataset.del)); });
}

async function deleteEntry(entry) {
  if (!entry) return;
  if (!confirm(`Move "${entry.description}" to Trash? You can restore it for 30 days from the Trash page.`)) return;
  try { await api.del(`/api/entries/${entry.id}`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); }
}

// ===================================================================
// Budgets
// ===================================================================
function renderBudgets(view) {
  const o = state.options;
  const all = state.entries;
  const bm = budgetMap();
  const totalAll = total(all);
  const overall = bm['overall:ALL'] || 0;

  const byWs = sumBy(all, 'workstream');
  const byCat = sumBy(all, 'cost_category');

  const sumBudgets = (scope, names) => names.reduce((s, n) => s + (bm[`${scope}:${n}`] || 0), 0);
  const wsBudgetTotal = sumBudgets('workstream', o.workstreams.map((w) => w.name));
  const catBudgetTotal = sumBudgets('category', o.categories.map((c) => c.name));

  const editorRow = (scope, name, actual) => {
    const b = bm[`${scope}:${name}`] || 0;
    const pct = b > 0 ? (actual / b) * 100 : (actual > 0 ? 100 : 0);
    const cls = b === 0 ? '' : pct > 100 ? 'over' : pct >= 85 ? 'warn' : 'ok';
    const remaining = b - actual;
    return `<div class="prog-row" data-scope="${scope}" data-name="${esc(name)}">
      <div class="prog-top">
        <span class="prog-name">${esc(name)}</span>
        <span class="prog-vals"><b>${money(actual)}</b>${b > 0 ? ` / ${money(b)} · <span class="${remaining < 0 ? 'prog-pct over' : ''}">${remaining < 0 ? 'over ' + money(-remaining) : money(remaining) + ' left'}</span>` : ' spent'}</span>
      </div>
      <div class="prog-track"><div class="prog-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span class="muted" style="font-size:12px">Budget $</span>
        <input type="number" min="0" step="0.01" value="${b || ''}" placeholder="0.00" data-budget-input style="width:140px" />
        <button class="btn small" data-budget-save>Save</button>
        ${b > 0 ? `<button class="link-btn danger" data-budget-clear>Clear</button>` : ''}
        <span class="spacer" style="flex:1"></span>
        ${b > 0 ? `<span class="prog-pct ${pct > 100 ? 'over' : 'muted'}">${pct.toFixed(0)}% used</span>` : ''}
      </div>
    </div>`;
  };

  view.innerHTML =
    pageHead('Budgets', 'Set budget targets and track spend against them', `<button class="btn no-print" onclick="window.print()">🖨 Print</button>`) +
    `<div class="cards">
      <div class="card"><div class="label">Overall Budget</div><div class="value brand">${overall ? money(overall) : '—'}</div><div class="hint">${overall ? money(overall - totalAll) + ' remaining' : 'Not set'}</div></div>
      <div class="card"><div class="label">Total Spent</div><div class="value red">${money(totalAll)}</div><div class="hint">${overall ? ((totalAll / overall) * 100).toFixed(0) + '% of overall budget' : 'all time'}</div></div>
      <div class="card"><div class="label">Workstream Budgets</div><div class="value">${money(wsBudgetTotal)}</div><div class="hint">across all workstreams</div></div>
      <div class="card"><div class="label">Category Budgets</div><div class="value">${money(catBudgetTotal)}</div><div class="hint">across all categories</div></div>
    </div>

    <div class="panel"><h3>Overall project budget</h3><p class="sub">The total approved budget for the whole project.</p>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="muted">Budget $</span>
        <input type="number" min="0" step="0.01" id="overallInput" value="${overall || ''}" placeholder="0.00" style="width:200px" />
        <button class="btn primary" id="overallSave">Save</button>
        ${overall ? '<button class="link-btn danger" id="overallClear">Clear</button>' : ''}
      </div>
      <div style="margin-top:14px" id="overallProg"></div>
    </div>

    <div class="panel"><h3>Budget by Workstream</h3><div id="wsBudgets"></div></div>
    <div class="panel"><h3>Budget by Cost Category</h3><div id="catBudgets"></div></div>`;

  if (overall) view.querySelector('#overallProg').appendChild(progressList([{ name: 'Total project spend', actual: totalAll, budget: overall }]));
  view.querySelector('#wsBudgets').innerHTML = o.workstreams.map((w) => editorRow('workstream', w.name, byWs[w.name] || 0)).join('');
  view.querySelector('#catBudgets').innerHTML = o.categories.map((c) => editorRow('category', c.name, byCat[c.name] || 0)).join('');

  // overall handlers
  const saveBudget = async (scope, refKey, amount) => {
    try { await api.post('/api/budgets', { scope, ref_key: refKey, amount }); await loadAll(); renderRoute(); }
    catch (err) { alert(err.message); }
  };
  const clearBudget = async (scope, refKey) => {
    const b = (state.budgets || []).find((x) => x.scope === scope && x.ref_key === refKey);
    if (!b) return;
    try { await api.del(`/api/budgets/${b.id}`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); }
  };
  view.querySelector('#overallSave').onclick = () => saveBudget('overall', 'ALL', Number(view.querySelector('#overallInput').value) || 0);
  const ovClear = view.querySelector('#overallClear');
  if (ovClear) ovClear.onclick = () => clearBudget('overall', 'ALL');

  view.querySelectorAll('.prog-row[data-scope]').forEach((row) => {
    const scope = row.dataset.scope, name = row.dataset.name;
    const input = row.querySelector('[data-budget-input]');
    const saveB = row.querySelector('[data-budget-save]');
    const clearB = row.querySelector('[data-budget-clear]');
    if (saveB) saveB.onclick = () => saveBudget(scope, name, Number(input.value) || 0);
    if (input) input.onkeydown = (ev) => { if (ev.key === 'Enter') saveBudget(scope, name, Number(input.value) || 0); };
    if (clearB) clearB.onclick = () => clearBudget(scope, name);
  });
}

// ===================================================================
// Reports
// ===================================================================
function renderReports(view) {
  const o = state.options;
  const scoped = state.entries.filter((e) => inPeriod(e, state.period));
  const bm = budgetMap();

  // monthly + cumulative
  const monthMap = {};
  for (const e of scoped) {
    const k = monthKey(e.entry_date);
    monthMap[k] = (monthMap[k] || 0) + Number(e.amount);
  }
  const months = Object.keys(monthMap).sort();
  const monthly = months.map((k) => ({ label: monthLabel(k), value: monthMap[k] }));
  let run = 0; const cumulative = months.map((k) => ({ label: monthLabel(k), value: (run += monthMap[k]) }));

  // budget vs actual
  const byWs = sumBy(scoped, 'workstream'), byCat = sumBy(scoped, 'cost_category');
  const bvaRows = [];
  o.workstreams.forEach((w) => bm[`workstream:${w.name}`] && bvaRows.push({ scope: 'Workstream', name: w.name, actual: byWs[w.name] || 0, budget: bm[`workstream:${w.name}`] }));
  o.categories.forEach((c) => bm[`category:${c.name}`] && bvaRows.push({ scope: 'Category', name: c.name, actual: byCat[c.name] || 0, budget: bm[`category:${c.name}`] }));

  // by status
  const byStatus = sumBy(scoped, 'status');
  // top 10
  const top = [...scoped].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10);
  // pivot
  const pmap = {};
  for (const e of scoped) {
    const key = `${e.workstream}||${e.cost_category}`;
    if (!pmap[key]) pmap[key] = { workstream: e.workstream, cost_category: e.cost_category, total: 0, count: 0 };
    pmap[key].total += Number(e.amount); pmap[key].count += 1;
  }
  const pivot = Object.values(pmap).sort((a, b) => a.workstream.localeCompare(b.workstream) || a.cost_category.localeCompare(b.cost_category));
  const grand = pivot.reduce((s, r) => s + r.total, 0);
  const grandCount = pivot.reduce((s, r) => s + r.count, 0);

  view.innerHTML =
    pageHead('Reports', 'Trends, budget performance and detailed breakdowns',
      `<button class="btn no-print" id="exportPivot">⬇ Export breakdown</button><button class="btn no-print" onclick="window.print()">🖨 Print</button>`) +
    `<div class="toolbar no-print"><span class="muted" style="font-weight:600">Period:</span>${periodControl()}<div class="spacer"></div><span class="muted">${scoped.length} entries · ${money(total(scoped))}</span></div>

    <div class="panel-grid">
      <div class="panel"><h3>Monthly Spend</h3><div id="rMonth"></div></div>
      <div class="panel"><h3>Cumulative Spend</h3><div id="rCum"></div></div>
    </div>

    <div class="panel"><h3>Budget vs Actual</h3><p class="sub">Only scopes with a budget set are shown. Manage budgets on the Budgets page.</p>
      ${bvaRows.length ? `<table><thead><tr><th>Scope</th><th>Target</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th><th class="num">Used</th></tr></thead>
      <tbody>${bvaRows.map((r) => { const v = r.budget - r.actual; const pct = r.budget > 0 ? (r.actual / r.budget) * 100 : 0; return `<tr><td><span class="badge gray">${esc(r.scope)}</span></td><td>${esc(r.name)}</td><td class="num amount">${money(r.budget)}</td><td class="num amount">${money(r.actual)}</td><td class="num amount ${v < 0 ? 'red' : 'green'}">${v < 0 ? '-' : ''}${money(Math.abs(v))}</td><td class="num ${pct > 100 ? '' : 'muted'}" style="${pct > 100 ? 'color:var(--red);font-weight:600' : ''}">${pct.toFixed(0)}%</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No budgets set. Go to the Budgets page to add targets.</div>'}
    </div>

    <div class="panel-grid">
      <div class="panel"><h3>Spend by Payment Status</h3><div id="rStatus"></div></div>
      <div class="panel"><h3>Top 10 Largest Expenses</h3>
        ${top.length ? `<table><thead><tr><th>Description</th><th>Workstream</th><th class="num">Amount</th></tr></thead><tbody>${top.map((e) => `<tr><td>${esc(e.description)}<div class="muted" style="font-size:12px">${formatDate(e.entry_date)} · ${esc(e.workstream)}</div></td><td>${esc(e.workstream)}</td><td class="num amount red">${money(e.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data yet</div>'}
      </div>
    </div>

    <div class="section-title">Breakdown by Workstream × Category</div>
    <table>
      <thead><tr><th>Workstream</th><th>Cost Category</th><th class="num">Entries</th><th class="num">Total</th><th class="num">% of Total</th></tr></thead>
      <tbody>${pivot.length === 0 ? '<tr><td colspan="5" class="empty">No cost entries in this period.</td></tr>'
      : pivot.map((r) => `<tr><td>${esc(r.workstream)}</td><td>${esc(r.cost_category)}</td><td class="num">${r.count}</td><td class="num amount">${money(r.total)}</td><td class="num muted">${grand ? ((r.total / grand) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('')}</tbody>
      ${pivot.length ? `<tfoot><tr><td colspan="2">Grand Total</td><td class="num">${grandCount}</td><td class="num amount green">${money(grand)}</td><td class="num muted">100%</td></tr></tfoot>` : ''}
    </table>`;

  view.querySelector('#rMonth').appendChild(barChartV(monthly));
  view.querySelector('#rCum').appendChild(areaChart(cumulative));
  view.querySelector('#rStatus').appendChild(donutChart(sortedPairs(byStatus)));

  view.querySelector('#exportPivot').onclick = () => {
    const header = ['Workstream', 'Cost Category', 'Entries', 'Total (USD)', '% of Total'];
    const data = pivot.map((r) => [r.workstream, r.cost_category, r.count, r.total.toFixed(2), grand ? ((r.total / grand) * 100).toFixed(1) + '%' : '0%']);
    data.push(['Grand Total', '', grandCount, grand.toFixed(2), '100%']);
    downloadCSV('cost-breakdown.csv', [header, ...data]);
  };
  wirePeriodControl(view);
}

// ===================================================================
// Categories
// ===================================================================
function renderCategories(view) {
  const o = state.options;
  const listHtml = (title, kind, items) => `
    <div class="panel"><h3>${title}</h3>
      <table><tbody id="list-${kind}">${items.length === 0 ? '<tr><td class="empty">None yet</td></tr>'
      : items.map((it) => `<tr data-id="${it.id}"><td class="opt-name">${esc(it.name)}</td><td class="num" style="white-space:nowrap;width:1px"><button class="link-btn" data-rename="${it.id}">Rename</button>&nbsp;&nbsp;<button class="link-btn danger" data-delopt="${it.id}">Delete</button></td></tr>`).join('')}</tbody></table>
      <form class="add-opt" data-kind="${kind}" style="display:flex;gap:8px;margin-top:14px"><input name="name" placeholder="Add ${title.toLowerCase().replace(/s$/, '')}…" style="flex:1" /><button class="btn primary" type="submit">Add</button></form>
    </div>`;

  view.innerHTML =
    pageHead('Categories', 'Manage the workstream, cost category, and staff options') +
    `<div class="notice">Payment statuses (Paid, Pending, Committed) are fixed. You can freely add, rename, or remove workstreams, cost categories, and staff — renaming updates existing entries, and an option can only be deleted once no entries use it.</div>
     <div class="panel-grid">${listHtml('Workstreams', 'workstream', o.workstreams)}${listHtml('Cost Categories', 'category', o.categories)}${listHtml('Staff (paid to)', 'staff', o.staff)}</div>`;

  view.querySelectorAll('form.add-opt').forEach((form) => {
    form.onsubmit = async (ev) => { ev.preventDefault(); const name = form.name.value.trim(); if (!name) return; try { await api.post('/api/options', { kind: form.dataset.kind, name }); await loadAll(); renderRoute(); } catch (err) { alert(err.message); } };
  });
  view.querySelectorAll('[data-delopt]').forEach((b) => {
    b.onclick = async () => { const id = b.dataset.delopt; const name = b.closest('tr').querySelector('.opt-name').textContent; if (!confirm(`Delete "${name}"?`)) return; try { await api.del(`/api/options/${id}`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); } };
  });
  view.querySelectorAll('[data-rename]').forEach((b) => {
    b.onclick = () => {
      const tr = b.closest('tr'), cell = tr.querySelector('.opt-name'), current = cell.textContent;
      cell.innerHTML = `<input value="${esc(current)}" style="width:100%" />`;
      const input = cell.querySelector('input'); input.focus();
      const save = async () => { const name = input.value.trim(); if (!name || name === current) { renderRoute(); return; } try { await api.put(`/api/options/${b.dataset.rename}`, { name }); await loadAll(); renderRoute(); } catch (err) { alert(err.message); renderRoute(); } };
      input.onkeydown = (ev) => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') renderRoute(); };
      input.onblur = save;
    };
  });
}

// Inline "+ New" buttons next to the Workstream / Cost Category dropdowns —
// lets you create a new option without leaving the entry form.
function wireAddOptionButtons(form) {
  form.querySelectorAll('.add-opt-btn').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.open) return;
      btn.dataset.open = '1';
      const kind = btn.dataset.kind;
      const select = form.querySelector(`[name="${btn.dataset.target}"]`);
      const label = btn.closest('label.field');
      const panel = document.createElement('div');
      panel.className = 'field full inline-add';
      panel.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;padding:8px">
          <input placeholder="New ${kind === 'workstream' ? 'workstream' : kind === 'category' ? 'cost category' : 'staff member'} name" />
          <button type="button" class="btn primary small" data-add>Add</button>
          <button type="button" class="btn small" data-cancel>Cancel</button>
        </div>
        <div class="inline-err"></div>`;
      label.insertAdjacentElement('afterend', panel);
      const input = panel.querySelector('input');
      input.focus();
      const cleanup = () => { panel.remove(); delete btn.dataset.open; };
      panel.querySelector('[data-cancel]').onclick = cleanup;
      const addBtn = panel.querySelector('[data-add]');
      const doAdd = async () => {
        const name = input.value.trim();
        if (!name) return;
        addBtn.disabled = true; addBtn.textContent = 'Adding…';
        try {
          const created = await api.post('/api/options', { kind, name });
          const listKey = kind === 'workstream' ? 'workstreams' : kind === 'category' ? 'categories' : 'staff';
          state.options[listKey].push(created);
          state.options[listKey].sort((a, b) => a.name.localeCompare(b.name));
          const opt = document.createElement('option');
          opt.value = created.name; opt.textContent = created.name;
          select.appendChild(opt);
          select.value = created.name;
          cleanup();
        } catch (err) {
          panel.querySelector('.inline-err').innerHTML = errorBanner(err.message);
          addBtn.disabled = false; addBtn.textContent = 'Add';
        }
      };
      addBtn.onclick = doAdd;
      input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doAdd(); } if (ev.key === 'Escape') cleanup(); };
    };
  });
}

// ===================================================================
// Add / Edit entry modal
// ===================================================================
function openEntryModal(entry) {
  const o = state.options;
  const editing = Boolean(entry && entry.id);
  const cur = editing
    ? { description: entry.description, amount: entry.amount, entry_date: toDateInput(entry.entry_date), workstream: entry.workstream, cost_category: entry.cost_category, staff: entry.staff || '', status: entry.status || 'Paid', reference: entry.reference || '', notes: entry.notes || '' }
    : { description: '', amount: '', entry_date: new Date().toISOString().slice(0, 10), workstream: o.workstreams[0]?.name || '', cost_category: o.categories[0]?.name || '', staff: '', status: 'Paid', reference: '', notes: '' };
  const optTag = (val, sel) => `<option value="${esc(val)}"${val === sel ? ' selected' : ''}>${esc(val)}</option>`;
  const optBlank = (sel) => `<option value=""${sel === '' ? ' selected' : ''}>— None —</option>`;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="overlay">
      <form class="modal" id="entryForm">
        <h2>${editing ? 'Edit cost entry' : 'Add cost entry'}</h2>
        <div id="formErr"></div>
        <div class="form-grid">
          <label class="field full">Description<input name="description" value="${esc(cur.description)}" placeholder="e.g. SOMGEG Lab - Soil Testing Batch 1" required /></label>
          <label class="field">Amount (USD)<input name="amount" type="number" step="0.01" min="0" value="${esc(cur.amount)}" placeholder="0.00" required /></label>
          <label class="field">Date<input name="entry_date" type="date" value="${esc(cur.entry_date)}" required /></label>
          <label class="field">Status<select name="status">${o.statuses.map((s) => optTag(s, cur.status)).join('')}</select></label>
          <label class="field">Paid to (staff)<div class="select-add"><select name="staff">${optBlank(cur.staff)}${o.staff.map((s) => optTag(s.name, cur.staff)).join('')}</select><button type="button" class="btn small add-opt-btn" data-kind="staff" data-target="staff" title="Add a new staff member">+ New</button></div></label>
          <label class="field">Workstream<div class="select-add"><select name="workstream" required>${o.workstreams.map((w) => optTag(w.name, cur.workstream)).join('')}</select><button type="button" class="btn small add-opt-btn" data-kind="workstream" data-target="workstream" title="Add a new workstream">+ New</button></div></label>
          <label class="field">Cost Category<div class="select-add"><select name="cost_category" required>${o.categories.map((c) => optTag(c.name, cur.cost_category)).join('')}</select><button type="button" class="btn small add-opt-btn" data-kind="category" data-target="cost_category" title="Add a new cost category">+ New</button></div></label>
          <label class="field full">Reference / Invoice no. (optional)<input name="reference" value="${esc(cur.reference)}" placeholder="e.g. INV-2026-014" /></label>
          <label class="field full">Notes / remarks (optional)<textarea name="notes" rows="2" placeholder="Optional remarks…">${esc(cur.notes)}</textarea></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelBtn">Cancel</button>
          <button type="submit" class="btn primary" id="saveBtn">${editing ? 'Save changes' : 'Add entry'}</button>
        </div>
      </form>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('cancelBtn').onclick = close;
  document.getElementById('overlay').onmousedown = (ev) => { if (ev.target.id === 'overlay') close(); };
  wireAddOptionButtons(document.getElementById('entryForm'));
  document.getElementById('entryForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const payload = { description: f.description.value, amount: f.amount.value, entry_date: f.entry_date.value, workstream: f.workstream.value, cost_category: f.cost_category.value, staff: f.staff.value || null, status: f.status.value, reference: f.reference.value, notes: f.notes.value };
    const saveBtn = document.getElementById('saveBtn'); saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (editing) await api.put(`/api/entries/${entry.id}`, payload); else await api.post('/api/entries', payload);
      close(); await loadAll(); renderRoute();
    } catch (err) {
      document.getElementById('formErr').innerHTML = errorBanner(err.message);
      saveBtn.disabled = false; saveBtn.textContent = editing ? 'Save changes' : 'Add entry';
    }
  };
}

// ===================================================================
// Staff — what each person has taken from the project budget
// ===================================================================
function renderStaff(view) {
  const o = state.options;
  const all = state.entries;
  const scoped = all.filter((e) => inPeriod(e, state.period));
  const bm = budgetMap();
  const overallBudget = bm['overall:ALL'] || 0;
  const scopedTotal = total(scoped);

  // Totals per staff member (within the selected period).
  const byStaff = sumBy(scoped.filter((e) => e.staff), 'staff');
  const staffRows = o.staff
    .map((s) => ({ name: s.name, total: byStaff[s.name] || 0, count: scoped.filter((e) => e.staff === s.name).length }))
    .sort((a, b) => b.total - a.total);
  const untagged = scoped.filter((e) => !e.staff);
  const untaggedTotal = total(untagged);
  const takenTotal = Object.values(byStaff).reduce((s, n) => s + n, 0);

  view.innerHTML =
    pageHead('Staff', 'How much each person has taken from the project budget',
      `<button class="btn primary" id="addBtn">+ Add Entry</button>`) +
    `<div class="cards">
      <div class="card"><div class="label">Taken by Staff</div><div class="value red">${money(takenTotal)}</div><div class="hint">${scopedTotal ? ((takenTotal / scopedTotal) * 100).toFixed(0) + '% of period spend' : 'none tagged'} · ${staffRows.length} people</div></div>
      <div class="card"><div class="label">Untagged Spend</div><div class="value amber">${money(untaggedTotal)}</div><div class="hint">${untagged.length} entries · no staff assigned</div></div>
      <div class="card"><div class="label">Overall Budget</div><div class="value brand">${overallBudget > 0 ? money(overallBudget - takenTotal) : '—'}</div><div class="hint">${overallBudget > 0 ? money(takenTotal) + ' taken of ' + money(overallBudget) : 'Set a budget on the Budgets page'}</div></div>
    </div>

    ${staffRows.length === 0 && o.staff.length === 0
      ? `<div class="notice">No staff members yet. Add people (yourself and anyone else) on the <a href="#/categories" class="link-btn">Categories page</a>, or use “+ New” in the entry form’s “Paid to” field.</div>`
      : `<div class="toolbar"><span class="muted" style="font-weight:600">Period:</span>${periodControl()}<div class="spacer"></div><span class="muted">${scoped.length} entries · ${money(scopedTotal)}</span></div>

    <div class="panel-grid">
      <div class="panel"><h3>Spend by Staff</h3><div id="staffChart"></div></div>
      <div class="panel"><h3>Per-person totals</h3>
        ${staffRows.length ? `<table><thead><tr><th>Staff member</th><th class="num">Entries</th><th class="num">Total taken</th>${overallBudget > 0 ? '<th class="num">% of budget</th>' : ''}</tr></thead>
        <tbody>${staffRows.map((r) => `<tr><td><span class="badge gray">${esc(r.name)}</span></td><td class="num">${r.count}</td><td class="num amount red">${money(r.total)}</td>${overallBudget > 0 ? `<td class="num muted">${((r.total / overallBudget) * 100).toFixed(1)}%</td>` : ''}</tr>`).join('')}
        ${untaggedTotal > 0 ? `<tr><td><span class="muted">No staff</span></td><td class="num">${untagged.length}</td><td class="num amount muted">${money(untaggedTotal)}</td>${overallBudget > 0 ? `<td class="num muted">${((untaggedTotal / overallBudget) * 100).toFixed(1)}%</td>` : ''}</tr>` : ''}
        <tr style="border-top:2px solid var(--border)"><td><strong>Total</strong></td><td class="num"><strong>${scoped.length}</strong></td><td class="num amount"><strong>${money(scopedTotal)}</strong></td>${overallBudget > 0 ? `<td class="num"><strong>${scopedTotal ? ((scopedTotal / overallBudget) * 100).toFixed(1) : '0.0'}%</strong></td>` : ''}</tr></tbody></table>` : '<div class="empty">No tagged spend in this period.</div>'}
      </div>
    </div>`}`;

  if (staffRows.length) view.querySelector('#staffChart').appendChild(donutChart(sortedPairs(byStaff)));
  view.querySelector('#addBtn').onclick = () => openEntryModal(null);
  wirePeriodControl(view);
}

// ===================================================================
// Trash — restore soft-deleted entries (auto-purged after 30 days)
// ===================================================================
const RETENTION_DAYS = 30;
function renderTrash(view) {
  const trash = (state.trash || []).map((e) => {
    const deletedAt = new Date(e.deleted_at);
    const daysLeft = Math.max(0, RETENTION_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / 86400000));
    return { ...e, deletedAt, daysLeft };
  }).sort((a, b) => b.deletedAt - a.deletedAt);

  view.innerHTML =
    pageHead('Trash', `Soft-deleted entries — kept for ${RETENTION_DAYS} days`, trash.length ? `<button class="btn danger" id="emptyBtn">🗑 Empty trash</button>` : '') +
    (trash.length === 0
      ? `<div class="notice">Trash is empty. Deleted entries land here and can be restored for ${RETENTION_DAYS} days, after which they are permanently removed.</div>`
      : `<table>
        <thead><tr><th>Deleted</th><th>Auto-removed in</th><th>Date</th><th>Description</th><th>Workstream</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${trash.map((e) => `<tr>
          <td style="white-space:nowrap">${formatDate(e.deletedAt)}</td>
          <td><span class="badge ${e.daysLeft <= 7 ? 'warn' : 'gray'}">${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}</span></td>
          <td style="white-space:nowrap">${formatDate(e.entry_date)}</td>
          <td>${esc(e.description)}${e.notes ? `<div class="muted" style="font-size:12px">${esc(e.notes)}</div>` : ''}</td>
          <td>${esc(e.workstream)}</td>
          <td class="num amount red">${money(e.amount)}</td>
          <td class="num" style="white-space:nowrap"><button class="link-btn" data-restore="${e.id}">Restore</button>&nbsp;&nbsp;<button class="link-btn danger" data-forever="${e.id}">Delete forever</button></td>
        </tr>`).join('')}</tbody>
      </table>`);

  const restore = async (id) => {
    try { await api.patch(`/api/entries/${id}`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); }
  };
  const forever = async (e) => {
    if (!confirm(`Permanently delete "${e.description}"? This cannot be undone.`)) return;
    try { await api.del(`/api/entries/${e.id}?forever=1`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); }
  };
  view.querySelectorAll('[data-restore]').forEach((b) => { b.onclick = () => restore(b.dataset.restore); });
  view.querySelectorAll('[data-forever]').forEach((b) => { b.onclick = () => forever(trash.find((e) => String(e.id) === b.dataset.forever)); });
  const emptyBtn = view.querySelector('#emptyBtn');
  if (emptyBtn) emptyBtn.onclick = async () => {
    if (!confirm(`Permanently delete all ${trash.length} entries in the Trash? This cannot be undone.`)) return;
    try { for (const e of trash) await api.del(`/api/entries/${e.id}?forever=1`); await loadAll(); renderRoute(); } catch (err) { alert(err.message); }
  };
}

// ===================================================================
// Router + boot
// ===================================================================
function buildNav() {
  document.getElementById('nav').innerHTML = ROUTES.map((r) => `<a class="nav-link" href="${r.hash}" data-hash="${r.hash}"><span class="nav-icon">${r.icon}</span>${r.label}</a>`).join('');
}
function currentRoute() { const hash = location.hash || '#/'; return ROUTES.find((r) => r.hash === hash) || ROUTES[0]; }
function highlightNav() { const hash = location.hash || '#/'; document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.hash === hash)); }

async function renderRoute() {
  const view = document.getElementById('view');
  highlightNav();
  const route = currentRoute();
  if (state.entries === null || state.options === null || state.budgets === null) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    try { await loadAll(); }
    catch (err) {
      view.innerHTML = pageHead(route.label, '') + errorBanner(err.message) +
        '<div class="notice">If this is a fresh deployment, visit <code>/api/setup</code> once to create the database tables, then reload.</div>';
      return;
    }
  }
  try { route.render(view); } catch (err) { view.innerHTML = pageHead(route.label, '') + errorBanner(err.message); console.error(err); }
}

// boot
applyTheme(localStorage.getItem(THEME_KEY) || 'light');
updateThemeButton();
document.getElementById('themeToggle').onclick = toggleTheme;
window.addEventListener('hashchange', renderRoute);
buildNav();
renderRoute();
