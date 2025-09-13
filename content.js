// content.js — production snapshot logger

(function () {
  // ---- State ----
  const STATE = {
    conversationId: null,
    lastSnapshotHash: null,
  };

  // ---- Port & messaging ----
  let port = null;
  let reqSeq = 0;
  const pending = new Map();
  let savingNow = false;
  let pingTimer = null;
  let scanTimer = null;

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: "driveLoggerPort" });
      port.onMessage.addListener((msg) => {
        if (msg && msg.type === "RESP" && msg.requestId && pending.has(msg.requestId)) {
          const { resolve } = pending.get(msg.requestId);
          pending.delete(msg.requestId);
          try { resolve(msg); } catch (_) {}
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        // resolve outstanding requests gracefully
        for (const [id, p] of pending.entries()) {
          try { p.resolve({ ok: false, error: "port_disconnected" }); } catch (_) {}
        }
        pending.clear();
        // try reconnect
        setTimeout(connectPort, 600);
      });
    } catch (_) {
      setTimeout(connectPort, 1000);
    }
  }
  connectPort();

  function isRuntimeAlive() {
    try { return typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.id === "string"; }
    catch (_) { return false; }
  }

  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function portCall(payload, { retries = 5 } = {}) {
    return new Promise(async (resolve) => {
      let attempts = 0;
      while (attempts < retries) {
        if (!isRuntimeAlive()) { attempts++; await delay(150 * Math.pow(2, attempts)); continue; }
        if (!port) connectPort();
        if (!port) { attempts++; await delay(150 * Math.pow(2, attempts)); continue; }
        const requestId = String(++reqSeq);
        pending.set(requestId, { resolve });
        try {
          port.postMessage({ requestId, ...payload });
          return; // resolve happens in onMessage
        } catch (_) {
          pending.delete(requestId);
          attempts++;
          await delay(150 * Math.pow(2, attempts));
        }
      }
      resolve({ ok: false, error: "port_unavailable" });
    });
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => { portCall({ type: "PING" }); }, 15000);
  }
  function stopPing() { if (pingTimer) clearInterval(pingTimer); pingTimer = null; }

  function startScanTimer() {
    stopScanTimer();
    scanTimer = setInterval(scanAndSave, 2000); // 2s polling
  }
  function stopScanTimer() { if (scanTimer) clearInterval(scanTimer); scanTimer = null; }

  // ---- Utilities ----
  function getConversationId() {
    try {
      const path = new URL(location.href).pathname || location.pathname;
      const c = path.match(/\/c\/([a-z0-9-]+)/i); if (c) return c[1];
      const g = path.match(/\/g\/([a-z0-9-]+)/i); if (g) return g[1];
    } catch (_) {}
    return "no-id";
  }

  function currentTitle() {
    try {
      const tNode = document.querySelector("h1, header h1, [data-testid='conversation-name']");
      const t = (tNode && tNode.textContent) || document.title || "ChatGPT Conversation";
      return t.replace(/\u00A0/g, " ").trim() || "ChatGPT Conversation";
    } catch (_) { return "ChatGPT Conversation"; }
  }

  function safeInnerText(el) {
    try {
      if (!el || !(el instanceof Element)) return "";
      const contentNode =
        el.querySelector("[data-message-content]") ||
        el.querySelector("[data-message-text]") ||
        el;
      const txt = contentNode.innerText || "";
      return txt.replace(/\u00A0/g, " ").trim();
    } catch (_) { return ""; }
  }

  function visible(el) {
    try {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (!style) return true;
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      return true;
    } catch (_) { return true; }
  }

  function collectMessages() {
    const list = [];
    const seenIds = new Set();
    const seenHashes = new Set();
    const pushMsg = (container, roleHint) => {
      if (!visible(container)) return;
      const id = container.getAttribute("data-message-id") || container.id || null;
      const roleNode = container.querySelector("[data-message-author-role]");
      const role = (roleNode?.getAttribute("data-message-author-role")) || roleHint || "unknown";
      const text = safeInnerText(container);
      if (!text) return;
      if (id) { if (seenIds.has(id)) return; seenIds.add(id); }
      else { const h = hash(role + "|" + text); if (seenHashes.has(h)) return; seenHashes.add(h); }
      list.push({ id: id || "no-id-" + list.length, role, text });
    };

    // Primary: data-message-id blocks
    document.querySelectorAll("[data-message-id]").forEach(el => pushMsg(el));
    // Fallback: data-testid conversation turns
    document.querySelectorAll("[data-testid^='conversation-turn-']").forEach(el => pushMsg(el));
    // Fallback: list items under feed
    const feed = document.querySelector('[role="feed"], [data-testid="conversation"]');
    if (feed) feed.querySelectorAll('[role="listitem"]').forEach(el => pushMsg(el));
    return list;
  }

  function toMarkdownTranscript(messages) {
    const title = currentTitle();
    const header = `# ${title}\n_Snapshot @ ${new Date().toISOString()}_\n`;
    const body = messages.map(m => {
      const role = (m.role || "unknown").toUpperCase();
      return `\n---\n**${role}**\n\n${m.text}\n`;
    }).join("");
    return header + body + "\n";
  }

  function hash(str) {
    let h = 0, i = 0, len = str.length;
    while (i < len) { h = (h * 31 + str.charCodeAt(i++)) | 0; }
    return String(h >>> 0);
  }

  function fileNameForStable(conversationId, title) {
    if (conversationId && conversationId !== "no-id") return `ChatGPT — ${conversationId}.md`;
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    const d = String(dt.getDate()).padStart(2,"0");
    const safeTitle = (title || "ChatGPT Conversation").replace(/[\/\\:*?"<>|]+/g, "-").slice(0, 80);
    return `${y}-${m}-${d} — ${safeTitle}.md`;
  }

  async function sendSnapshot(markdown) {
    if (savingNow) return { ok: true };
    // preflight ping
    const pong = await portCall({ type: "PING" });
    if (!pong || pong.ok !== true) return { ok: false, error: "sw_unavailable" };
    savingNow = true;
    const title = currentTitle();
    const fileName = fileNameForStable(STATE.conversationId, title);
    const resp = await portCall({ type: "SAVE_SNAPSHOT", conversationId: STATE.conversationId, content: markdown, fileName });
    savingNow = false;
    return resp;
  }

  // ---- Scanner ----
  function scanAndSave() {
    try {
      const msgs = collectMessages();
      if (!Array.isArray(msgs) || msgs.length === 0) return;
      const md = toMarkdownTranscript(msgs);
      const h = hash(md);
      if (h === STATE.lastSnapshotHash) return;
      STATE.lastSnapshotHash = h;
      sendSnapshot(md).then(() => {}).catch(() => {});
    } catch (_) {}
  }

  function resetForNewConversation() {
    STATE.conversationId = getConversationId();
    STATE.lastSnapshotHash = null;
    setTimeout(scanAndSave, 800);
    setTimeout(scanAndSave, 2000);
    setTimeout(scanAndSave, 4000);
  }

  // ---- Observers & lifecycle ----
  (function observeRouteChanges() {
    let last = location.href;
    new MutationObserver(() => {
      const now = location.href;
      if (now !== last) { last = now; resetForNewConversation(); }
    }).observe(document, { subtree: true, childList: true });
  })();

  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(scanAndSave, 300);
  });

  // Boot
  resetForNewConversation();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  startPing();
  startScanTimer();

  // Manual save hotkey
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "s") {
      scanAndSave();
    }
  });

  // User actions nudge
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setTimeout(scanAndSave, 800); setTimeout(scanAndSave, 1800); } });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    const aria = t.getAttribute && (t.getAttribute('aria-label') || t.getAttribute('data-testid'));
    if (aria && /send|submit/i.test(aria)) { setTimeout(scanAndSave, 800); setTimeout(scanAndSave, 1800); }
  });

  window.addEventListener("beforeunload", () => {
    try { observer.disconnect(); } catch (_) {}
    stopPing(); stopScanTimer();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startPing(); startScanTimer();
      setTimeout(scanAndSave, 500);
    } else {
      stopPing(); stopScanTimer();
    }
  });

  // Silence MV3 runtime reload noise
  window.addEventListener("unhandledrejection", (event) => {
    const msg = String(event?.reason || "").toLowerCase();
    if (msg.includes("extension context invalidated")) { event.preventDefault(); }
  });
})();
