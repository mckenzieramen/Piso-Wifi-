/* PISO WIFI ERROR DETAILS PANEL
 * Persistent bottom-of-page error inspector for troubleshooting.
 * Always visible as a normal page section. It can be minimized/restored,
 * maximized for screenshots/details, and cleared manually.
 */
(() => {
  if (window.__PISO_DEBUG_PANEL__) return;
  window.__PISO_DEBUG_PANEL__ = true;

  const state = { errors: [], minimized: false, maximized: false };
  const maxErrors = 20;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

  function ensurePanel() {
    let root = document.getElementById("pisoDebugPanel");
    if (root) return root;

    const style = document.createElement("style");
    style.id = "pisoDebugPanelStyle";
    style.textContent = `
      #pisoDebugPanel{position:fixed;right:20px;bottom:20px;width:min(680px,calc(100vw - 40px));max-width:680px;margin:0;z-index:2147483000;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;pointer-events:none}
      #pisoDebugPanel .pdp-shell{width:100%;max-height:min(72vh,620px);background:#3b0a0a;border:2px solid #ef4444;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden;pointer-events:auto}
      #pisoDebugPanel .pdp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#651313;border-bottom:1px solid rgba(255,255,255,.15)}
      #pisoDebugPanel .pdp-title{font-weight:800;font-size:13px;letter-spacing:.02em;flex:1;min-width:0}
      #pisoDebugPanel .pdp-type{font-size:10px;font-weight:900;text-transform:uppercase;background:#ef4444;padding:4px 7px;border-radius:999px;white-space:nowrap}
      #pisoDebugPanel .pdp-badge{font-size:10px;font-weight:800;background:rgba(255,255,255,.13);padding:4px 7px;border-radius:999px;white-space:nowrap}
      #pisoDebugPanel button{border:0;border-radius:8px;padding:7px 9px;font:700 11px inherit;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
      #pisoDebugPanel button:hover{background:rgba(255,255,255,.22)}
      #pisoDebugPanel .pdp-body{max-height:420px;overflow:auto;padding:10px 13px}
      #pisoDebugPanel .pdp-item{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.12)}
      #pisoDebugPanel .pdp-item:last-child{border-bottom:0}
      #pisoDebugPanel .pdp-meta{font-size:10px;opacity:.72;margin-bottom:5px}
      #pisoDebugPanel .pdp-message{font:700 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:#fff}
      #pisoDebugPanel .pdp-next{margin-top:8px;padding:8px 9px;border-radius:8px;background:rgba(255,255,255,.08);color:#fde68a;font-size:11px;line-height:1.4}
      #pisoDebugPanel .pdp-next code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#fff}
      #pisoDebugPanel .pdp-diagnosis{margin-top:8px;padding:10px 11px;border-radius:9px;background:rgba(0,0,0,.20);border:1px solid rgba(255,255,255,.12);font-size:11px;line-height:1.5;color:#f8fafc}
      #pisoDebugPanel .pdp-diagnosis>div{margin:3px 0}
      #pisoDebugPanel .pdp-diagnosis b{color:#cbd5e1}
      #pisoDebugPanel .pdp-stack{margin-top:6px;color:#fecaca;font:500 10px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #pisoDebugPanel .pdp-context{margin-top:7px;padding:8px 9px;border-radius:8px;background:rgba(255,255,255,.06);color:#dbeafe;font:500 10px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #pisoDebugPanel.pdp-minimized .pdp-body{display:none}
      #pisoDebugPanel.pdp-maximized{position:fixed;left:12px;right:12px;top:12px;bottom:12px;width:auto;max-width:none;margin:0;display:flex;align-items:stretch;justify-content:stretch;background:rgba(3,10,20,.58);backdrop-filter:blur(4px);padding:12px;pointer-events:auto}
      #pisoDebugPanel.pdp-maximized .pdp-shell{width:100%;max-width:none;height:100%;max-height:none}
      #pisoDebugPanel.pdp-maximized .pdp-body{max-height:none;height:calc(100% - 52px)}
      @media(max-width:600px){
        #pisoDebugPanel{right:10px;bottom:10px;width:calc(100vw - 20px);max-width:none}
        #pisoDebugPanel .pdp-shell{width:100%}
        #pisoDebugPanel .pdp-head{flex-wrap:wrap}
        #pisoDebugPanel .pdp-title{min-width:145px}
        #pisoDebugPanel.pdp-maximized{inset:6px;padding:6px}
      }
    `;
    document.head.appendChild(style);

    root = document.createElement("div");
    root.id = "pisoDebugPanel";
    root.className = "";
    root.setAttribute("aria-label", "PISO WIFI Error Details");
    root.innerHTML = `
      <div class="pdp-shell">
        <div class="pdp-head">
          <div class="pdp-title">⚠ PISO WIFI ERROR DETAILS</div>
          <span class="pdp-type" id="pisoDebugType">ERROR</span>
          <span class="pdp-badge" id="pisoDebugCount">0 errors</span>
          <button type="button" id="pisoDebugMin" title="Minimize error panel">−</button>
          <button type="button" id="pisoDebugMax" title="Maximize error panel">□</button>
          <button type="button" id="pisoDebugCopy">Copy</button>
          <button type="button" id="pisoDebugClear">Clear</button>
        </div>
        <div class="pdp-body" id="pisoDebugBody"></div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector("#pisoDebugMin").onclick = () => {
      state.minimized = !state.minimized;
      if (state.minimized) state.maximized = false;
      applyState();
    };
    root.querySelector("#pisoDebugMax").onclick = () => {
      state.maximized = !state.maximized;
      if (state.maximized) state.minimized = false;
      applyState();
    };
    root.querySelector("#pisoDebugCopy").onclick = async () => {
      const text = state.errors.map(e => { const d = resolveIssue(e); return `[${e.time}] ERROR TYPE: ${e.type}${e.source ? `\nSource: ${e.source}` : ""}${e.operation ? `\nOperation: ${e.operation}` : ""}\nError: ${e.message}\nDiagnosis: ${d.match}\nSpecific Issue: ${d.issue}\nRoot Cause: ${d.root}\nResolution: ${d.resolution}\nAction: ${d.action}\nStatus: ${d.status}${e.context ? `\nContext:\n${e.context}` : ""}${e.stack ? `\nStack:\n${e.stack}` : ""}`; }).join("\n\n");
      try { await navigator.clipboard.writeText(text || "No errors captured."); } catch (_) {}
    };
    root.querySelector("#pisoDebugClear").onclick = () => {
      state.errors.length = 0;
      state.minimized = true;
      state.maximized = false;
      render();
    };
    return root;
  }

  function applyState() {
    const root = ensurePanel();
    root.classList.toggle("pdp-minimized", state.minimized);
    root.classList.toggle("pdp-maximized", state.maximized);
    const min = root.querySelector("#pisoDebugMin");
    const max = root.querySelector("#pisoDebugMax");
    min.textContent = state.minimized ? "+" : "−";
    min.title = state.minimized ? "Restore error details" : "Minimize error panel";
    max.textContent = state.maximized ? "❐" : "□";
    max.title = state.maximized ? "Restore floating panel" : "Maximize error panel";
  }

  function resolveIssue(e) {
    const msg = String(e.message || "");
    const ctx = String(e.context || "");
    const op = String(e.operation || "");
    const source = String(e.source || "");
    const hay = `${msg}\n${ctx}\n${op}\n${source}`.toLowerCase();
    const status = String(e.status || (ctx.match(/HTTP status:\s*([^\n]+)/i)?.[1] || "")).trim();
    const code = String(e.code || (ctx.match(/Error code:\s*([^\n]+)/i)?.[1] || "")).trim().toLowerCase();

    // IMPORTANT: Only return a resolution when the error signature is deterministic.
    // Unknown signatures must never be presented as a guessed fix.
    if ((/password reset|sendcustompasswordreset/.test(hay)) && (/404/.test(status) || /http 404/.test(msg) || /not found/.test(msg))) {
      return {
        match: "DETERMINISTIC",
        issue: "The password-reset request is reaching an unavailable 404 endpoint.",
        root: "The customer reset request is using a password-reset route/function that is not available at the requested URL.",
        resolution: "Use the deployed Firebase HTTPS function sendCustomPasswordReset in us-central1. The current V17 client is already configured to call the Firebase function directly instead of the old Cloudflare /api/sendCustomPasswordReset route.",
        action: "Deploy/verify the Firebase function sendCustomPasswordReset from the current project. No frontend code edit is required for this specific 404 in V17.",
        status: "CODE PATH FIXED · DEPLOYMENT VERIFICATION REQUIRED"
      };
    }
    const stageMatch = msg.match(/PASSWORD RESET FAILED \[([^\]]+)\]/i);
    if (stageMatch && /password reset|sendcustompasswordreset/.test(hay)) {
      const stage = stageMatch[1].toLowerCase();
      const stageMap = {
        input_validation: ["Input validation failed before the server attempted the reset operation.", "The submitted Client ID or Gmail did not pass the server-side format validation.", "Use a valid Client ID in CID-### format and the registered Gmail for that client.", "Correct the Client ID/Gmail values and submit again.", "INPUT VALIDATION FAILURE"],
        customer_lookup: ["Firebase could not complete the customer record lookup.", "The server failed while reading the units/customerLoginDirectory records.", "Inspect the Firebase Function server error for the customer lookup and correct the specific Firestore/database failure.", "Redeploy the updated Firebase Function and use the exact server-stage error; do not change Firestore Rules unless the server log proves a rules/client access issue.", "CUSTOMER LOOKUP FAILURE"],
        customer_validation: ["The customer record failed a server-side account validation check.", "The client record is inactive, has no registered Gmail, or the supplied Gmail does not match.", "Use the registered active client account information.", "Verify the CID and registered Gmail in the customer record.", "CUSTOMER VALIDATION FAILURE"],
        firebase_auth_lookup: ["Firebase Authentication account lookup/validation failed.", "The unit is not linked to a valid Auth user or the Auth email does not match the registered Gmail.", "Link the client unit to the correct Firebase Authentication user and ensure the emails match.", "Check the client unit's authUserId and Firebase Authentication email before changing code.", "FIREBASE AUTH ACCOUNT FAILURE"],
        recovery_request_lookup: ["The password-reset recovery record could not be read.", "The server failed while accessing passwordResetRequests.", "Inspect the server log for the Firestore failure before changing rules or client code.", "Use the exact Firebase server error at this stage as the source of truth.", "RECOVERY REQUEST LOOKUP FAILURE"],
        generate_reset_link: ["Firebase could not generate the one-time password-reset link.", "Firebase Authentication failed during generatePasswordResetLink().", "Fix the Firebase Authentication/account configuration shown by the server error; the custom email HTML is not the failing component at this stage.", "Check the deployed Function log for the generatePasswordResetLink error and correct that exact condition.", "RESET LINK GENERATION FAILURE"],
        build_reset_url: ["The generated Firebase reset link could not be converted into the PISO WIFI reset URL.", "The returned Firebase action link or configured reset page is invalid.", "Verify the configured PISO WIFI reset page URL and the generated Firebase action-link parameters.", "Use the server-stage error to correct the reset-link construction.", "RESET URL BUILD FAILURE"],
        apps_script_fetch: ["Firebase could not reach the Apps Script custom-email service.", "The server-side request to the configured Apps Script Web App failed before receiving a response.", "Verify the Apps Script Web App deployment URL is active and publicly executable by the caller, then redeploy the Apps Script if necessary.", "Check the Apps Script Web App deployment/access settings and its execution log; do not change the custom HTML email design.", "CUSTOM EMAIL SERVICE CONNECTION FAILURE"],
        apps_script_response: ["The Apps Script custom-email service returned an unsuccessful response.", "The mailer endpoint was reached, but it rejected the request or returned an invalid response.", "Fix the Apps Script Web App deployment, secret/configuration, or mailer error identified by the returned response.", "Open the Apps Script execution log for the same test and correct the exact returned error; keep the HTML template unchanged.", "CUSTOM EMAIL SERVICE RESPONSE FAILURE"],
        firestore_write: ["The email service completed, but Firebase could not record the password-reset request/status.", "The final passwordResetRequests Firestore write failed.", "Fix the Firestore write failure shown in the Firebase Function log; do not change the email flow.", "Inspect the server log for the firestore_write stage and correct only that database issue.", "FIRESTORE RECORDING FAILURE"]
      };
      const d = stageMap[stage];
      if (d) return {match:"DETERMINISTIC", issue:d[0], root:d[1], resolution:d[2], action:d[3], status:d[4]};
    }
    if (/permission-denied|insufficient permissions|permission denied/.test(hay) || code === "permission-denied") {
      return {
        match: "DETERMINISTIC",
        issue: "Firebase rejected the operation because the current caller does not have the required Firestore permission.",
        root: "Firestore Security Rules denied the requested operation.",
        resolution: "Review and deploy the project's firestore.rules, then repeat the same operation. Do not change client code unless the rules intentionally require a different access model.",
        action: "Publish the verified firestore.rules and retest the exact failed operation.",
        status: "RULES CHANGE REQUIRED"
      };
    }
    if (/functions\/not-found|function.*not found|not-found/.test(hay) || code === "functions/not-found") {
      return {
        match: "DETERMINISTIC",
        issue: "The requested Firebase HTTPS Function does not exist at the configured function endpoint.",
        root: "The function is not deployed under the expected name/region, or the client endpoint does not match the deployed function.",
        resolution: "Deploy the named Firebase function and verify its region/URL exactly matches the client configuration.",
        action: "Deploy the required Firebase function, then retest. Do not create another proxy route unless the project architecture explicitly requires one.",
        status: "FUNCTION DEPLOYMENT REQUIRED"
      };
    }
    if (/password reset|sendcustompasswordreset/.test(hay) && /failed to fetch|networkerror|load failed/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The browser could not complete the password-reset network request before receiving an application response.",
        root: "The previous implementation used a browser fetch() call directly against the regional Firebase HTTP endpoint, which can fail at the browser transport/CORS layer and produce 'Failed to fetch' with no HTTP status.",
        resolution: "Use the Firebase callable protocol for sendCustomPasswordReset. The customer portal has been changed to httpsCallable() so Firebase handles the cross-origin transport instead of a raw browser fetch().",
        action: "Deploy the updated Firebase sendCustomPasswordReset callable function, then reload the customer portal and repeat the same CID-023 recovery test. Do not add another frontend proxy for this error.",
        status: "FRONTEND TRANSPORT FIXED · FIREBASE CALLABLE DEPLOYMENT REQUIRED"
      };
    }
    if (/network request failed|failed to fetch|networkerror|load failed/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The browser could not complete the network request.",
        root: "The request failed before a normal application response was received; this is a transport-level failure.",
        resolution: "Verify the configured HTTPS endpoint is reachable and that the browser is not blocking the request due to an invalid URL, unavailable service, or CORS configuration.",
        action: "Check the exact endpoint in the captured Operation/Source and verify the corresponding deployed service before changing application code.",
        status: "TRANSPORT FAILURE · ENDPOINT VERIFICATION REQUIRED"
      };
    }
    if (/cors|access-control-allow-origin/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The browser blocked the cross-origin request because of a CORS response/configuration problem.",
        root: "The target service did not return an acceptable CORS response for this origin.",
        resolution: "Fix CORS on the target server/function and redeploy it. Do not bypass CORS from frontend JavaScript.",
        action: "Verify the deployed HTTPS function's CORS configuration, then retest the same request.",
        status: "SERVER CORS CONFIGURATION REQUIRED"
      };
    }
    if (/unauthenticated|unauthorized|401/.test(hay) || code === "unauthenticated") {
      return {
        match: "DETERMINISTIC",
        issue: "The server rejected the request because authentication was missing or invalid.",
        root: "The request reached the service but did not contain valid authentication for the operation.",
        resolution: "Authenticate with the required Firebase account/session and verify that the request is using the expected auth context.",
        action: "Verify the current authenticated session and the function's required authorization before changing code.",
        status: "AUTHENTICATION REQUIRED"
      };
    }
    if (/403/.test(status) || /forbidden/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The server understood the request but refused access (HTTP 403).",
        root: "Access is explicitly forbidden by the target service or its authorization policy.",
        resolution: "Verify the service's authorization policy and the caller's required role/claims. Do not weaken security rules as a workaround.",
        action: "Identify the exact policy denying the request, correct that policy/role if appropriate, then retest.",
        status: "AUTHORIZATION REQUIRED"
      };
    }
    if (/500/.test(status) || /internal server error/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The server returned an internal error (HTTP 500).",
        root: "The request reached the server, but server-side execution failed.",
        resolution: "Inspect the deployed function/server logs for the same timestamp and operation. Fix the server-side exception shown there before changing the client.",
        action: "Use the server log stack trace as the source of truth for the next code change.",
        status: "SERVER-SIDE FAILURE · LOGS REQUIRED"
      };
    }
    if (/404/.test(status) || /http 404|not found/.test(hay)) {
      return {
        match: "DETERMINISTIC",
        issue: "The requested URL/resource returned HTTP 404 Not Found.",
        root: "The exact requested resource is not available at the captured URL.",
        resolution: "Verify the captured endpoint/URL and deploy or restore that exact resource. Do not change unrelated code.",
        action: "Use the captured Source/Operation/Context to identify the exact missing endpoint before making a code change.",
        status: "MISSING RESOURCE · EXACT ENDPOINT VERIFICATION REQUIRED"
      };
    }
    return {
      match: "NOT DETERMINED",
      issue: "The captured error does not match a registered deterministic diagnostic rule.",
      root: "No verified root-cause signature is available from the captured information.",
      resolution: "No automatic resolution is provided because doing so would be a guess.",
      action: "Capture the full error code/message, HTTP status, operation, endpoint/source, and stack/server log before changing code.",
      status: "DIAGNOSIS REQUIRED · NO GUESSING"
    };
  }

  function render() {
    const root = ensurePanel();
    root.classList.remove("pdp-empty");
    const latest = state.errors[state.errors.length - 1];
    root.querySelector("#pisoDebugType").textContent = latest?.type || "NO ERROR";
    root.querySelector("#pisoDebugCount").textContent = state.errors.length ? `${state.errors.length} error${state.errors.length === 1 ? "" : "s"}` : "0 errors";
    const body = root.querySelector("#pisoDebugBody");
    if (!state.errors.length) {
      body.innerHTML = `<div class="pdp-item"><div class="pdp-meta">SYSTEM STATUS · MONITORING</div><div class="pdp-message" style="color:#bbf7d0"><b>NO ERRORS CAPTURED</b></div><div class="pdp-context">The PISO WIFI Error Details panel is active and monitoring this page. When an error occurs, it will identify the exact issue only when a verified diagnostic rule matches it. Unknown errors are never given a guessed resolution.</div></div>`;
      applyState();
      return;
    }
    body.innerHTML = state.errors.slice().reverse().map(e => {
      const diagnosis = resolveIssue(e);
      const tone = diagnosis.match === "DETERMINISTIC" ? "#fde68a" : "#fecaca";
      return `<div class="pdp-item">
        <div class="pdp-meta">${esc(e.time)} · ${esc(e.type)}${e.source ? ` · ${esc(e.source)}` : ""}${e.operation ? ` · ${esc(e.operation)}` : ""}</div>
        <div class="pdp-message"><b>ERROR:</b> ${esc(e.message)}</div>
        <div class="pdp-diagnosis">
          <div><b>DIAGNOSIS:</b> <span style="color:${tone}">${esc(diagnosis.match)}</span></div>
          <div><b>SPECIFIC ISSUE:</b> ${esc(diagnosis.issue)}</div>
          <div><b>ROOT CAUSE:</b> ${esc(diagnosis.root)}</div>
          <div><b>RESOLUTION:</b> ${esc(diagnosis.resolution)}</div>
          <div><b>ACTION:</b> ${esc(diagnosis.action)}</div>
          <div><b>STATUS:</b> <span style="color:${tone}">${esc(diagnosis.status)}</span></div>
        </div>
        ${e.context ? `<div class="pdp-context"><b>Captured context:</b>\n${esc(e.context)}</div>` : ""}
        ${e.stack ? `<div class="pdp-stack"><b>Stack:</b>\n${esc(e.stack)}</div>` : ""}
      </div>`;
    }).join("");
    applyState();
  }

  function capture(message, extra = {}) {
    const text = typeof message === "string" ? message : (() => { try { return JSON.stringify(message, null, 2); } catch (_) { return String(message); } })();
    const entry = {
      time: new Date().toLocaleTimeString(),
      type: extra.type || "RUNTIME ERROR",
      source: extra.source || "",
      operation: extra.operation || "",
      context: extra.context || "",
      status: extra.status || "",
      code: extra.code || "",
      message: text || "Unknown error",
      stack: extra.stack || ""
    };
    state.errors.push(entry);
    if (state.errors.length > maxErrors) state.errors.shift();
    state.minimized = false;
    state.maximized = false;
    render();
  }

  window.pisoDebug = { capture, getErrors: () => [...state.errors] };

  window.addEventListener("error", (event) => {
    capture(event.message || "Unknown JavaScript error", {
      type: "JAVASCRIPT ERROR",
      source: event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : "",
      stack: event.error?.stack || ""
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    capture(reason?.message || reason || "Unhandled promise rejection", {
      type: "UNHANDLED PROMISE",
      stack: reason?.stack || ""
    });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    originalConsoleError(...args);
    capture(args.map(a => a?.stack || (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(" "), { type: "CONSOLE ERROR" });
  };
})();
