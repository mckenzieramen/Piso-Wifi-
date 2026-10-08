import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";

// Separate Firebase Auth instance is used only to provision cashier accounts,
// so creating a cashier never signs the Admin out of the Admin Portal.
const provisioner = initializeApp(firebaseConfig, "cashierAdminProvisioner");
const provisionAuth = getAuth(provisioner);
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const money = (n) => `₱${Number(n || 0).toLocaleString("en-PH", {minimumFractionDigits:2, maximumFractionDigits:2})}`;

let tab = "cashiers";
let cashiers = [], transactions = [], receipts = [], remittances = [], chats = [], wifiPlans = [];
let authResolved = false;

function setLoading(message, detail = "Please wait…") {
  const el = $("#authLoading");
  if (!el) return;
  el.innerHTML = `<div class="cashier-loading-card"><div class="loader"></div><strong>${esc(message)}</strong><span>${esc(detail)}</span></div>`;
  el.classList.remove("hidden");
}

function showApp() {
  const loader = $("#authLoading");
  if (loader) loader.classList.add("hidden");
  const app = $("#app");
  if (app) app.classList.remove("hidden");
}

function showError(title, message) {
  const loader = $("#authLoading");
  if (!loader) return;
  loader.innerHTML = `<div class="auth-error"><strong>${esc(title)}</strong><span>${esc(message)}</span><div class="auth-error-actions"><button type="button" id="retryCashierAdmin">Retry</button><button type="button" class="secondary-btn" id="returnAdmin">Back to Admin</button></div></div>`;
  loader.classList.remove("hidden");
  $("#retryCashierAdmin")?.addEventListener("click", () => window.location.reload());
  $("#returnAdmin")?.addEventListener("click", () => window.location.replace("/admin/dashboard.html#dashboard"));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. Please check your Firebase connection/rules.`)), ms))
  ]);
}

async function audit(action, recordId, metadata = {}) {
  try {
    await withTimeout(addDoc(collection(db, "audit_logs"), {
      userId: auth.currentUser.uid, role: "admin", action,
      recordId: String(recordId || ""), metadata, createdAt: serverTimestamp()
    }), 5000, "Audit log");
  } catch (e) { console.warn("[CASHIER ADMIN] audit skipped", e); }
}

function deny() {
  window.location.replace("/admin/index.html");
}

function render() {
  const v = $("#view");
  if (!v) return;
  if (tab === "cashiers") {
    v.innerHTML = `<div class="admin-card"><div class="cashier-section-head"><div><h2>Cashier Accounts</h2><p>Create, activate/deactivate and reset cashier accounts.</p></div><button class="primary-btn" id="addCashier">+ Add Cashier</button></div></div>${cashiers.length ? `<div class="admin-card"><div class="table-scroll"><table><thead><tr><th>Cashier ID</th><th>Name</th><th>Email</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${cashiers.map(c => `<tr><td>${esc(c.cashierId || "—")}</td><td>${esc(c.name || "—")}</td><td>${esc(c.email || "—")}</td><td><span class="status-pill ${c.active === false ? "rejected" : ""}">${c.active === false ? "INACTIVE" : "ACTIVE"}</span></td><td>${esc(String(c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : c.createdAt || "—"))}</td><td><button class="secondary-btn" data-toggle="${c.id}" data-active="${c.active !== false}">${c.active === false ? "Activate" : "Deactivate"}</button> <button class="secondary-btn" data-reset="${esc(c.email)}">Reset Password</button></td></tr>`).join("")}</tbody></table></div></div>` : `<div class="admin-card empty-state"><div class="empty-icon">👥</div><h3>No cashier accounts yet</h3><p>Create the first cashier account to start using the separate Cashier Portal.</p><button class="primary-btn" id="addCashierEmpty">+ Create Cashier Account</button></div>`;
  } else if (tab === "transactions") {
    v.innerHTML = `<div class="admin-card"><h2>Cashier Transactions</h2><p>Approve, reject or request correction. Final invoices are generated only after approval.</p>${table(transactions, ["Transaction","Cashier","Customer","Gross","Paid","Status"], true)}</div>`;
  } else if (tab === "receipts") {
    v.innerHTML = `<div class="admin-card"><h2>Uploaded Receipts</h2>${table(receipts, ["Receipt","Cashier","Customer","Amount","Method","Status"], false)}</div>`;
  } else if (tab === "remittances") {
    v.innerHTML = `<div class="admin-card"><h2>Remittance</h2><p>Admin is the only role that can finalize a remittance.</p>${remittances.length ? `<div class="table-scroll"><table><thead><tr><th>Remittance</th><th>Cashier</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th><th>Action</th></tr></thead><tbody>${remittances.map(r => `<tr><td>${esc(r.remittanceId)}</td><td>${esc(r.cashierName)}</td><td>${money(r.expectedCollection)}</td><td>${money(r.actualRemittance)}</td><td>${money(r.variance)}</td><td>${esc(r.status)}</td><td>${r.status === "PENDING ADMIN AUTHORIZATION" ? `<button class="primary-btn" data-remit-approve="${r.id}">Authorize & Finalize</button>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : "No remittances."}</div>`;
  } else if (tab === "wifi") {
    v.innerHTML = `<div class="admin-card"><div class="cashier-section-head"><div><h2>WiFi Plans</h2><p>Only active plans are visible to Cashiers.</p></div><button class="primary-btn" id="addPlan">+ Add Plan</button></div></div>${wifiPlans.length ? `<div class="admin-card"><div class="table-scroll"><table><thead><tr><th>Plan</th><th>Price</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead><tbody>${wifiPlans.map(x => `<tr><td>${esc(x.name)}</td><td>${money(x.price)}</td><td>${esc(x.duration || "—")}</td><td>${esc(x.status || "ACTIVE")}</td><td><button class="secondary-btn" data-plan-toggle="${x.id}" data-plan-status="${x.status}">${x.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></td></tr>`).join("")}</tbody></table></div></div>` : `<div class="admin-card empty-state"><div class="empty-icon">📶</div><h3>No WiFi plans yet</h3><p>Add plans here so Cashiers can select active plans during sales.</p><button class="primary-btn" id="addPlanEmpty">+ Add WiFi Plan</button></div>`;
  } else {
    v.innerHTML = `<div class="admin-card"><h2>Customer Service Escalations</h2>${chats.filter(c => c.status === "TRANSFERRED TO ADMIN").map(c => `<div class="escalation-card"><b>${esc(c.customerName || "Customer")}</b><p>${esc(c.lastMessage || "")}</p><button class="secondary-btn" data-resolve="${c.id}">Resolve</button></div>`).join("") || `<div class="empty-state"><div class="empty-icon">💬</div><h3>No escalations</h3><p>Transferred customer concerns will appear here.</p></div>`}</div>`;
  }
  bind();
}

function table(rows, cols, actions) {
  if (!rows.length) return `<div class="empty-state compact"><div class="empty-icon">📋</div><h3>No records</h3><p>There are no records in this section yet.</p></div>`;
  return `<div class="table-scroll"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}${actions ? "<th>Action</th>" : ""}</tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.transactionId || r.receiptId || r.remittanceId || r.id)}</td><td>${esc(r.cashierName || r.cashierId || "—")}</td><td>${esc(r.customerName || "—")}</td><td>${money(r.grossSales ?? r.expectedCollection ?? r.amount)}</td><td>${money(r.amountReceived ?? r.actualRemittance ?? 0)}</td><td>${esc(r.status || "—")}</td>${actions ? `<td>${r.status === "PENDING ADMIN REVIEW" ? `<button class="primary-btn" data-approve="${r.id}">Approve</button> <button class="danger-btn" data-reject="${r.id}">Reject</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function bind() {
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = async () => { tab = b.dataset.tab; render(); await loadTab(tab); });
  $("#addCashier")?.addEventListener("click", openCashier);
  $("#addCashierEmpty")?.addEventListener("click", openCashier);
  document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => { await updateDoc(doc(db, "users", b.dataset.toggle), { active: b.dataset.active !== "true", updatedAt: serverTimestamp() }); await loadTab("cashiers"); });
  document.querySelectorAll("[data-reset]").forEach(b => b.onclick = async () => { try { await sendPasswordResetEmail(auth, b.dataset.reset); alert("Password reset email sent to " + b.dataset.reset); } catch (e) { alert(e.message); } });
  document.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => approve(b.dataset.approve));
  document.querySelectorAll("[data-reject]").forEach(b => b.onclick = () => updateDoc(doc(db, "cashierTransactions", b.dataset.reject), { status: "REJECTED", rejectedAt: serverTimestamp(), rejectedBy: auth.currentUser.uid }).then(() => loadTab("transactions")));
  document.querySelectorAll("[data-resolve]").forEach(b => b.onclick = () => updateDoc(doc(db, "customerChats", b.dataset.resolve), { status: "RESOLVED", updatedAt: serverTimestamp() }).then(() => loadTab("escalations")));
  document.querySelectorAll("[data-plan-toggle]").forEach(b => b.onclick = () => updateDoc(doc(db, "wifi_plans", b.dataset.planToggle), { status: b.dataset.planStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: serverTimestamp() }).then(() => loadTab("wifi")));
  $("#addPlan")?.addEventListener("click", openPlan);
  $("#addPlanEmpty")?.addEventListener("click", openPlan);
  document.querySelectorAll("[data-remit-approve]").forEach(b => b.onclick = () => finalizeRemittance(b.dataset.remitApprove));
}

async function safeDocs(path, sortField = "") {
  try {
    const ref = collection(db, path);
    try { return await withTimeout(getDocs(sortField ? query(ref, orderBy(sortField, "desc")) : ref), 7000, `${path} query`); }
    catch (primaryError) {
      console.warn(`[CASHIER ADMIN] ${path} ordered query failed; retrying without orderBy.`, primaryError);
      return await withTimeout(getDocs(ref), 7000, `${path} query`);
    }
  } catch (error) {
    console.warn(`[CASHIER ADMIN] ${path} unavailable.`, error);
    return { docs: [] };
  }
}

async function loadTab(name) {
  try {
    if (name === "cashiers") {
      const snap = await safeDocs("users");
      cashiers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.role === "cashier");
    } else if (name === "transactions") {
      const snap = await safeDocs("cashierTransactions", "createdAt");
      transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else if (name === "receipts") {
      const snap = await safeDocs("receipts", "createdAt");
      receipts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else if (name === "remittances") {
      const snap = await safeDocs("remittances", "createdAt");
      remittances = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else if (name === "escalations") {
      const snap = await safeDocs("customerChats", "updatedAt");
      chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else if (name === "wifi") {
      const snap = await safeDocs("wifi_plans");
      wifiPlans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    render();
  } catch (e) {
    console.error("[CASHIER ADMIN] tab load failed", name, e);
    render();
  }
}

function openCashier() {
  $("#modalRoot").innerHTML = `<div class="admin-modal-backdrop"><div class="admin-modal"><h2>Add Cashier</h2><div class="admin-grid"><div class="admin-field"><label>Cashier ID *</label><input id="cId" placeholder="CASH-001"></div><div class="admin-field"><label>Cashier Name *</label><input id="cName"></div><div class="admin-field full"><label>Email *</label><input id="cEmail" type="email"></div><div class="admin-field"><label>Temporary Password *</label><input id="cPassword" type="password" minlength="6"></div><div class="admin-field"><label>Status</label><select id="cActive"><option value="true">Active</option><option value="false">Inactive</option></select></div></div><div class="admin-actions"><button class="secondary-btn" id="cancelCashier">Cancel</button><button class="primary-btn" id="saveCashier">Create Cashier</button></div></div></div>`;
  $("#cancelCashier").onclick = () => $("#modalRoot").innerHTML = "";
  $("#saveCashier").onclick = async () => {
    try {
      const email = $("#cEmail").value.trim().toLowerCase(), password = $("#cPassword").value;
      const cashierId = $("#cId").value.trim().toUpperCase(), name = $("#cName").value.trim();
      if (!cashierId || !name || !email || password.length < 6) throw new Error("Cashier ID, name, valid email and a password of at least 6 characters are required.");
      const cred = await createUserWithEmailAndPassword(provisionAuth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), { role: "cashier", cashierId, name, email, active: $("#cActive").value === "true", createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
      await provisionAuth.signOut();
      $("#modalRoot").innerHTML = "";
      alert("Cashier created successfully.");
      await loadTab("cashiers");
    } catch (e) { alert(e.message); }
  };
}

async function approve(id) {
  const t = transactions.find(x => x.id === id); if (!t) return;
  const invoice = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(t.transactionId)}</title></head><body><h1>PISO WIFI</h1><h2>INVOICE</h2><p>Invoice #: INV-${esc(t.transactionId)}</p><p>Transaction #: ${esc(t.transactionId)}</p><p>Customer: ${esc(t.customerName)}</p><p>Service: ${esc(t.productName)}</p><p>Gross Sales: ${money(t.grossSales)}</p><p>Amount Paid: ${money(t.amountReceived)}</p><p>Balance: ${money(t.balance)}</p><p>Payment Method: ${esc(t.paymentMethod)}</p><p>Reference: ${esc(t.referenceNumber)}</p><p>Status: PAID / APPROVED</p><p>Cashier: ${esc(t.cashierName)}</p><p>Approved By: ADMIN</p></body></html>`;
  await updateDoc(doc(db, "cashierTransactions", id), { status: "APPROVED", approvedAt: serverTimestamp(), approvedBy: auth.currentUser.uid, invoiceHtml: invoice, invoiceReady: true });
  await audit("SALE_APPROVED", id);
  await addDoc(collection(db, "notifications"), { type: "cashier", title: "Cashier transaction approved", message: `${t.transactionId} was approved and invoice generated.`, relatedId: id, read: false, createdAt: serverTimestamp() });
  await loadTab("transactions");
}

function openPlan() {
  $("#modalRoot").innerHTML = `<div class="admin-modal-backdrop"><div class="admin-modal"><h2>Add WiFi Plan</h2><div class="admin-grid"><div class="admin-field"><label>Plan Name *</label><input id="pName"></div><div class="admin-field"><label>Price *</label><input id="pPrice" type="number" min="0" step="0.01"></div><div class="admin-field"><label>Duration *</label><input id="pDuration" placeholder="24 Hours"></div><div class="admin-field"><label>Status</label><select id="pStatus"><option>ACTIVE</option><option>INACTIVE</option></select></div><div class="admin-field full"><label>Description</label><textarea id="pDescription"></textarea></div></div><div class="admin-actions"><button class="secondary-btn" id="cancelPlan">Cancel</button><button class="primary-btn" id="savePlan">Save Plan</button></div></div></div>`;
  $("#cancelPlan").onclick = () => $("#modalRoot").innerHTML = "";
  $("#savePlan").onclick = async () => { const name = $("#pName").value.trim(), price = Number($("#pPrice").value), duration = $("#pDuration").value.trim(); if (!name || price < 0 || !duration) return alert("Plan name, price and duration are required."); await addDoc(collection(db, "wifi_plans"), { name, price, duration, description: $("#pDescription").value.trim(), status: $("#pStatus").value, sortOrder: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); $("#modalRoot").innerHTML = ""; await loadTab("wifi"); };
}

async function finalizeRemittance(id) {
  const r = remittances.find(x => x.id === id); if (!r) return;
  const actual = Number(prompt(`Expected collection: ${money(r.expectedCollection)}\nEnter actual remittance amount:`)); if (!Number.isFinite(actual) || actual < 0) return;
  const variance = actual - Number(r.expectedCollection || 0); if (!confirm(`Finalize ${r.remittanceId} for ${money(actual)}? Variance: ${money(variance)}`)) return;
  await updateDoc(doc(db, "remittances", id), { actualRemittance: actual, variance, status: "REMITTED", authorizedBy: auth.currentUser.uid, authorizedAt: serverTimestamp() });
  await audit("ADMIN_REMIT_AUTHORIZED", id, { actualRemittance: actual, variance });
  for (const tid of (r.transactionIds || [])) await updateDoc(doc(db, "cashierTransactions", tid), { remittanceFinalized: true, remittanceAuthorizedAt: serverTimestamp() });
  await addDoc(collection(db, "notifications"), { type: "cashier-remittance", title: "Cashier remittance finalized", message: `${r.cashierName} remitted ${money(actual)}. Variance ${money(variance)}.`, relatedId: id, read: false, createdAt: serverTimestamp() });
  await loadTab("remittances");
}

function start() {
  if (authResolved) return;
  setLoading("Checking Admin access", "Verifying your Admin session…");
  onAuthStateChanged(auth, async (user) => {
    if (authResolved) return;
    if (!user) {
      // Firebase may briefly have no user while restoring a session. Give it a moment.
      setLoading("Checking Admin access", "Restoring your Admin session…");
      setTimeout(() => { if (!authResolved && !auth.currentUser) deny(); }, 5000);
      return;
    }
    try {
      const profile = await withTimeout(getDoc(doc(db, "users", user.uid)), 8000, "Admin profile check");
      if (!profile.exists() || profile.data()?.role !== "admin" || profile.data()?.active === false) return deny();
      authResolved = true;
      showApp();
      render();
      // Load only the visible Cashiers tab first. Other sections load when opened.
      await loadTab("cashiers");
    } catch (e) {
      console.error("[CASHIER ADMIN AUTH]", e);
      showError("Cashier Management could not load", e?.message || "Unable to verify the Admin session.");
    }
  });
}

start();
