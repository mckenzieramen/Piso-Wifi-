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
      const text = state.errors.map(e => `[${e.time}] ERROR TYPE: ${e.type}${e.source ? `\nSource: ${e.source}` : ""}${e.operation ? `\nOperation: ${e.operation}` : ""}${e.context ? `\nContext:\n${e.context}` : ""}\nError: ${e.message}${e.stack ? `\nStack:\n${e.stack}` : ""}`).join("\n\n");
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

  function render() {
    const root = ensurePanel();
    root.classList.remove("pdp-empty");
    const latest = state.errors[state.errors.length - 1];
    root.querySelector("#pisoDebugType").textContent = latest?.type || "NO ERROR";
    root.querySelector("#pisoDebugCount").textContent = state.errors.length ? `${state.errors.length} error${state.errors.length === 1 ? "" : "s"}` : "0 errors";
    const body = root.querySelector("#pisoDebugBody");
    if (!state.errors.length) {
      body.innerHTML = `<div class="pdp-item"><div class="pdp-meta">SYSTEM STATUS · MONITORING</div><div class="pdp-message" style="color:#bbf7d0"><b>NO ERRORS CAPTURED</b></div><div class="pdp-context">The PISO WIFI Error Details panel is active and monitoring this page. When an error occurs, its exact error type, message, operation, source, and stack will appear here automatically.</div></div>`;
      applyState();
      return;
    }
    body.innerHTML = state.errors.slice().reverse().map(e => {
      const permission = /permission|insufficient permissions|permission-denied/i.test(String(e.message||""));
      const next = permission ? `<div class="pdp-next"><b>Next step:</b> Firebase Firestore Rules are blocking this operation. Publish the current <code>firestore.rules</code> and repeat the action.</div>` : "";
      return `<div class="pdp-item"><div class="pdp-meta">${esc(e.time)} · ${esc(e.type)}${e.source ? ` · ${esc(e.source)}` : ""}${e.operation ? ` · ${esc(e.operation)}` : ""}</div>${e.context ? `<div class="pdp-context"><b>Context:</b>\n${esc(e.context)}</div>` : ""}<div class="pdp-message"><b>ERROR:</b> ${esc(e.message)}</div>${next}${e.stack ? `<div class="pdp-stack">${esc(e.stack)}</div>` : ""}</div>`;
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
