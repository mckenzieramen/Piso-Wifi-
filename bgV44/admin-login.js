const ADMIN_EMAIL = "bigguy@admin.com";
const ADMIN_PASSWORD = "bigguyadmin123";
const SESSION_KEY = "bigguys_admin_session";

const $ = (id) => document.getElementById(id);

function showDashboard() {
  $("loginScreen").classList.add("hidden");
  $("adminDashboard").classList.remove("hidden");
}

function showLogin() {
  $("adminDashboard").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}

function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === "true" ||
         localStorage.getItem(SESSION_KEY) === "true";
}

$("loginForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const email = $("adminEmail").value.trim().toLowerCase();
  const password = $("adminPassword").value;
  const remember = $("rememberMe").checked;

  $("loginError").textContent = "";

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    $("loginError").textContent = "Incorrect admin email or password.";
    $("adminPassword").value = "";
    return;
  }

  if (remember) {
    localStorage.setItem(SESSION_KEY, "true");
  } else {
    sessionStorage.setItem(SESSION_KEY, "true");
  }

  showDashboard();
});

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  $("adminEmail").value = "";
  $("adminPassword").value = "";
  $("rememberMe").checked = false;
  showLogin();
});

if (isLoggedIn()) {
  showDashboard();
} else {
  showLogin();
}
