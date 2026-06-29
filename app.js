// ===================================================================
// Project Cost Manager — vanilla JS single-page app.
// Talks to the serverless API under /api which persists to Vercel Postgres.
// ===================================================================

// ---------- tiny API client ----------
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
  del: (u) => http('DELETE', u),
};

// ---------- formatting helpers ----------
const money = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function toDateInput(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toISOString().slice(0, 10);
}
function monthKey(d) {
  const date = new Date(d);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function lotBadgeClass(lot) {
  if (lot === 'Lot 1') return 'badge lot1';
  if (lot === 'Lot 2') return 'badge lot2';
  return 'badge shared';
}
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#65a30d', '#475569'];
const colorFor = (i) => PALETTE[i % PALETTE.length];

// escape user text inserted into HTML
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ---------- app state ----------
const state = {
  entries: null,
  options: null,
  // transactions view controls
  filterLot: '', filterWorkstream: '', filterCategory: '',
  sortKey: 'date', sortDir: 'desc',
};

const ROUTES = [
  { hash: '#/', label: 'Dashboard', icon: '▣', render: renderDashboard },
  { hash: '#/transactions', label: 'Transactions', icon: '☰', render: renderTransactions },
  { hash: '#/categories', label: 'Categories', icon: '⚙', render: renderCategories },
  { hash: '#/reports', label: 'Reports', icon: '◔', render: renderReports },
];

// ---------- data loading ----------
async function loadAll() {
  const [entries, options] = await Promise.all([api.get('/api/entries'), api.get('/api/options')]);
  state.entries = entries;
  state.options = options;
}

// ===================================================================
// SVG charts (self-contained, no dependencies)
// ===================================================================
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text) {
  const node = document.createElementNS(SVGNS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
}

// Donut chart + legend. data = [{name, value}]
function donutChart(data) {
  const wrap = document.createElement('div');
  if (!data.length) { wrap.innerHTML = '<div class="empty">No data yet</div>'; return wrap; }
  const size = 230, r = 90, ir = 55, cx = size / 2, cy = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0);
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: '230' });

  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const frac = total ? d.value / total : 0;
    const a2 = angle + frac * Math.PI * 2;
    // full circle edge case
    if (frac >= 0.9999) {
      svg.appendChild(el('circle', { cx, cy, r: (r + ir) / 2, fill: 'none', stroke: colorFor(i), 'stroke-width': r - ir }));
    } else {
      const large = a2 - angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const xi2 = cx + ir * Math.cos(a2), yi2 = cy + ir * Math.sin(a2);
      const xi1 = cx + ir * Math.cos(angle), yi1 = cy + ir * Math.sin(angle);
      const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`;
      const p = el('path', { d: path, fill: colorFor(i) });
      p.appendChild(el('title', {}, `${d.name}: ${money(d.value)}`));
      svg.appendChild(p);
    }
    angle = a2;
  });
  svg.appendChild(el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', 'font-size': '12', fill: '#6b7480' }, 'Total'));
  svg.appendChild(el('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': '15', 'font-weight': '700', fill: '#1f2733' }, moneyShort(total)));
  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'legend';
  data.forEach((d, i) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<span class="dot" style="background:${colorFor(i)}"></span>${esc(d.name)} — ${money(d.value)}`;
    legend.appendChild(item);
  });
  wrap.appendChild(legend);
  return wrap;
}

// Horizontal bar chart. data = [{name, value}]
function barChartH(data) {
  const wrap = document.createElement('div');
  if (!data.length) { wrap.innerHTML = '<div class="empty">No data yet</div>'; return wrap; }
  const rowH = 34, padL = 150, padR = 70, padT = 6, w = 520;
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

// Vertical bar chart for monthly trend. data = [{label, value}]
function barChartV(data) {
  const wrap = document.createElement('div');
  if (!data.length) { wrap.innerHTML = '<div class="empty">No data yet</div>'; return wrap; }
  const w = Math.max(540, data.length * 70), h = 300, padL = 60, padB = 40, padT = 16, padR = 16;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const gap = 18;
  const bw = Math.min(70, plotW / data.length - gap);
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: String(h), preserveAspectRatio: 'xMidYMid meet' });

  // y gridlines
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (max / ticks) * t;
    const y = padT + plotH - (val / max) * plotH;
    svg.appendChild(el('line', { x1: padL, y1: y, x2: w - padR, y2: y, class: 'axis-line' }));
    svg.appendChild(el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', 'font-size': '10', fill: '#6b7480' }, moneyShort(val)));
  }
  const step = plotW / data.length;
  data.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const bh = (d.value / max) * plotH;
    const y = padT + plotH - bh;
    const rect = el('rect', { x, y, width: bw, height: Math.max(bh, 1), rx: 4, fill: '#2563eb' });
    rect.appendChild(el('title', {}, `${d.label}: ${money(d.value)}`));
    svg.appendChild(rect);
    svg.appendChild(el('text', { x: x + bw / 2, y: h - padB + 16, 'text-anchor': 'middle', 'font-size': '10', fill: '#6b7480' }, d.label));
  });
  wrap.appendChild(svg);
  return wrap;
}

// ===================================================================
// Views
// ===================================================================
function pageHead(title, subtitle, actionHtml = '') {
  return `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div>${actionHtml}</div>`;
}

function errorBanner(msg) {
  return `<div class="error-banner">${esc(msg)}</div>`;
}

// ---------- Dashboard ----------
function renderDashboard(view) {
  const entries = state.entries;
  const total = entries.reduce((s, e) => s + Number(e.amount), 0);
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = entries.filter((e) => monthKey(e.entry_date) === thisKey).reduce((s, e) => s + Number(e.amount), 0);

  const byLot = {}, byCat = {}, byWs = {};
  for (const e of entries) {
    byLot[e.lot] = (byLot[e.lot] || 0) + Number(e.amount);
    byCat[e.cost_category] = (byCat[e.cost_category] || 0) + Number(e.amount);
    byWs[e.workstream] = (byWs[e.workstream] || 0) + Number(e.amount);
  }
  const sorted = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  view.innerHTML =
    pageHead('Dashboard', 'Project cost overview — all figures in USD') +
    `<div class="cards">
      <div class="card"><div class="label">Total Spent</div><div class="value green">${money(total)}</div><div class="hint">${entries.length} cost entries recorded</div></div>
      <div class="card"><div class="label">Spent This Month</div><div class="value red">${money(thisMonth)}</div><div class="hint">Current calendar month</div></div>
      <div class="card"><div class="label">Spend by Lot</div><div style="margin-top:10px">
        <div class="split-row"><span class="k">Lot 1</span><span class="v">${money(byLot['Lot 1'] || 0)}</span></div>
        <div class="split-row"><span class="k">Lot 2</span><span class="v">${money(byLot['Lot 2'] || 0)}</span></div>
        <div class="split-row"><span class="k">Both/Shared</span><span class="v">${money(byLot['Both/Shared'] || 0)}</span></div>
      </div></div>
      <div class="card"><div class="label">Avg. per Entry</div><div class="value">${money(entries.length ? total / entries.length : 0)}</div><div class="hint">Across all workstreams</div></div>
    </div>
    <div class="panel-grid">
      <div class="panel"><h3>Spend by Cost Category</h3><div id="catChart"></div></div>
      <div class="panel"><h3>Spend by Workstream</h3><div id="wsChart"></div></div>
    </div>`;

  view.querySelector('#catChart').appendChild(donutChart(sorted(byCat)));
  view.querySelector('#wsChart').appendChild(barChartH(sorted(byWs)));
}

// ---------- Transactions ----------
function renderTransactions(view) {
  const o = state.options;
  let rows = state.entries.filter(
    (e) =>
      (!state.filterLot || e.lot === state.filterLot) &&
      (!state.filterWorkstream || e.workstream === state.filterWorkstream) &&
      (!state.filterCategory || e.cost_category === state.filterCategory)
  );
  rows = rows.slice().sort((a, b) => {
    let cmp;
    if (state.sortKey === 'amount') cmp = Number(a.amount) - Number(b.amount);
    else cmp = new Date(a.entry_date) - new Date(b.entry_date);
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
  const filteredTotal = rows.reduce((s, e) => s + Number(e.amount), 0);
  const hasFilters = state.filterLot || state.filterWorkstream || state.filterCategory;
  const arrow = (k) => (state.sortKey === k ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const opt = (sel, val, label) => `<option value="${esc(val)}"${sel === val ? ' selected' : ''}>${esc(label)}</option>`;

  view.innerHTML =
    pageHead('Transactions', 'All recorded cost entries', `<button class="btn primary" id="addBtn">+ Add Entry</button>`) +
    `<div class="toolbar">
      <select id="fLot"><option value="">All Lots</option>${o.lots.map((l) => opt(state.filterLot, l, l)).join('')}</select>
      <select id="fWs"><option value="">All Workstreams</option>${o.workstreams.map((w) => opt(state.filterWorkstream, w.name, w.name)).join('')}</select>
      <select id="fCat"><option value="">All Categories</option>${o.categories.map((c) => opt(state.filterCategory, c.name, c.name)).join('')}</select>
      ${hasFilters ? '<button class="link-btn" id="clearF">Clear filters</button>' : ''}
      <div class="spacer"></div>
      <span class="muted">${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · <strong style="color:var(--text)">${money(filteredTotal)}</strong></span>
    </div>
    <table>
      <thead><tr>
        <th class="sortable" data-sort="date">Date${arrow('date')}</th>
        <th>Description</th><th>Lot</th><th>Workstream</th><th>Category</th>
        <th class="num sortable" data-sort="amount">Amount${arrow('amount')}</th><th></th>
      </tr></thead>
      <tbody>${
        rows.length === 0
          ? `<tr><td colspan="7" class="empty">${hasFilters ? 'No entries match the current filters.' : 'No cost entries yet. Click “Add Entry” to start.'}</td></tr>`
          : rows.map((e) => `<tr>
              <td style="white-space:nowrap">${formatDate(e.entry_date)}</td>
              <td>${esc(e.description)}${e.notes ? `<div class="muted" style="font-size:12px">${esc(e.notes)}</div>` : ''}</td>
              <td><span class="${lotBadgeClass(e.lot)}">${esc(e.lot)}</span></td>
              <td>${esc(e.workstream)}</td>
              <td><span class="badge gray">${esc(e.cost_category)}</span></td>
              <td class="num amount red">${money(e.amount)}</td>
              <td class="num" style="white-space:nowrap">
                <button class="link-btn" data-edit="${e.id}">Edit</button>&nbsp;&nbsp;
                <button class="link-btn danger" data-del="${e.id}">Delete</button>
              </td>
            </tr>`).join('')
      }</tbody>
    </table>`;

  view.querySelector('#addBtn').onclick = () => openEntryModal(null);
  view.querySelector('#fLot').onchange = (e) => { state.filterLot = e.target.value; renderRoute(); };
  view.querySelector('#fWs').onchange = (e) => { state.filterWorkstream = e.target.value; renderRoute(); };
  view.querySelector('#fCat').onchange = (e) => { state.filterCategory = e.target.value; renderRoute(); };
  const clearF = view.querySelector('#clearF');
  if (clearF) clearF.onclick = () => { state.filterLot = state.filterWorkstream = state.filterCategory = ''; renderRoute(); };
  view.querySelectorAll('th[data-sort]').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = k; state.sortDir = 'desc'; }
      renderRoute();
    };
  });
  view.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openEntryModal(state.entries.find((e) => String(e.id) === b.dataset.edit));
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => deleteEntry(state.entries.find((e) => String(e.id) === b.dataset.del));
  });
}

async function deleteEntry(entry) {
  if (!entry) return;
  if (!confirm(`Delete "${entry.description}"? This cannot be undone.`)) return;
  try {
    await api.del(`/api/entries/${entry.id}`);
    await loadAll();
    renderRoute();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Categories ----------
function renderCategories(view) {
  const o = state.options;
  const listHtml = (title, kind, items) => `
    <div class="panel">
      <h3>${title}</h3>
      <table><tbody id="list-${kind}">${
        items.length === 0
          ? '<tr><td class="empty">None yet</td></tr>'
          : items.map((it) => `<tr data-id="${it.id}">
              <td class="opt-name">${esc(it.name)}</td>
              <td class="num" style="white-space:nowrap;width:1px">
                <button class="link-btn" data-rename="${it.id}">Rename</button>&nbsp;&nbsp;
                <button class="link-btn danger" data-delopt="${it.id}">Delete</button>
              </td></tr>`).join('')
      }</tbody></table>
      <form class="add-opt" data-kind="${kind}" style="display:flex;gap:8px;margin-top:14px">
        <input name="name" placeholder="Add ${title.toLowerCase().replace(/s$/, '')}…" style="flex:1" />
        <button class="btn primary" type="submit">Add</button>
      </form>
    </div>`;

  view.innerHTML =
    pageHead('Categories', 'Manage the workstream and cost category options used across the project') +
    `<div class="notice">Lots are fixed by the project structure (Lot 1, Lot 2, Both/Shared). You can freely add, rename, or remove workstreams and cost categories here — renaming updates existing entries automatically, and an option can only be deleted once no entries use it.</div>
     <div class="panel-grid">${listHtml('Workstreams', 'workstream', o.workstreams)}${listHtml('Cost Categories', 'category', o.categories)}</div>`;

  view.querySelectorAll('form.add-opt').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      try {
        await api.post('/api/options', { kind: form.dataset.kind, name });
        await loadAll();
        renderRoute();
      } catch (err) { alert(err.message); }
    };
  });
  view.querySelectorAll('[data-delopt]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.delopt;
      const name = b.closest('tr').querySelector('.opt-name').textContent;
      if (!confirm(`Delete "${name}"?`)) return;
      try { await api.del(`/api/options/${id}`); await loadAll(); renderRoute(); }
      catch (err) { alert(err.message); }
    };
  });
  view.querySelectorAll('[data-rename]').forEach((b) => {
    b.onclick = () => {
      const tr = b.closest('tr');
      const cell = tr.querySelector('.opt-name');
      const current = cell.textContent;
      cell.innerHTML = `<input value="${esc(current)}" style="width:100%" />`;
      const input = cell.querySelector('input');
      input.focus();
      const save = async () => {
        const name = input.value.trim();
        if (!name || name === current) { renderRoute(); return; }
        try { await api.put(`/api/options/${b.dataset.rename}`, { name }); await loadAll(); renderRoute(); }
        catch (err) { alert(err.message); renderRoute(); }
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') renderRoute(); };
      input.onblur = save;
    };
  });
}

// ---------- Reports ----------
function renderReports(view) {
  const entries = state.entries;
  const monthMap = {};
  for (const e of entries) {
    const k = monthKey(e.entry_date);
    monthMap[k] = (monthMap[k] || 0) + Number(e.amount);
  }
  const monthly = Object.entries(monthMap).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => ({ label: monthLabel(k), value: v }));

  const bmap = {};
  for (const e of entries) {
    const key = `${e.lot}||${e.workstream}||${e.cost_category}`;
    if (!bmap[key]) bmap[key] = { lot: e.lot, workstream: e.workstream, cost_category: e.cost_category, total: 0, count: 0 };
    bmap[key].total += Number(e.amount);
    bmap[key].count += 1;
  }
  const breakdown = Object.values(bmap).sort(
    (a, b) => a.lot.localeCompare(b.lot) || a.workstream.localeCompare(b.workstream) || a.cost_category.localeCompare(b.cost_category)
  );
  const grand = breakdown.reduce((s, r) => s + r.total, 0);
  const grandCount = breakdown.reduce((s, r) => s + r.count, 0);

  view.innerHTML =
    pageHead('Reports', 'Spend trends and detailed breakdown') +
    `<div class="panel full" style="margin-bottom:16px"><h3>Monthly Spend Trend</h3><div id="monthChart"></div></div>
     <div class="section-title">Breakdown by Lot × Workstream × Category</div>
     <table>
       <thead><tr><th>Lot</th><th>Workstream</th><th>Cost Category</th><th class="num">Entries</th><th class="num">Total</th><th class="num">% of Total</th></tr></thead>
       <tbody>${
         breakdown.length === 0
           ? '<tr><td colspan="6" class="empty">No cost entries yet.</td></tr>'
           : breakdown.map((r) => `<tr>
               <td>${esc(r.lot)}</td><td>${esc(r.workstream)}</td><td>${esc(r.cost_category)}</td>
               <td class="num">${r.count}</td><td class="num amount">${money(r.total)}</td>
               <td class="num muted">${grand ? ((r.total / grand) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('') +
             `<tr>
               <td colspan="3" style="font-weight:700">Grand Total</td>
               <td class="num" style="font-weight:700">${grandCount}</td>
               <td class="num amount green" style="font-weight:700">${money(grand)}</td>
               <td class="num muted">100%</td></tr>`
       }</tbody>
     </table>`;

  view.querySelector('#monthChart').appendChild(barChartV(monthly));
}

// ===================================================================
// Add / Edit entry modal
// ===================================================================
function openEntryModal(entry) {
  const o = state.options;
  const editing = Boolean(entry && entry.id);
  const cur = editing
    ? { description: entry.description, amount: entry.amount, entry_date: toDateInput(entry.entry_date), lot: entry.lot, workstream: entry.workstream, cost_category: entry.cost_category, notes: entry.notes || '' }
    : { description: '', amount: '', entry_date: new Date().toISOString().slice(0, 10), lot: o.lots[0], workstream: o.workstreams[0]?.name || '', cost_category: o.categories[0]?.name || '', notes: '' };

  const optTag = (val, sel) => `<option value="${esc(val)}"${val === sel ? ' selected' : ''}>${esc(val)}</option>`;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="overlay">
      <form class="modal" id="entryForm">
        <h2>${editing ? 'Edit cost entry' : 'Add cost entry'}</h2>
        <div id="formErr"></div>
        <div class="form-grid">
          <label class="field full">Description<input name="description" value="${esc(cur.description)}" placeholder="e.g. SOMGEG Lab — Soil Testing Batch 1" required /></label>
          <label class="field">Amount (USD)<input name="amount" type="number" step="0.01" min="0" value="${esc(cur.amount)}" placeholder="0.00" required /></label>
          <label class="field">Date<input name="entry_date" type="date" value="${esc(cur.entry_date)}" required /></label>
          <label class="field">Lot<select name="lot">${o.lots.map((l) => optTag(l, cur.lot)).join('')}</select></label>
          <label class="field">Workstream<select name="workstream" required>${o.workstreams.map((w) => optTag(w.name, cur.workstream)).join('')}</select></label>
          <label class="field">Cost Category<select name="cost_category" required>${o.categories.map((c) => optTag(c.name, cur.cost_category)).join('')}</select></label>
          <label class="field full">Notes / remarks (optional)<textarea name="notes" rows="3" placeholder="Optional remarks…">${esc(cur.notes)}</textarea></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelBtn">Cancel</button>
          <button type="submit" class="btn primary" id="saveBtn">${editing ? 'Save changes' : 'Add entry'}</button>
        </div>
      </form>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('cancelBtn').onclick = close;
  document.getElementById('overlay').onmousedown = (e) => { if (e.target.id === 'overlay') close(); };

  document.getElementById('entryForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = {
      description: f.description.value,
      amount: f.amount.value,
      entry_date: f.entry_date.value,
      lot: f.lot.value,
      workstream: f.workstream.value,
      cost_category: f.cost_category.value,
      notes: f.notes.value,
    };
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      if (editing) await api.put(`/api/entries/${entry.id}`, payload);
      else await api.post('/api/entries', payload);
      close();
      await loadAll();
      renderRoute();
    } catch (err) {
      document.getElementById('formErr').innerHTML = errorBanner(err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = editing ? 'Save changes' : 'Add entry';
    }
  };
}

// ===================================================================
// Router + boot
// ===================================================================
function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = ROUTES.map((r) => `<a class="nav-link" href="${r.hash}" data-hash="${r.hash}"><span class="nav-icon">${r.icon}</span>${r.label}</a>`).join('');
}

function currentRoute() {
  const hash = location.hash || '#/';
  return ROUTES.find((r) => r.hash === hash) || ROUTES[0];
}

function highlightNav() {
  const hash = location.hash || '#/';
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.hash === hash);
  });
}

async function renderRoute() {
  const view = document.getElementById('view');
  highlightNav();
  const route = currentRoute();
  if (state.entries === null || state.options === null) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    try {
      await loadAll();
    } catch (err) {
      view.innerHTML = pageHead(route.label, '') + errorBanner(err.message) +
        '<div class="notice">If this is a fresh deployment, visit <code>/api/setup</code> once to create the database tables, then reload.</div>';
      return;
    }
  }
  try {
    route.render(view);
  } catch (err) {
    view.innerHTML = pageHead(route.label, '') + errorBanner(err.message);
  }
}

window.addEventListener('hashchange', renderRoute);
buildNav();
renderRoute();
