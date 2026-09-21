// PISO WIFI Management System - robust dashboard bootstrap + navigation
let auth = null;
let db = null;
let fb = {};

const $ = (s) => document.querySelector(s);
const view = $('#view');
const toastEl = $('#toast');

const money = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthKey = () => new Date().toISOString().slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = String(key).split('-');
  if (!y || !m) return String(key || '');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

let currentUser = null;
let units = [];
let records = [];
let payments = [];
let settings = {
  internetCost: 1000,
  ownerPercent: 70,
  clientPercent: 30,
  electricity: 100,
  electricityRule: 'ADD_TO_CLIENT'
};
let route = 'dashboard';
let search = '';
let authStarted = false;
let authFinished = false;

function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function showStartupError(title, message) {
  const loader = $('#authLoading');
  if (!loader) return;
  console.error('[PISO WIFI]', title, message);
  loader.innerHTML = `
    <div style="max-width:650px;text-align:center;padding:30px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 12px 40px rgba(15,23,42,.12)">
      <strong style="display:block;font-size:21px;color:#17243A;margin-bottom:10px">${esc(title)}</strong>
      <span style="display:block;color:#64748B;line-height:1.6;word-break:break-word">${esc(message)}</span>
      <button id="startupReturn" style="margin-top:18px;padding:11px 18px;border:0;border-radius:10px;background:#1685F5;color:#fff;font-weight:700;cursor:pointer">Return to Login</button>
    </div>`;
  loader.classList.remove('hidden');
  $('#startupReturn')?.addEventListener('click', () => { window.location.href = 'index.html'; });
}

function calc(record) {
  const gross = Number(record?.grossSales || 0);
  const internet = Number(settings.internetCost || 0);
  const owner = gross * Number(settings.ownerPercent || 0) / 100;
  const client = gross * Number(settings.clientPercent || 0) / 100;
  const electricity = Number(settings.electricity || 0);
  let clientTotal = client;
  if (settings.electricityRule === 'SUBTRACT_FROM_CLIENT') clientTotal = client - electricity;
  else clientTotal = client + electricity;
  clientTotal = Math.max(0, clientTotal);

  const paid = payments
    .filter((p) => p.unitId === record?.unitId && p.month === record?.month)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const balance = Math.max(0, clientTotal - paid);
  const status = clientTotal > 0 && paid >= clientTotal ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
  return { gross, internet, owner, client, electricity, clientTotal, paid, balance, status };
}

async function loadData() {
  const [uSnap, rSnap, pSnap, sSnap] = await Promise.all([
    fb.getDocs(fb.collection(db, 'units')),
    fb.getDocs(fb.collection(db, 'monthlyRecords')),
    fb.getDocs(fb.collection(db, 'payments')),
    fb.getDoc(fb.doc(db, 'settings', 'business'))
  ]);

  units = uSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  records = rSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  payments = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (sSnap.exists()) settings = { ...settings, ...sSnap.data() };
}

async function authorize(user) {
  const snap = await fb.getDoc(fb.doc(db, 'users', user.uid));
  if (!snap.exists()) throw new Error('Your Firebase account is not authorized as an admin.');
  const data = snap.data();
  if (data.active !== true || data.role !== 'admin') throw new Error('Your account is not an active admin.');
}

function closeMenu() {
  $('#sidebar')?.classList.remove('open');
  $('#overlay')?.classList.remove('show');
}

function setRoute(next) {
  const allowed = ['dashboard', 'units', 'reports', 'payments', 'statements', 'settings'];
  route = allowed.includes(next) ? next : 'dashboard';
  if (window.location.hash !== `#${route}`) window.location.hash = route;
  else render();
}

function nav() {
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

function baseHead(title, subtitle, action = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
}

function render() {
  nav();
  const renderers = {
    dashboard: renderDashboard,
    units: renderUnits,
    reports: renderReports,
    payments: renderPayments,
    statements: renderStatements,
    settings: renderSettings
  };
  (renderers[route] || renderDashboard)();
  closeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function currentRows(month = monthKey()) {
  const monthRecords = records.filter((r) => r.month === month);
  return units.map((u) => {
    const r = monthRecords.find((x) => x.unitId === u.id) || { unitId: u.id, month, grossSales: 0 };
    return { u, r, c: calc(r) };
  });
}

function renderDashboard() {
  const month = monthKey();
  const rows = currentRows(month);
  const activeRows = rows.filter((x) => x.u.active !== false);
  const total = activeRows.reduce((a, x) => ({
    gross: a.gross + x.c.gross,
    owner: a.owner + x.c.owner,
    client: a.client + x.c.client,
    electricity: a.electricity + x.c.electricity,
    due: a.due + x.c.clientTotal,
    paid: a.paid + x.c.paid,
    balance: a.balance + x.c.balance
  }), { gross: 0, owner: 0, client: 0, electricity: 0, due: 0, paid: 0, balance: 0 });

  view.innerHTML = baseHead(
    'Dashboard',
    'Overview of all your Piso WiFi units',
    '<button class="primary-btn" id="addUnitTop">+ Add New Unit</button>'
  ) + `
    <div class="wifi-status"><span class="wifi-dot">●</span><div><strong>Piso WiFi Network</strong><small>Management system connected to Firebase</small></div><span class="online">ONLINE</span></div>
    <div class="kpis">
      <article class="kpi"><div class="kpi-icon">♙</div><span>Total Units</span><b>${units.length}</b><small>Registered units</small></article>
      <article class="kpi"><div class="kpi-icon">₱</div><span>Gross Sales</span><b>${money(total.gross)}</b><small>${esc(monthLabel(month))}</small></article>
      <article class="kpi"><div class="kpi-icon">◉</div><span>Internet Cost</span><b>${money(settings.internetCost * activeRows.length)}</b><small>Configured per unit</small></article>
      <article class="kpi green"><div class="kpi-icon">70%</div><span>Owner Share</span><b>${money(total.owner)}</b><small>Based on settings</small></article>
      <article class="kpi purple"><div class="kpi-icon">30%</div><span>Client Share</span><b>${money(total.client)}</b><small>Before electricity</small></article>
      <article class="kpi orange"><div class="kpi-icon">⚡</div><span>Electricity</span><b>${money(total.electricity)}</b><small>Current month</small></article>
    </div>
    <div class="summary-grid">
      <div class="summary-card report-highlight"><h3>CLIENT AMOUNT DUE</h3><strong>${money(total.due)}</strong><span class="muted">Current month across active units</span></div>
      <div class="summary-card"><h3>PAYMENTS RECEIVED</h3><strong>${money(total.paid)}</strong><span class="muted">Recorded for ${esc(monthLabel(month))}</span></div>
      <div class="summary-card"><h3>OUTSTANDING BALANCE</h3><strong class="danger-text">${money(total.balance)}</strong><span class="muted">Amount still to collect</span></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h3>Units / Clients</h3><p>Monthly computation for ${esc(monthLabel(month))}</p></div><div class="tools"><input class="search" id="dashSearch" placeholder="Search client or unit..." value="${esc(search)}"><select id="dashStatus" class="search"><option value="">All statuses</option><option>Paid</option><option>Partial</option><option>Unpaid</option></select></div></div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Client / Unit</th><th>Gross Sales</th><th>Internet</th><th>Owner Share</th><th>Client Share</th><th>Electricity</th><th>Amount Due</th><th>Status</th><th></th></tr></thead><tbody id="dashBody"></tbody></table></div>
    </div>
    <div class="quick-grid"><button class="quick" id="quickUnit"><b>+ Add New Unit</b><span>Create a Piso WiFi unit and client record.</span></button><button class="quick" id="quickReport"><b>▥ Generate Monthly Report</b><span>Review current-month calculations.</span></button><button class="quick" id="quickStatement"><b>▤ Print Statements</b><span>Open client statements and print.</span></button></div>`;

  $('#addUnitTop').onclick = () => openUnit();
  $('#quickUnit').onclick = () => openUnit();
  $('#quickReport').onclick = () => setRoute('reports');
  $('#quickStatement').onclick = () => setRoute('statements');
  $('#dashSearch').oninput = (e) => { search = e.target.value; updateDashRows(); };
  $('#dashStatus').onchange = updateDashRows;
  updateDashRows();
}

function rowHtml(item, index) {
  return `<tr><td>${index + 1}</td><td><b>${esc(item.u.name || 'Unnamed Client')}</b><br><span class="muted">${esc(item.u.unitCode || item.u.location || 'Unit')}</span></td><td class="amount">${money(item.c.gross)}</td><td>${money(item.c.internet)}</td><td>${money(item.c.owner)}</td><td>${money(item.c.client)}</td><td>${money(item.c.electricity)}</td><td class="amount">${money(item.c.clientTotal)}</td><td><span class="badge ${item.c.status.toLowerCase()}">${item.c.status}</span></td><td><button class="action-btn" data-view-unit="${esc(item.u.id)}">View</button></td></tr>`;
}

function updateDashRows() {
  const body = $('#dashBody');
  if (!body) return;
  const status = $('#dashStatus')?.value || '';
  const q = search.trim().toLowerCase();
  const rows = currentRows().filter((x) => {
    const text = `${x.u.name || ''} ${x.u.unitCode || ''} ${x.u.location || ''}`.toLowerCase();
    return (!q || text.includes(q)) && (!status || x.c.status === status);
  });
  body.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="10" class="empty">No matching units.</td></tr>';
  document.querySelectorAll('[data-view-unit]').forEach((b) => { b.onclick = () => openUnit(b.dataset.viewUnit); });
}

function renderUnits() {
  view.innerHTML = baseHead('Units / Clients', 'Manage your Piso WiFi machines and associated clients.', '<button class="primary-btn" id="addUnitBtn">+ Add New Unit</button>') + `
    <div class="panel"><div class="panel-head"><div><h3>Registered Units</h3><p>${units.length} unit(s) in the system</p></div><div class="tools"><input id="unitSearch" class="search" placeholder="Search client, unit or location..."></div></div>
    <div class="table-wrap"><table><thead><tr><th>Unit</th><th>Client</th><th>Location</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead><tbody id="unitsBody">${units.length ? units.map((u) => `<tr><td><b>${esc(u.unitCode || '—')}</b></td><td>${esc(u.name || '—')}</td><td>${esc(u.location || '—')}</td><td>${esc(u.contact || '—')}</td><td><span class="badge ${u.active !== false ? 'active' : 'inactive'}">${u.active !== false ? 'Active' : 'Inactive'}</span></td><td><button class="action-btn" data-edit="${esc(u.id)}">Edit</button><button class="action-btn danger" data-toggle="${esc(u.id)}">${u.active !== false ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No units yet. Click Add New Unit to begin.</td></tr>'}</tbody></table></div></div>`;

  $('#addUnitBtn').onclick = () => openUnit();
  document.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openUnit(b.dataset.edit); });
  document.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = () => toggleUnit(b.dataset.toggle); });
  $('#unitSearch').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#unitsBody tr').forEach((r) => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  };
}

function reportSummary(month) {
  const rows = currentRows(month);
  return {
    rows,
    gross: rows.reduce((a, x) => a + x.c.gross, 0),
    owner: rows.reduce((a, x) => a + x.c.owner, 0),
    due: rows.reduce((a, x) => a + x.c.clientTotal, 0),
    paid: rows.reduce((a, x) => a + x.c.paid, 0),
    balance: rows.reduce((a, x) => a + x.c.balance, 0)
  };
}

function renderReports() {
  const months = [...new Set(records.map((r) => r.month).filter(Boolean))].sort().reverse();
  const selected = months[0] || monthKey();
  const summary = reportSummary(selected);
  view.innerHTML = baseHead('Monthly Reports', 'Review financial performance by month.', `<div class="tools"><select id="reportMonth" class="search">${[monthKey(), ...months].filter((v, i, a) => a.indexOf(v) === i).map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select><button class="secondary-btn" id="exportReport">Export CSV</button><button class="primary-btn" id="printReport">Print</button></div>`) + `
    <div class="summary-grid"><div class="summary-card"><h3>GROSS SALES</h3><strong>${money(summary.gross)}</strong></div><div class="summary-card"><h3>OWNER SHARE</h3><strong>${money(summary.owner)}</strong></div><div class="summary-card"><h3>CLIENT AMOUNT DUE</h3><strong>${money(summary.due)}</strong></div></div>
    <div class="panel"><div class="panel-head"><div><h3>${esc(monthLabel(selected))} — Unit Report</h3><p>Each month is stored separately; prior months are not overwritten.</p></div></div><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Gross Sales</th><th>Internet</th><th>Owner</th><th>Client</th><th>Electricity</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody id="reportBody"></tbody></table></div></div>`;
  fillReportBody(summary.rows);
  $('#reportMonth').onchange = (e) => {
    const next = reportSummary(e.target.value);
    fillReportBody(next.rows);
  };
  $('#exportReport').onclick = () => exportCsv(selected, summary.rows);
  $('#printReport').onclick = () => window.print();
}

function fillReportBody(rows) {
  const body = $('#reportBody');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map((x) => `<tr><td><b>${esc(x.u.unitCode || '—')}</b><br>${esc(x.u.name || '')}</td><td>${money(x.c.gross)}</td><td>${money(x.c.internet)}</td><td>${money(x.c.owner)}</td><td>${money(x.c.client)}</td><td>${money(x.c.electricity)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td class="amount">${money(x.c.balance)}</td><td><span class="badge ${x.c.status.toLowerCase()}">${x.c.status}</span></td></tr>`).join('') : '<tr><td colspan="10" class="empty">No monthly records for this month.</td></tr>';
}

function renderPayments() {
  view.innerHTML = baseHead('Payments', 'Record client payments and automatically update balances.', '<button class="primary-btn" id="addPaymentBtn">+ Record Payment</button>') + `
    <div class="panel"><div class="panel-head"><div><h3>Payment History</h3><p>All payment entries are retained for reporting.</p></div><div class="tools"><input id="paymentSearch" class="search" placeholder="Search unit or client..."></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Unit / Client</th><th>Month</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead><tbody id="paymentBody"></tbody></table></div></div>`;
  fillPayments('');
  $('#addPaymentBtn').onclick = () => openPayment();
  $('#paymentSearch').oninput = (e) => fillPayments(e.target.value.toLowerCase());
}

function fillPayments(q) {
  const body = $('#paymentBody');
  if (!body) return;
  const list = [...payments].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).filter((p) => {
    const u = units.find((x) => x.id === p.unitId);
    return !q || `${u?.unitCode || ''} ${u?.name || ''}`.toLowerCase().includes(q);
  });
  body.innerHTML = list.length ? list.map((p) => {
    const u = units.find((x) => x.id === p.unitId);
    return `<tr><td>${esc(p.date || '—')}</td><td><b>${esc(u?.unitCode || '—')}</b><br>${esc(u?.name || '')}</td><td>${p.month ? esc(monthLabel(p.month)) : '—'}</td><td class="amount">${money(p.amount)}</td><td>${esc(p.method || '—')}</td><td>${esc(p.reference || '—')}</td><td>${esc(p.notes || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No payments recorded yet.</td></tr>';
}

function renderStatements() {
  view.innerHTML = baseHead('Client Statements', 'View monthly balances, payment history, and print statements.', '<button class="secondary-btn" id="printStatements">Print</button>') + `
    <div class="panel"><div class="panel-head"><div><h3>Client Statements</h3><p>Select a client to view the full monthly statement.</p></div><select id="statementUnit" class="search"><option value="">Select a unit / client</option>${units.map((u) => `<option value="${esc(u.id)}">${esc(u.unitCode || 'Unit')} — ${esc(u.name || 'Client')}</option>`).join('')}</select></div><div id="statementContent"><div class="empty">Choose a client to display their statement.</div></div></div>`;
  $('#statementUnit').onchange = (e) => drawStatement(e.target.value);
  $('#printStatements').onclick = () => window.print();
}

function drawStatement(id) {
  const u = units.find((x) => x.id === id);
  const body = $('#statementContent');
  if (!body) return;
  if (!u) { body.innerHTML = '<div class="empty">Choose a client.</div>'; return; }
  const rs = records.filter((r) => r.unitId === id).sort((a, b) => String(b.month).localeCompare(String(a.month)));
  body.innerHTML = `<div class="settings-card"><h2>${esc(u.name || 'Client')} <span class="muted">${esc(u.unitCode || '')}</span></h2><p class="muted">${esc(u.location || '')} · ${esc(u.contact || '')}</p><div class="table-wrap"><table><thead><tr><th>Month</th><th>Gross Sales</th><th>Owner Share</th><th>Client Share</th><th>Electricity</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rs.length ? rs.map((r) => { const c = calc(r); return `<tr><td>${esc(monthLabel(r.month))}</td><td>${money(c.gross)}</td><td>${money(c.owner)}</td><td>${money(c.client)}</td><td>${money(c.electricity)}</td><td>${money(c.clientTotal)}</td><td>${money(c.paid)}</td><td class="amount">${money(c.balance)}</td><td><span class="badge ${c.status.toLowerCase()}">${c.status}</span></td></tr>`; }).join('') : '<tr><td colspan="9" class="empty">No monthly records for this client.</td></tr>'}</tbody></table></div></div>`;
}

function renderSettings() {
  view.innerHTML = baseHead('Settings', 'Configure the business rules used by all calculations.') + `
    <div class="panel"><div class="settings-card"><h3>Financial Rules</h3><div class="notice">Changes here are used by the dashboard, reports, statements, and payment balances.</div>
    <div class="setting-row"><div><b>Internet Cost</b><small>Fixed internet cost per unit, per month.</small></div><input id="sInternet" type="number" min="0" step="0.01" value="${settings.internetCost}"></div>
    <div class="setting-row"><div><b>Owner Share (%)</b><small>Percentage of gross sales allocated to the owner.</small></div><input id="sOwner" type="number" min="0" max="100" step="1" value="${settings.ownerPercent}"></div>
    <div class="setting-row"><div><b>Client Share (%)</b><small>Percentage of gross sales allocated to the client.</small></div><input id="sClient" type="number" min="0" max="100" step="1" value="${settings.clientPercent}"></div>
    <div class="setting-row"><div><b>Electricity</b><small>Configured electricity amount per unit/month.</small></div><input id="sElec" type="number" min="0" step="0.01" value="${settings.electricity}"></div>
    <div class="setting-row"><div><b>Electricity Rule</b><small>Choose whether electricity is added to or subtracted from the client share.</small></div><select id="sRule"><option value="ADD_TO_CLIENT" ${settings.electricityRule === 'ADD_TO_CLIENT' ? 'selected' : ''}>Add to Client Total</option><option value="SUBTRACT_FROM_CLIENT" ${settings.electricityRule === 'SUBTRACT_FROM_CLIENT' ? 'selected' : ''}>Subtract from Client Share</option></select></div>
    <div style="display:flex;justify-content:flex-end;margin-top:20px"><button class="primary-btn" id="saveSettings">Save Settings</button></div></div></div>`;
  $('#saveSettings').onclick = saveSettings;
}

async function saveSettings() {
  const owner = Number($('#sOwner').value);
  const client = Number($('#sClient').value);
  if (owner + client !== 100) { notify('Owner + Client share must equal 100%.'); return; }
  settings = {
    internetCost: Number($('#sInternet').value || 0),
    ownerPercent: owner,
    clientPercent: client,
    electricity: Number($('#sElec').value || 0),
    electricityRule: $('#sRule').value
  };
  await fb.setDoc(fb.doc(db, 'settings', 'business'), settings, { merge: true });
  notify('Settings saved.');
  render();
}

function openModal(title, body, onSave) {
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="close" id="closeModal">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="secondary-btn" id="cancelModal">Cancel</button><button class="primary-btn" id="saveModal">Save</button></div></div></div>`;
  const close = () => { $('#modalRoot').innerHTML = ''; };
  $('#closeModal').onclick = close;
  $('#cancelModal').onclick = close;
  $('#saveModal').onclick = async () => {
    try {
      await onSave();
      close();
      await loadData();
      render();
      notify('Saved successfully.');
    } catch (e) {
      notify(e?.message || 'Unable to save.');
    }
  };
}

function openUnit(id = null) {
  const u = id ? units.find((x) => x.id === id) : null;
  openModal(id ? 'Edit Unit' : 'Add New Unit', `<div class="form-grid"><div class="field"><label>Unit Code *</label><input id="fCode" value="${esc(u?.unitCode || '')}" placeholder="UNIT-001"></div><div class="field"><label>Client Name *</label><input id="fName" value="${esc(u?.name || '')}" placeholder="Client name"></div><div class="field"><label>Location</label><input id="fLocation" value="${esc(u?.location || '')}" placeholder="Location"></div><div class="field"><label>Contact</label><input id="fContact" value="${esc(u?.contact || '')}" placeholder="Contact number"></div><div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(u?.notes || '')}</textarea></div></div>`, async () => {
    const data = {
      unitCode: $('#fCode').value.trim(),
      name: $('#fName').value.trim(),
      location: $('#fLocation').value.trim(),
      contact: $('#fContact').value.trim(),
      notes: $('#fNotes').value.trim(),
      active: u?.active !== false
    };
    if (!data.unitCode || !data.name) throw new Error('Unit Code and Client Name are required.');
    if (id) await fb.updateDoc(fb.doc(db, 'units', id), data);
    else await fb.addDoc(fb.collection(db, 'units'), { ...data, createdAt: fb.serverTimestamp() });
  });
}

async function toggleUnit(id) {
  const u = units.find((x) => x.id === id);
  if (!u) return;
  const action = u.active !== false ? 'Deactivate' : 'Activate';
  if (!confirm(`${action} ${u.unitCode || u.name}?`)) return;
  await fb.updateDoc(fb.doc(db, 'units', id), { active: u.active === false });
  await loadData();
  render();
  notify(`Unit ${action.toLowerCase()}d.`);
}

function openPayment() {
  openModal('Record Payment', `<div class="form-grid"><div class="field full"><label>Unit / Client *</label><select id="pUnit"><option value="">Select unit</option>${units.filter((u) => u.active !== false).map((u) => `<option value="${esc(u.id)}">${esc(u.unitCode)} — ${esc(u.name)}</option>`).join('')}</select></div><div class="field"><label>Month *</label><input id="pMonth" type="month" value="${monthKey()}"></div><div class="field"><label>Amount *</label><input id="pAmount" type="number" min="0" step="0.01"></div><div class="field"><label>Date</label><input id="pDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Method</label><select id="pMethod"><option>Cash</option><option>GCash</option><option>Bank Transfer</option><option>Other</option></select></div><div class="field"><label>Reference</label><input id="pRef"></div><div class="field full"><label>Notes</label><textarea id="pNotes" rows="3"></textarea></div></div>`, async () => {
    const unitId = $('#pUnit').value;
    const amount = Number($('#pAmount').value);
    if (!unitId || amount <= 0) throw new Error('Unit and a payment amount greater than zero are required.');
    await fb.addDoc(fb.collection(db, 'payments'), { unitId, month: $('#pMonth').value, amount, date: $('#pDate').value, method: $('#pMethod').value, reference: $('#pRef').value.trim(), notes: $('#pNotes').value.trim(), createdAt: fb.serverTimestamp() });
  });
}

function recordSale(id) {
  const u = units.find((x) => x.id === id);
  const existing = records.find((r) => r.unitId === id && r.month === monthKey());
  openModal('Record Monthly Sales', `<div class="notice">${esc(u?.unitCode || '')} — ${esc(u?.name || '')} · ${esc(monthLabel(monthKey()))}</div><br><div class="field"><label>Gross Sales *</label><input id="saleGross" type="number" min="0" step="0.01" value="${existing?.grossSales || 0}"></div>`, async () => {
    const gross = Number($('#saleGross').value);
    if (gross < 0) throw new Error('Gross sales cannot be negative.');
    const data = { unitId: id, month: monthKey(), grossSales: gross, updatedAt: fb.serverTimestamp() };
    if (existing) await fb.updateDoc(fb.doc(db, 'monthlyRecords', existing.id), data);
    else await fb.addDoc(fb.collection(db, 'monthlyRecords'), data);
  });
}

function exportCsv(month, rows) {
  const data = [['Unit', 'Client', 'Gross Sales', 'Internet Cost', 'Owner Share', 'Client Share', 'Electricity', 'Amount Due', 'Paid', 'Balance', 'Status']];
  rows.forEach((x) => data.push([x.u.unitCode, x.u.name, x.c.gross, x.c.internet, x.c.owner, x.c.client, x.c.electricity, x.c.clientTotal, x.c.paid, x.c.balance, x.c.status]));
  const csv = data.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `piso-wifi-report-${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Navigation and shell events.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-route]');
  if (link) {
    e.preventDefault();
    setRoute(link.dataset.route);
  }
});
window.addEventListener('hashchange', () => {
  const next = window.location.hash.replace('#', '') || 'dashboard';
  route = next;
  render();
});
$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#overlay').classList.add('show'); };
$('#overlay').onclick = closeMenu;

async function doLogout() {
  try {
    await fb.signOut(auth);
    window.location.href = 'index.html';
  } catch (e) {
    notify(e?.message || 'Unable to log out.');
  }
}
$('#logoutBtn').onclick = doLogout;

async function bootstrap(user) {
  if (!user) {
    window.location.replace('index.html');
    return;
  }
  currentUser = user;
  try {
    await authorize(user);
    await loadData();
    $('#authLoading').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#userEmail').textContent = user.email || 'Admin';
    $('#currentMonthChip').textContent = monthLabel(monthKey());
    route = window.location.hash.replace('#', '') || 'dashboard';
    render();
  } catch (e) {
    showStartupError('Unable to open the dashboard', e?.message || 'Firebase authorization or database access failed.');
  }
}

async function init() {
  if (authStarted) return;
  authStarted = true;
  try {
    const [appMod, authMod, fsMod, configMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js'),
      import('./firebase-config.js')
    ]);

    const app = appMod.initializeApp(configMod.firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    fb = {
      ...fsMod,
      signOut: authMod.signOut,
      onAuthStateChanged: authMod.onAuthStateChanged
    };

    const timeout = setTimeout(() => {
      if (!authFinished) {
        const user = auth.currentUser;
        if (user) {
          authFinished = true;
          bootstrap(user);
        } else {
          showStartupError('Authentication timed out', 'Firebase Authentication did not finish restoring the login session. Return to Login and sign in again.');
        }
      }
    }, 10000);

    fb.onAuthStateChanged(auth, (user) => {
      authFinished = true;
      clearTimeout(timeout);
      bootstrap(user);
    });

    if (auth.currentUser) {
      authFinished = true;
      clearTimeout(timeout);
      bootstrap(auth.currentUser);
    }
  } catch (e) {
    showStartupError('Dashboard failed to start', `${e?.name || 'Error'}: ${e?.message || e}`);
  }
}

window.addEventListener('error', (e) => {
  if (!authFinished) showStartupError('Dashboard JavaScript error', e.message || 'An unexpected JavaScript error occurred.');
});
window.addEventListener('unhandledrejection', (e) => {
  if (!authFinished) showStartupError('Firebase startup error', e.reason?.message || String(e.reason || 'An unexpected Firebase error occurred.'));
});

init();
