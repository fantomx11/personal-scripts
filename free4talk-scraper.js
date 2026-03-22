/**
 * Free4Talk Manual Session Scraper (Fixed Init)
 * Captures live messages and allows manual "Prepend" of previous room data.
 */
(function () {
  // 1. Clean up existing observer if it exists
  if (window.f4tScraper && window.f4tScraper.observer) {
    window.f4tScraper.observer.disconnect();
    console.log("Previous observer disconnected.");
  }

  // 2. Initialize the global object FIRST to avoid the 'undefined' error
  window.f4tScraper = {
    controlWindow: null,
    observer: null,
    sessionMessages: [],
    seenKeys: new Set()
  };

  const dbKey = 'f4t_manual_session';
  const messageToText = m => `[${m.timestamp}] ${m.user}: ${m.message}`;

  // --- LOGIC ---

  function saveMessage(msgObj, isPrepend = false) {
    const { timestamp, user, message } = msgObj;
    if (!user || !message) return false;
    
    const key = `${timestamp}|${user.trim()}|${message.trim()}`;
    if (!window.f4tScraper.seenKeys.has(key)) {
      window.f4tScraper.seenKeys.add(key);
      isPrepend 
        ? window.f4tScraper.sessionMessages.unshift(msgObj) 
        : window.f4tScraper.sessionMessages.push(msgObj);
      return true;
    }
    return false;
  }

  function processNode(node) {
    const msgWrapper = node.classList?.contains('bBveSp') ? node : node.querySelector('.sc-fzsDOv.bBveSp');
    if (!msgWrapper) return false;

    const user = msgWrapper.querySelector('.name span')?.innerText;
    const messageElement = msgWrapper.querySelector('.text.main-content p') || msgWrapper.querySelector('.html.text-overflow');
    const timestamp = msgWrapper.querySelector('.time span')?.innerText || new Date().toLocaleTimeString();

    if (user && messageElement) {
      return saveMessage({ 
        timestamp, 
        user: user.trim(), 
        message: messageElement.innerText.trim() 
      });
    }
    return false;
  }

  function persist() {
    localStorage.setItem(dbKey, JSON.stringify(window.f4tScraper.sessionMessages));
    updateUI(); 
  }

  function loadPreviousSession() {
    const prev = JSON.parse(localStorage.getItem(dbKey) || '[]');
    let added = 0;
    // Prepend in reverse to maintain chronological order
    for (let i = prev.length - 1; i >= 0; i--) {
      if (saveMessage(prev[i], true)) added++;
    }
    persist();
    console.log(`Manual Prepend: Added ${added} messages.`);
  }

  // --- UI MANAGEMENT ---

  function updateUI() {
    const win = window.f4tScraper.controlWindow;
    if (win && !win.closed) {
      const el = win.document.getElementById('live-count');
      if (el) el.innerText = window.f4tScraper.sessionMessages.length.toLocaleString();
    }
  }

  function openController() {
    // Open the window and assign it to our pre-defined object
    window.f4tScraper.controlWindow = window.open("", "f4tControl", "width=400,height=600");
    const win = window.f4tScraper.controlWindow;
    
    if (!win) {
      console.error("Popup blocked! Please allow popups for Free4Talk.");
      return;
    }

    const html = `
      <style>
        body { background: #1c1c1e; color: #ffffff; font-family: -apple-system, sans-serif; padding: 20px; text-align: center; }
        .card { background: #2c2c2e; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        h2 { color: #0a84ff; font-size: 18px; margin-bottom: 5px; }
        #live-count { font-size: 54px; color: #32d74b; font-weight: 800; display: block; margin: 10px 0; }
        button { width: 100%; padding: 14px; margin: 8px 0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: opacity 0.2s; }
        .btn-prepend { background: #32d74b; color: #fff; }
        .btn-primary { background: #0a84ff; color: #fff; }
        .btn-secondary { background: #48484a; color: #fff; }
      </style>
      <div class="card">
        <h2>Session Messages</h2>
        <span id="live-count">${window.f4tScraper.sessionMessages.length}</span>
      </div>
      <button class="btn-prepend" id="btn-load">📥 Prepend Previous Session</button>
      <button class="btn-primary" id="btn-dl">💾 Download Log (.txt)</button>
      <button class="btn-secondary" id="btn-view">🔍 Text Preview</button>
    `;
    
    win.document.body.innerHTML = html;

    win.document.getElementById('btn-load').onclick = () => loadPreviousSession();
    win.document.getElementById('btn-dl').onclick = () => {
      const text = window.f4tScraper.sessionMessages.map(messageToText).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `f4t_session_${new Date().getTime()}.txt`;
      a.click();
    };
    win.document.getElementById('btn-view').onclick = () => {
      const pWin = window.open("", "_blank");
      pWin.document.body.innerHTML = `<pre style="padding:20px;">${window.f4tScraper.sessionMessages.map(messageToText).join('\n')}</pre>`;
    };
  }

  // --- INITIALIZE ---

  function init() {
    const chatContainer = document.querySelector('.sc-VJcYb.gQGLVQ') || document.body;
    
    // Scrape existing
    document.querySelectorAll('.sc-fzsDOv.bBveSp').forEach(processNode);
    persist();

    // Start Observer
    window.f4tScraper.observer = new MutationObserver((mutations) => {
      let changed = false;
      mutations.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && processNode(node)) changed = true;
      }));
      if (changed) persist();
    });

    window.f4tScraper.observer.observe(chatContainer, { childList: true, subtree: true });
    
    openController();
    console.log("F4T Manual Scraper Active.");
  }

  init();
})();
