/* TEMPORARY PISO WIFI DEBUG PANEL
 * Remove this file + its script tags when live debugging is no longer needed.
 * Shows runtime errors directly on the page so the exact next step can be identified.
 */
(() => {
  if (window.__PISO_DEBUG_PANEL__) return;
  window.__PISO_DEBUG_PANEL__ = true;

  const state = { errors: [], hidden: true };
  const maxErrors = 20;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

  function ensurePanel() {
    let root = document.getElementById("pisoDebugPanel");
    if (root) return root;
    const style = document.createElement("style");
    style.id = "pisoDebugPanelStyle";
    style.textContent = `
      #pisoDebugPanel{position:fixed;inset:0;z-index:2147483647;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;pointer-events:none;background:rgba(3,10,20,.58);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:18px}
      #pisoDebugPanel .pdp-shell{width:min(980px,100%);max-height:min(88vh,760px);margin:0 auto;background:#3b0a0a;border:2px solid #ef4444;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.5);overflow:hidden;pointer-events:auto}
      #pisoDebugPanel .pdp-head{display:flex;align-items:center;gap:10px;padding:11px 13px;background:#651313;border-bottom:1px solid rgba(255,255,255,.15)}
      #pisoDebugPanel .pdp-title{font-weight:800;font-size:14px;letter-spacing:.02em;flex:1}
      #pisoDebugPanel .pdp-badge{font-size:11px;font-weight:800;background:#ef4444;padding:4px 8px;border-radius:999px}
      #pisoDebugPanel button{border:0;border-radius:8px;padding:7px 10px;font:700 11px inherit;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
      #pisoDebugPanel button:hover{background:rgba(255,255,255,.2)}
      #pisoDebugPanel .pdp-body{max-height:260px;overflow:auto;padding:10px 13px}
      #pisoDebugPanel .pdp-item{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.12)}
      #pisoDebugPanel .pdp-item:last-child{border-bottom:0}
      #pisoDebugPanel .pdp-meta{font-size:10px;opacity:.72;margin-bottom:4px}
      #pisoDebugPanel .pdp-message{font:600 12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #pisoDebugPanel .pdp-next{margin-top:8px;padding:8px 9px;border-radius:8px;background:rgba(255,255,255,.08);color:#fde68a;font-size:11px;line-height:1.4}#pisoDebugPanel .pdp-next code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#fff}#pisoDebugPanel .pdp-stack{margin-top:6px;color:#fecaca;font:500 10px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #pisoDebugPanel .pdp-empty{opacity:.7;font-size:12px}
      #pisoDebugPanel.pdp-hidden{display:none}
      @media(max-width:600px){#pisoDebugPanel{left:8px;right:8px;bottom:8px}#pisoDebugPanel .pdp-body{max-height:230px}#pisoDebugPanel .pdp-head{flex-wrap:wrap}.pdp-title{min-width:150px}}
    `;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "pisoDebugPanel";
    root.innerHTML = `<div class="pdp-shell"><div class="pdp-head"><div class="pdp-title">⚠ PISO WIFI TEMPORARY ERROR DEBUG</div><span class="pdp-badge" id="pisoDebugCount">0 errors</span><button type="button" id="pisoDebugCopy">Copy</button><button type="button" id="pisoDebugClear">Clear</button><button type="button" id="pisoDebugHide">×</button></div><div class="pdp-body" id="pisoDebugBody"><div class="pdp-empty">No errors captured.</div></div></div></div>`;
    document.body.appendChild(root);
    root.querySelector("#pisoDebugCopy").onclick = async () => {
      const text = state.errors.map(e => `[${e.time}] ${e.type}${e.operation ? ` | ${e.operation}` : ""}\n${e.context ? `Context: ${e.context}\n` : ""}${e.message}${e.stack ? `\n${e.stack}` : ""}`).join("\n\n");
      try { await navigator.clipboard.writeText(text || "No errors captured."); } catch (_) {}
    };
    root.querySelector("#pisoDebugClear").onclick = () => { state.errors.length = 0; state.hidden = false; render(); };
    root.querySelector("#pisoDebugHide").onclick = () => { state.hidden = true; render(); };
    return root;
  }

  function render() {
    const root = ensurePanel();
    root.classList.toggle("pdp-hidden", state.hidden && state.errors.length === 0);
    const count = root.querySelector("#pisoDebugCount");
    const body = root.querySelector("#pisoDebugBody");
    count.textContent = `${state.errors.length} error${state.errors.length === 1 ? "" : "s"}`;
    if (!state.errors.length) {
      body.innerHTML = `<div class="pdp-empty">No errors captured.</div>`;
      return;
    }
    body.innerHTML = state.errors.slice().reverse().map(e => {
      const permission = /permission|insufficient permissions|permission-denied/i.test(String(e.message||""));
      const next = permission ? `<div class="pdp-next"><b>Next step:</b> Firebase Firestore Rules are blocking this operation. Publish the current <code>firestore.rules</code> and repeat the action. The source above identifies the exact Firebase operation that was blocked.</div>` : "";
      return `<div class="pdp-item"><div class="pdp-meta">${esc(e.time)} · ${esc(e.type)}${e.source ? ` · ${esc(e.source)}` : ""}${e.operation ? ` · ${esc(e.operation)}` : ""}</div>${e.context ? `<div class="pdp-next" style="margin-top:0;margin-bottom:8px;color:#e2e8f0"><b>Context:</b><br>${esc(e.context)}</div>` : ""}<div class="pdp-message">${esc(e.message)}</div>${next}${e.stack ? `<div class="pdp-stack">${esc(e.stack)}</div>` : ""}</div>`;
    }).join("");
    body.scrollTop = 0;
    root.classList.remove("pdp-hidden");
  }

  function capture(message, extra = {}) {
    const text = typeof message === "string" ? message : (() => { try { return JSON.stringify(message, null, 2); } catch (_) { return String(message); } })();
    const entry = { time: new Date().toLocaleTimeString(), type: extra.type || "runtime", source: extra.source || "", operation: extra.operation || "", context: extra.context || "", message: text || "Unknown error", stack: extra.stack || "" };
    state.errors.push(entry);
    if (state.errors.length > maxErrors) state.errors.shift();
    state.hidden = false;
    render();
  }

  window.pisoDebug = { capture, getErrors: () => [...state.errors] };

  window.addEventListener("error", (event) => {
    capture(event.message || "Unknown JavaScript error", { type: "window.error", source: event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : "", stack: event.error?.stack || "" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    capture(reason?.message || reason || "Unhandled promise rejection", { type: "unhandledrejection", stack: reason?.stack || "" });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    originalConsoleError(...args);
    capture(args.map(a => a?.stack || (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(" "), { type: "console.error" });
  };

  window.addEventListener("load", () => ensurePanel());
})();
