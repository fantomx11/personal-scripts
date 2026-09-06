/**
 * YouTube Live Chat Scraper (Main Page -> Chat Frame Bridge)
 * Runs from the main YouTube page, accesses iframe#chatframe, and renders a floating HUD.
 */

/* Bookmarklet:
javascript:(function() {const repoUrl = 'https://fantomx11.github.io/personal-scripts/scrape-youtube-chat.js';fetch(repoUrl, {headers: {'Authorization': `token ${token}`,'Accept': 'application/vnd.github.v3.raw'}}).then(r => {if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);return r.text();}).then(code => {const script = document.createElement('script');if (window.trustedTypes && window.trustedTypes.createPolicy) {const policy = window.trustedTypes.defaultPolicy || (window.__ytScriptPolicy ??= window.trustedTypes.createPolicy('yt-script-policy', {createScript: (s) => s}));script.text = policy.createScript(code);} else {script.textContent = code;}(document.head || document.documentElement).appendChild(script);script.remove();}).catch(err => console.error('Failed to load script:', err));})();
*/
(function () {
  // #region --- STATE & SETUP ---

  if (window.ytChatScraper && window.ytChatScraper.observer) {
    window.ytChatScraper.observer.disconnect();
    console.log("Previous observer disconnected.");
  }

  const existingHUD = document.getElementById('yt-chat-scraper-root');
  if (existingHUD) existingHUD.remove();

  const dbKey = 'yt_chat_database';
  const urlParams = new URLSearchParams(window.location.search);
  const streamId = urlParams.get('v') || 'unknown_stream';

  // Read metadata directly from the main page DOM
  const title = document.querySelector('h1.ytd-watch-metadata, #title h1, #title')?.innerText?.trim() || "Untitled Stream";
  const channel = document.querySelector('#owner #channel-name, ytd-channel-name')?.innerText?.trim() || "Unknown Channel";
  const descElement = document.querySelector('#description-inline-expander, #description #tooltip');
  const extractedDateStr = descElement ? extractDate(descElement.innerText.trim()) : null;
  const streamDate = extractedDateStr ? new Date(extractedDateStr) : new Date();

  let streamData = JSON.parse(localStorage.getItem(dbKey) || '{}')[streamId] || {
    title,
    channel,
    messages: [],
    streamDate,
    scrapeDate: new Date()
  };

  const messageToText = m => `[${m.timestamp}] ${m.user}${m.isModerator ? ' (m)' : ''}: ${m.message}${m.deletedState ? ` [${m.deletedState}]` : ''}`;
  const messageCache = new Map();

  if (streamData.messages && streamData.messages.length > 0) {
    streamData.messages.forEach(m => {
      const anchor = `${m.user}|${m.timestamp}`;
      if (!messageCache.has(anchor)) messageCache.set(anchor, new Set());
      messageCache.get(anchor).add(m.message);
    });
  }

  let activeChatDoc = null;
  const observer = new MutationObserver(handleMutations);

  // #endregion

  // #region --- TRUSTED TYPES SECURITY SHIM ---

  let trustedPolicy = { createHTML: s => s };
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
      trustedPolicy = window.trustedTypes.createPolicy('ytScraperMain-' + Date.now(), {
        createHTML: s => s
      });
    }
  } catch (_) {
    try {
      trustedPolicy = window.trustedTypes.defaultPolicy || trustedPolicy;
    } catch (_) {}
  }

  // #endregion

  // #region --- DATA EXTRACTION & SORTING ---

  function extractDate(input) {
    if (!input) return undefined;
    const match = input.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}/);
    return match ? match[0] : undefined;
  }

  function getSortableTime(ts) {
    if (!ts) return 0;
    if (ts.startsWith('-') || !ts.includes('M')) {
      const isNeg = ts.startsWith('-');
      const parts = ts.replace('-', '').split(':').map(Number);
      const s = parts.length === 3 ? (parts[0] * 3600) + (parts[1] * 60) + parts[2] : (parts[0] * 60) + parts[1];
      return isNeg ? -s : s;
    }
    const match = ts.match(/(\d{1,2}):(\d{2})\s?([AP]M)/i);
    if (!match) return 0;
    let [_, hrs, mins, meridiem] = match;
    hrs = parseInt(hrs, 10);
    if (meridiem.toUpperCase() === 'PM' && hrs !== 12) hrs += 12;
    if (meridiem.toUpperCase() === 'AM' && hrs === 12) hrs = 0;
    return (hrs * 3600) + (parseInt(mins, 10) * 60);
  }

  // #endregion

  // #region --- SCRAPING ENGINE ---

  function saveMessage({ timestamp, user, isModerator, message, deletedState }) {
    if (!timestamp || !user || !message) return false;
    timestamp = timestamp.replace(/\u202F|\s/g, ' ').trim();
    message = message.trim();

    const anchor = `${user}|${timestamp}`;
    if (!messageCache.has(anchor)) messageCache.set(anchor, new Set());

    const messageSet = messageCache.get(anchor);

    if (messageSet.has(message)) {
      let existingMsg = null;
      for (let i = streamData.messages.length - 1; i >= 0; i--) {
        const m = streamData.messages[i];
        if (m.user === user && m.timestamp === timestamp && m.message === message) {
          existingMsg = m;
          break;
        }
      }
      if (existingMsg && existingMsg.deletedState !== deletedState) {
        existingMsg.deletedState = deletedState;
        return true;
      }
      return false;
    }

    streamData.messages.push({ timestamp, user, isModerator, message, deletedState });
    messageSet.add(message);

    if (messageCache.size > 3000) {
      const oldestKey = messageCache.keys().next().value;
      messageCache.delete(oldestKey);
    }
    return true;
  }

  function processNode(node) {
    const timestamp = node.querySelector('#timestamp')?.innerText.trim();

    if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER') {
      const user = node.querySelector('#author-name')?.innerText.trim();
      const isModerator = node.querySelector('#author-name')?.classList.contains("moderator") || false;
      const messageElement = node.querySelector('#message');
      const deletedState = node.querySelector('#deleted-state')?.innerText.trim();

      if (!messageElement) return false;

      let fullMessage = "";
      messageElement.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          fullMessage += child.textContent;
        } else if (child.nodeName === 'IMG') {
          const alt = child.getAttribute('alt') || "";
          const isCustom = /^[a-zA-Z0-9-_]+$/.test(alt);
          fullMessage += (isCustom && !alt.startsWith(':')) ? `:${alt}:` : alt;
        }
      });

      return saveMessage({ timestamp, user, isModerator, message: fullMessage.trim(), deletedState });
    }

    if (node.nodeName === 'YT-LIVE-CHAT-MODERATION-MESSAGE-RENDERER') {
      const modMessage = node.querySelector('#message')?.innerText.trim();
      return saveMessage({ timestamp, user: "MODERATION", isModerator: false, message: modMessage });
    }

    return false;
  }

  function handleMutations(mutations) {
    let found = false;
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        m.addedNodes.forEach(node => {
          if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER' || node.nodeName === 'YT-LIVE-CHAT-MODERATION-MESSAGE-RENDERER') {
            found = processNode(node) || found;
          }
        });
      }
      if (m.type === 'characterData' || (m.type === 'childList' && m.addedNodes.length === 0)) {
        const parentRenderer = m.target.parentElement?.closest('yt-live-chat-text-message-renderer');
        if (parentRenderer) found = processNode(parentRenderer) || found;
      }
    }
    if (found) persistToStorage();
  }

  function scrapeExistingInFrame(chatDoc) {
    const nodes = chatDoc.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-moderation-message-renderer');
    let found = false;
    nodes.forEach(node => { found = processNode(node) || found; });
    if (found) persistToStorage();
  }

  // #endregion

  // #region --- STORAGE & EXPORT ---

  function persistToStorage() {
    const chatDB = JSON.parse(localStorage.getItem(dbKey) || '{}');
    streamData.messages.sort((a, b) => getSortableTime(a.timestamp) - getSortableTime(b.timestamp));
    chatDB[streamId] = streamData;

    try {
      localStorage.setItem(dbKey, JSON.stringify(chatDB));
      updateLiveCounter();
    } catch (e) {
      console.error("Storage limit reached or failed!", e);
    }
  }

  function downloadLog(id = streamId) {
    const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    const entry = db[id];
    if (!entry) return alert("No log entry found for ID: " + id);

    const validDate = entry.streamDate ? new Date(entry.streamDate) : new Date();
    const dateFormatted = new Intl.DateTimeFormat('en-CA').format(isNaN(validDate) ? new Date() : validDate);
    const logTitle = `${entry.channel} - ${dateFormatted} - ${entry.title}`;
    const text = entry.messages.map(messageToText).join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat_${logTitle.replace(/[^\w\s-]/gi, '').substring(0, 50) || id}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function clearVault(id) {
    const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    if (id === undefined) {
      localStorage.removeItem(dbKey);
      streamData.messages = [];
      messageCache.clear();
    } else {
      delete db[id];
      localStorage.setItem(dbKey, JSON.stringify(db));
      if (id === streamId) {
        streamData.messages = [];
        messageCache.clear();
      }
    }
    updateLiveCounter();
    renderVaultList();
  }

  function listLogs() {
    const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    return Object.keys(db).map(id => ({
      id,
      channel: db[id].channel,
      title: db[id].title,
      messages: db[id].messages.length
    }));
  }

  // #endregion

  // #region --- IFRAME BRIDGE & INITIALIZATION ---

  function getChatDocument() {
    const frame = document.querySelector('iframe#chatframe, iframe[src*="live_chat"]');
    if (!frame) return null;
    try {
      return frame.contentDocument || frame.contentWindow?.document || null;
    } catch (e) {
      console.warn("Cross-origin restriction or frame access error:", e);
      return null;
    }
  }

  function initBridge() {
    observer.disconnect();
    const chatDoc = getChatDocument();
    const statusText = document.getElementById('yt-hud-status-text');

    if (!chatDoc) {
      if (statusText) statusText.innerText = "Frame not detected";
      return false;
    }

    activeChatDoc = chatDoc;
    const chatContainer = chatDoc.querySelector('#items.yt-live-chat-item-list-renderer');

    if (chatContainer) {
      scrapeExistingInFrame(chatDoc);
      observer.observe(chatContainer, { childList: true, subtree: true, characterData: true });
      if (statusText) statusText.innerText = "Connected";
      return true;
    }

    // Frame found, but items container not ready yet (e.g. Chat is still loading)
    if (statusText) statusText.innerText = "Chat loading...";
    return false;
  }

  // Listen for iframe reload / navigation
  const frameEl = document.querySelector('iframe#chatframe, iframe[src*="live_chat"]');
  if (frameEl) {
    frameEl.addEventListener('load', () => {
      setTimeout(initBridge, 1200);
    });
  }

  // #endregion

  // #region --- FLOATING HUD (DRAGGABLE & COLLAPSIBLE) ---

  function updateLiveCounter() {
    const countStr = streamData.messages.length.toLocaleString();
    const pill = document.getElementById('yt-hud-pill-count');
    const badge = document.getElementById('yt-hud-badge-count');
    if (pill) pill.innerText = countStr;
    if (badge) badge.innerText = countStr;
  }

  function renderVaultList() {
    const listContainer = document.getElementById('yt-hud-vault');
    if (!listContainer) return;
    const logs = listLogs();

    if (logs.length === 0) {
      listContainer.innerHTML = trustedPolicy.createHTML('<div style="color:#777;font-size:12px;padding:8px 0;">Vault is empty.</div>');
      return;
    }

    listContainer.innerHTML = trustedPolicy.createHTML(logs.map(log => `
      <div style="background:#222;padding:8px 10px;margin-bottom:6px;border-radius:4px;border-left:3px solid #3ea6ff;font-size:12px;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${log.title}">${log.title}</div>
        <div style="color:#888;font-size:11px;">${log.channel} • ${log.messages} msgs</div>
        <div style="display:flex;gap:12px;margin-top:4px;">
          <a data-dl="${log.id}" style="color:#3ea6ff;cursor:pointer;text-decoration:none;">Download</a>
          <a data-del="${log.id}" style="color:#ff5555;cursor:pointer;text-decoration:none;">Delete</a>
        </div>
      </div>
    `).join(''));

    listContainer.querySelectorAll('[data-dl]').forEach(el => {
      el.onclick = () => downloadLog(el.dataset.dl);
    });
    listContainer.querySelectorAll('[data-del]').forEach(el => {
      el.onclick = () => {
        if (confirm("Delete this log?")) clearVault(el.dataset.del);
      };
    });
  }

  function mountHUD() {
    const root = document.createElement('div');
    root.id = 'yt-chat-scraper-root';
    root.style.cssText = `
      position: fixed;
      top: 80px;
      right: 30px;
      z-index: 999999999;
      font-family: Roboto, -apple-system, sans-serif;
      font-size: 13px;
      color: #eee;
      user-select: none;
    `;

    const html = `
      <!-- Collapsed Pill Bar -->
      <div id="yt-hud-pill" style="
        display: none;
        align-items: center;
        gap: 8px;
        background: #0f0f0f;
        border: 1px solid #3ea6ff;
        padding: 6px 14px;
        border-radius: 20px;
        cursor: grab;
        box-shadow: 0 4px 14px rgba(0,0,0,0.6);
      ">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00e676;"></span>
        <span>Chat Scraper (<strong id="yt-hud-pill-count">${streamData.messages.length.toLocaleString()}</strong> msgs)</span>
        <button id="yt-hud-expand" style="background:transparent;border:none;color:#aaa;cursor:pointer;padding:0 0 0 6px;font-size:14px;">🗖</button>
      </div>

      <!-- Expanded Main HUD -->
      <div id="yt-hud-window" style="
        display: flex;
        flex-direction: column;
        width: 320px;
        max-height: 85vh;
        background: #141414;
        border: 1px solid #2e2e2e;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.7);
        overflow: hidden;
      ">
        <div id="yt-hud-header" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: #1f1f1f;
          border-bottom: 1px solid #2e2e2e;
          cursor: grab;
        ">
          <span style="font-weight:600;display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00e676;"></span>
            Chat Scraper (<span id="yt-hud-status-text" style="font-size:11px;color:#aaa;font-weight:normal;">Connecting...</span>)
          </span>
          <button id="yt-hud-collapse" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:16px;">—</button>
        </div>

        <div style="padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
          <div style="background:#1c281c;border-left:3px solid #00e676;padding:8px 10px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:11px;color:#00e676;font-weight:600;">ACTIVE SESSION</div>
              <div style="font-size:16px;font-weight:bold;"><span id="yt-hud-badge-count">${streamData.messages.length.toLocaleString()}</span> msgs</div>
            </div>
            <button id="yt-hud-reconnect" style="background:#2e7d32;color:white;border:none;padding:6px 9px;border-radius:4px;cursor:pointer;font-size:11px;">🔄 Reconnect</button>
          </div>

          <div>
            <label style="font-size:11px;color:#888;">STREAM TITLE</label>
            <input type="text" id="yt-hud-title" value="${streamData.title.replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box;background:#202020;border:1px solid #333;color:#eee;padding:6px;border-radius:4px;font-size:12px;margin-top:2px;">
          </div>

          <div style="display:flex;gap:6px;">
            <button id="yt-hud-save-meta" style="flex:1;background:#3ea6ff;color:#000;font-weight:600;border:none;padding:6px;border-radius:4px;cursor:pointer;">Save</button>
            <button id="yt-hud-dl-curr" style="flex:2;background:#333;color:#fff;border:none;padding:6px;border-radius:4px;cursor:pointer;">Download Log (.txt)</button>
          </div>

          <div style="font-size:11px;font-weight:600;color:#aaa;margin-top:6px;text-transform:uppercase;">Stored Vault Logs</div>
          <div id="yt-hud-vault" style="max-height:160px;overflow-y:auto;padding-right:2px;"></div>

          <button id="yt-hud-clear-all" style="background:transparent;border:1px solid #ff4e4e;color:#ff4e4e;padding:6px;border-radius:4px;cursor:pointer;font-size:11px;margin-top:4px;">Wipe Stored Vault</button>
        </div>
      </div>
    `;

    root.innerHTML = trustedPolicy.createHTML(html);
    document.body.appendChild(root);

    // Draggable handling
    function bindDrag(handle) {
      let isDragging = false;
      let startX, startY, origLeft, origTop;

      handle.addEventListener('mousedown', (e) => {
        if (['BUTTON', 'A', 'INPUT'].includes(e.target.tagName)) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = root.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        handle.style.cursor = 'grabbing';
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        root.style.left = `${Math.max(10, origLeft + (e.clientX - startX))}px`;
        root.style.top = `${Math.max(10, origTop + (e.clientY - startY))}px`;
        root.style.right = 'auto';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          handle.style.cursor = 'grab';
        }
      });
    }

    bindDrag(document.getElementById('yt-hud-header'));
    bindDrag(document.getElementById('yt-hud-pill'));

    // Collapse / Expand
    const pill = document.getElementById('yt-hud-pill');
    const win = document.getElementById('yt-hud-window');

    document.getElementById('yt-hud-collapse').onclick = () => {
      win.style.display = 'none';
      pill.style.display = 'flex';
    };

    document.getElementById('yt-hud-expand').onclick = () => {
      pill.style.display = 'none';
      win.style.display = 'flex';
    };

    // Button actions
    document.getElementById('yt-hud-reconnect').onclick = () => {
      const ok = initBridge();
      alert(ok ? "Scraper connected to chat frame." : "Could not find chat frame elements. Make sure live chat is visible.");
    };

    document.getElementById('yt-hud-save-meta').onclick = () => {
      streamData.title = document.getElementById('yt-hud-title').value;
      persistToStorage();
      alert("Metadata saved.");
    };

    document.getElementById('yt-hud-dl-curr').onclick = () => downloadLog();

    document.getElementById('yt-hud-clear-all').onclick = () => {
      if (confirm("Permanently wipe all stored scrape logs?")) clearVault();
    };

    renderVaultList();
  }

  // #endregion

  // Initialize UI & poll briefly for iframe ready state
  mountHUD();
  if (!initBridge()) {
    let attempts = 0;
    const poller = setInterval(() => {
      attempts++;
      if (initBridge() || attempts > 10) clearInterval(poller);
    }, 1500);
  }

  window.ytChatScraper = {
    init: initBridge,
    downloadLog,
    clearVault,
    listLogs,
    observer,
    streamData
  };
})();
