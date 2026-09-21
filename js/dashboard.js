import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const app = document.querySelector("#app");
const loading = document.querySelector("#authLoading");

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  loading.classList.add("hidden");
  app.classList.remove("hidden");
  document.querySelector("#userEmail").textContent = user.email || "Admin";
  await loadUnits();
});

document.querySelector("#logoutBtn").onclick = async () => {
  await signOut(auth);
  window.location.replace("index.html");
};

document.querySelector("#menuBtn").onclick = () =>
  document.querySelector("#sidebar").classList.toggle("open");

async function loadUnits() {
  const body = document.querySelector("#unitsBody");
  try {
    const snap = await getDocs(collection(db, "units"));
    const units = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    document.querySelector("#totalUnits").textContent = units.length;
    if (!units.length) return;

    let gross = 0, internet = 0, owner = 0, client = 0, electricity = 0;
    body.innerHTML = units.map((u, i) => {
      const sales = Number(u.grossSales || 0);
      const ic = Number(u.internetCost ?? 1000);
      const net = Math.max(0, sales - ic);
      const os = net * Number(u.ownerSharePercent ?? 70) / 100;
      const cs = net * Number(u.clientSharePercent ?? 30) / 100;
      const el = Number(u.electricity ?? 100);
      const total = cs + el;
      gross += sales; internet += ic; owner += os; client += cs; electricity += el;
      return `<tr><td>${i+1}</td><td>${escapeHtml(u.clientName || "—")}</td>
        <td>${money(sales)}</td><td>${money(ic)}</td><td>${money(os)}</td>
        <td>${money(cs)}</td><td>${money(el)}</td><td>${money(total)}</td>
        <td><span class="badge">${escapeHtml(u.status || "Active")}</span></td></tr>`;
    }).join("");
    document.querySelector("#grossSales").textContent = money(gross);
    document.querySelector("#internetCost").textContent = money(internet);
    document.querySelector("#ownerShare").textContent = money(owner);
    document.querySelector("#clientShare").textContent = money(client);
    document.querySelector("#electricity").textContent = money(electricity);
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9" class="empty">Unable to load data. Check Firebase configuration and Firestore rules.</td></tr>`;
  }
}

document.querySelector("#search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll("#unitsBody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});

function money(n) { return new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(n); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }