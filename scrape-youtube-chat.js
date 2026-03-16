/**
 * YouTube Live Chat Scraper
 * A tool to observe, capture, and persist YouTube live chat messages to localStorage.
 * 
 * * @author Gemini
 * @version 1.1.0
 */
(function () {
  // #region --- INITIALIZATION & STATE ---

  if (window.ytChatScraper && window.ytChatScraper.observer) {
    window.ytChatScraper.observer.disconnect();
    console.log("Existing observer disconnected to prevent duplicates.");
  }

  /** @const {string} Key used for localStorage */
  const dbKey = 'yt_chat_database';
  const urlParams = new URLSearchParams(window.parent.location.search);
  const streamId = urlParams.get('v') || 'unknown_stream';

  /** @type {string} Metadata pulled from the parent YouTube page */
  const title = window.parent.document.getElementById("title")?.innerText || "Untitled";
  const descElement = window.parent.document.querySelector("#description #tooltip");
  const streamDate = descElement ? new Date(extractDate(descElement.innerText.trim())) : new Date();
  const channel = window.parent.document.querySelector("#owner #channel-name")?.innerText || "Unknown Channel";
  const scrapeDate = new Date();

  /** @type {Object} The internal database loaded from storage */
  const chatDB = JSON.parse(localStorage.getItem(dbKey) || '{}');

  /** * @typedef {Object} ChatMessage
   * @property {string} timestamp - Human readable time (e.g., "1:20" or "4:30 PM")
   * @property {string} user - Author name
   * @property {string} message - Content of the message
   */

  let streamData = chatDB[streamId] || {
    title,
    channel,
    messages: [],
    streamDate,
    scrapeDate
  };

  const messageToText = m => `[${m.timestamp}] ${m.user}${m.isModerator ? ' (m)' : ''}: ${m.message}${m.deletedState ? ` [${m.deletedState}]` :  ''}`;

  /** @type {Set<string>} Unique keys to prevent duplicate entries */
  const seenKeys = new Set(streamData.messages.map(m => `${m.timestamp}|${m.user}|${m.message}`));

  // #endregion

  // #region --- DATA PARSING UTILITIES ---

  /**
   * Extracts a date string (MMM DD, YYYY) from YouTube's description tooltip.
   * @param {string} input - The raw text from the date tooltip.
   * @returns {string|undefined}
   */
  function extractDate(input) {
    const dateRegex = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}/;
    const extractedDate = input.match(dateRegex);
    return extractedDate ? extractedDate[0] : undefined;
  }

  /**
   * Converts a YouTube chat timestamp into a sortable integer (seconds).
   * @param {string} ts - The timestamp string from the chat UI.
   * @returns {number} Seconds from start or start of day.
   */
  function getSortableTime(ts) {
    if (ts.startsWith('-') || !ts.includes('M')) {
      const isNeg = ts.startsWith('-');
      const parts = ts.replace('-', '').split(':').map(Number);
      let s = parts.length === 3 ? (parts[0] * 3600) + (parts[1] * 60) + parts[2] : (parts[0] * 60) + parts[1];
      return isNeg ? -s : s;
    }
    const match = ts.match(/(\d{1,2}):(\d{2})\s?([AP]M)/i);
    if (!match) return 0;
    let [_, hrs, mins, meridiem] = match;
    hrs = parseInt(hrs, 10);
    if (meridiem.toUpperCase() === 'PM' && hrs !== 12) hrs += 12;
    if (meridiem.toUpperCase() === 'AM' && hrs === 12) hrs = 0;
    return (hrs * 3600) + (parseInt(mins, 10) * 60);
  };

  // #endregion

  // #region --- SCRAPING ENGINE ---

  /**
   * Validates and saves a message object if it doesn't already exist.
   * @param {ChatMessage} param0 - The message components.
   * @returns {boolean} True if message was unique and added.
   */
  function saveMessage({ timestamp, user, isModerator, message, deletedState }) {
    if (!timestamp || !user || !message) return false;
    timestamp = timestamp.replace(/\u202F|\s/g, ' ').trim();

    // The key remains based on the original message unique identity
    const key = `${timestamp}|${user}|${message}`;
    
    if (!seenKeys.has(key)) {
      // It's a brand new message
      seenKeys.add(key);
      streamData.messages.push({ timestamp, user, isModerator, message, deletedState });
      return true;
    } else {
      // Message exists, check if we need to update the deletedState
      const existingMsg = streamData.messages.find(m => 
        m.timestamp === timestamp && m.user === user && m.message === message
      );

      // Only update and return true if the deletedState has actually changed (e.g. from null to "Hidden by X")
      if (existingMsg && existingMsg.deletedState !== deletedState) {
        existingMsg.deletedState = deletedState;
        return true; 
      }
    }
    return false;
  }

/**
   * Processes an individual DOM node into the local data store.
   */
  function processNode(node) {
    const timestamp = node.querySelector('#timestamp')?.innerText.trim();
    
    // Handle Regular Chat Messages
    if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER') {
      const user = node.querySelector('#author-name')?.innerText.trim();
      const isModerator = node.querySelector('#author-name')?.classList.contains("moderator") || false;
      const messageElement = node.querySelector('#message');
      const deletedState = node.querySelector('#deleted-state')?.innerText.trim();

      let fullMessage = "";
      messageElement.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          fullMessage += child.textContent;
        } else if (child.nodeName === 'IMG') {
          let alt = child.getAttribute('alt') || "";
          const isCustomEmote = /^[a-zA-Z0-9-_]+$/.test(alt);
          fullMessage += (isCustomEmote && !alt.startsWith(':')) ? `:${alt}:` : alt;
        }
      });

      return saveMessage({ 
        timestamp, 
        user, 
        isModerator, 
        message: fullMessage.trim(), 
        deletedState 
      });
    }

    // Handle System Moderation Messages (Timeouts/Bans shown in chat)
    if (node.nodeName === 'YT-LIVE-CHAT-MODERATION-MESSAGE-RENDERER') {
      const modMessage = node.querySelector('#message')?.innerText.trim();
      return saveMessage({
        timestamp,
        user: "MODERATION", // Labeling these as system events
        isModerator: false,
        message: modMessage,
        isSystemAction: true // Flag to distinguish from regular chat
      });
    }

    return false;
  }

  /**
   * Scrapes all messages currently visible in the chat history.
   */
  function scrapeExisting() {
    const nodes = document.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-moderation-message-renderer');
    let newMessagesFound = false;
    nodes.forEach(node => {
      newMessagesFound = processNode(node) || newMessagesFound;
    });
    if (newMessagesFound) persistToStorage();
  };

  /** @type {MutationObserver} Watches for new nodes and internal text changes */
  const observer = new MutationObserver((mutations) => {
    let newMessagesFound = false;
    for (const mutation of mutations) {
      // 1. Handle brand new messages
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER' || 
              node.nodeName === 'YT-LIVE-CHAT-MODERATION-MESSAGE-RENDERER') {
            newMessagesFound = processNode(node) || newMessagesFound;
          }
        });
      }
      
      // 2. Handle updates to existing messages (Deletions/Timeouts)
      // Checks for text changes (characterData) or internal UI swaps (childList)
      if (mutation.type === 'characterData' || (mutation.type === 'childList' && mutation.addedNodes.length === 0)) {
        const messageNode = mutation.target.parentElement?.closest('yt-live-chat-text-message-renderer');
        if (messageNode) {
          newMessagesFound = processNode(messageNode) || newMessagesFound;
        }
      }
    }
    if (newMessagesFound) persistToStorage();
  });

  // #endregion

  // #region --- PERSISTENCE & EXPORT ---

  /**
   * Syncs the in-memory chat log to the browser's localStorage.
   */
  function persistToStorage() {
    streamData.messages.sort((a, b) => getSortableTime(a.timestamp) - getSortableTime(b.timestamp));
    chatDB[streamId] = streamData;

    try {
      localStorage.setItem(dbKey, JSON.stringify(chatDB));
      console.log(`Database updated for ${streamId}. Total: ${streamData.messages.length}`);
      
      // NEW: Update the pop-up counter if the window is open
      updateLiveCounter();
    } catch (e) {
      console.error("Storage full!", e);
    }
  };

  /**
   * Triggers a browser download of the chat log as a text file.
   * @param {string} [id=streamId] - The ID of the stream to export.
   */
  function downloadLog(id = streamId) {
    const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    const entry = db[id];
    if (!entry) return console.error("No data for:", id);

    const dateFormatted = new Intl.DateTimeFormat('en-CA').format(new Date(entry.streamDate));
    const title = `${entry.channel} - ${dateFormatted} - ${entry.title}`;
    const text = entry.messages.map(messageToText).join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeTitle = title.replace(/[^\w\s-]/gi, '').substring(0, 50);
    a.download = `chat_${safeTitle || id}.txt`;
    a.click();
  }

  // #endregion

  // #region --- PUBLIC API & CONTROLS ---

  /**
   * Initializes the scraper by finding the chat container and starting the observer.
   */
  function init() {
    observer.disconnect();
    const chatContainer = document.querySelector('#items.yt-live-chat-item-list-renderer');
    if (chatContainer) {
      scrapeExisting();
      // subtree: true is required to see changes inside the message renderer
      observer.observe(chatContainer, { 
        childList: true, 
        subtree: true, 
        characterData: true 
      });
      console.log(`Scraper active: Capturing all moderation events for ${title}`);
    }
  }


  /**
   * Returns a list of all streams currently saved in the local vault.
   * @returns {Array}
   */
  function listLogs() {
    const currentDB = JSON.parse(localStorage.getItem(dbKey) || '{}');
    return Object.keys(currentDB).map(id => ({
      id,
      channel: currentDB[id].channel,
      title: currentDB[id].title,
      messages: currentDB[id].messages.length
    }));
  }

  /**
   * Removes data from the vault.
   * @param {string} [id] - Stream ID to clear. If blank, clears everything.
   */
  function clearVault(id) {
    if (id === undefined) {
      localStorage.removeItem(dbKey);
      streamData.messages = [];
      seenKeys.clear();
    } else {
      const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
      delete db[id];
      localStorage.setItem(dbKey, JSON.stringify(db));
      if (id === streamId) {
        streamData.messages = [];
        seenKeys.clear();
      }
    }
    console.log("Vault updated.");
  }

  function previewLog() {
    console.log(streamData.messages.slice(-20).map(m => `[${m.timestamp}] ${m.user}: ${m.message}`).join('\n'));
  }

  init();

  window.ytChatScraper = {
    scrapeExisting,
    clearVault,
    downloadLog,
    previewLog,
    init,
    listLogs,
    observer,
    streamData,
    controlWindow: null,
    openController
  };

  // #endregion

// #region --- SECURE UI CONTROLLER ---

  function updateLiveCounter() {
    if (ytChatScraper && ytChatScraper.controlWindow && !ytChatScraper.controlWindow.closed) {
      const counterEl = ytChatScraper.controlWindow.document.getElementById('live-count');
      if (counterEl) {
        counterEl.innerText = streamData.messages.length.toLocaleString();
      }
    }
  }

  /** * Create a Trusted Types policy to bypass "TrustedHTML" blocks 
   */
  const policy = window.trustedTypes?.createPolicy('youtube-scraper-policy', {
    createHTML: (string) => string
  }) || { createHTML: (string) => string };

  function openController() {
    // Open a standalone window
    ytChatScraper.controlWindow = window.open("", "ytScraperControl", "width=420,height=750,menubar=no,status=no");
    
    if (!ytChatScraper.controlWindow) {
      console.error("Pop-up blocked! Please enable pop-ups for YouTube.");
      return;
    }

    // Inject styles securely
    const style = ytChatScraper.controlWindow.document.createElement('style');
    style.textContent = `
      body { background: #121212; color: #e0e0e0; font-family: 'Segoe UI', Roboto, sans-serif; padding: 20px; line-height: 1.5; }
      h2 { color: #ff0000; font-size: 20px; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 10px; }
      .card { background: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #333; }
      label { display: block; font-size: 12px; color: #aaa; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
      input { width: 100%; background: #2d2d2d; border: 1px solid #444; color: white; padding: 10px; margin-bottom: 15px; border-radius: 4px; box-sizing: border-box; }
      button { width: 100%; padding: 10px; cursor: pointer; margin-bottom: 10px; border: none; border-radius: 4px; font-weight: bold; transition: opacity 0.2s; }
      button:hover { opacity: 0.8; }
      .btn-primary { background: #3ea6ff; color: #000; }
      .btn-secondary { background: #444; color: white; }
      .btn-danger { background: transparent; color: #ff4e4e; border: 1px solid #ff4e4e; margin-top: 20px; }
      .vault-item { background: #252525; padding: 10px; margin-bottom: 10px; border-radius: 6px; border-left: 3px solid #3ea6ff; }
      .vault-title { font-weight: bold; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .vault-meta { font-size: 11px; color: #888; }
      .vault-actions { display: flex; gap: 15px; margin-top: 8px; font-size: 12px; }
      .vault-actions a { color: #3ea6ff; text-decoration: none; cursor: pointer; }
      .vault-actions a.del { color: #ff4e4e; }
    `;
    ytChatScraper.controlWindow.document.head.appendChild(style);

    renderPopupContent();
  }

  function renderPopupContent() {
    if (!ytChatScraper.controlWindow) return;

    const logs = listLogs();
    const dateVal = (streamData.streamDate instanceof Date && !isNaN(streamData.streamDate))
      ? streamData.streamDate.toISOString().split('T')[0] 
      : new Date().toISOString().split('T')[0];

    const htmlContent = `
      <h2>Live Scraper Controller</h2>

      <div class="card" style="border-left: 4px solid #00ff00; background: #1a2a1a;">
        <label style="color: #00ff00;">Live Session Status</label>
        <div style="font-size: 24px; font-weight: bold;">
          <span id="live-count">${streamData.messages.length.toLocaleString()}</span> 
          <span style="font-size: 14px; color: #888; font-weight: normal;">messages</span>
        </div>
        <button id="btn-reconnect" style="margin-top: 10px; background: #2e7d32; color: white; font-size: 11px;">
          🔄 Reconnect Scraper (Fix Chat Switch)
        </button>
      </div>
      
      <div class="card">
        <label>Current Stream Title</label>
        <input type="text" id="pop-title" value="${streamData.title}">
        
        <label>Stream Date</label>
        <input type="date" id="pop-date" value="${dateVal}">
        
        <button class="btn-primary" id="btn-update">Save Metadata</button>
        <button class="btn-secondary" id="btn-dl-current">Download Current Log (.txt)</button>
        <button class="btn-secondary" id="btn-view-current">Open Text Preview</button>
      </div>

      <h3>Stream Vault</h3>
      <div id="vault-list">
        ${logs.length === 0 ? '<p style="color:#666">No saved logs found.</p>' : logs.map(log => `
          <div class="vault-item">
            <span class="vault-title">${log.title}</span>
            <span class="vault-meta">channel: ${log.channel} • ${log.messages} messages • ID: ${log.id}</span>
            <div class="vault-actions">
              <a data-id="${log.id}" class="vault-dl">Download</a>
              <a data-id="${log.id}" class="vault-del del">Delete</a>
            </div>
          </div>
        `).join('')}
      </div>

      <button class="btn-danger" id="btn-clear-vault">Wipe All Stored Data</button>
    `;

    // Apply HTML via the Trusted Types policy
    ytChatScraper.controlWindow.document.body.innerHTML = policy.createHTML(htmlContent);

    // --- BINDING EVENTS ---
    const doc = ytChatScraper.controlWindow.document;

    // Reconnect Logic
    doc.getElementById('btn-reconnect').onclick = () => {
      const success = init();
      if (success) {
        alert("Scraper reconnected to the current chat view.");
      } else {
        alert("Failed to reconnect. Make sure chat is visible.");
      }
    };

    doc.getElementById('btn-update').onclick = () => {
      streamData.title = doc.getElementById('pop-title').value;
      streamData.streamDate = new Date(doc.getElementById('pop-date').value);
      persistToStorage();
      alert("Metadata updated for this session.");
    };

    doc.getElementById('btn-dl-current').onclick = () => downloadLog();

    doc.getElementById('btn-view-current').onclick = () => {
      const logText = streamData.messages.map(messageToText).join('\n');
      const viewWin = window.open("", "_blank");
      viewWin.document.body.innerHTML = policy.createHTML(`<pre style="word-wrap: break-word; white-space: pre-wrap;">${logText}</pre>`);
      
      setTimeout(() => viewWin.document.body.innerHTML = policy.createHTML(`<pre style="word-wrap: break-word; white-space: pre-wrap;">${logText}</pre>`), 1000);
    };

    doc.getElementById('btn-clear-vault').onclick = () => {
      if(confirm("This will permanently delete ALL logs in localStorage. Proceed?")) {
        clearVault();
        renderPopupContent();
      }
    };

    doc.querySelectorAll('.vault-dl').forEach(el => {
      el.onclick = () => downloadLog(el.dataset.id);
    });
    
    doc.querySelectorAll('.vault-del').forEach(el => {
      el.onclick = () => {
        if(confirm("Delete this log?")) {
          clearVault(el.dataset.id);
          renderPopupContent();
        }
      };
    });
  }

  // Start the controller
  openController();

  setTimeout(openController, 1000);

  // #endregion
})();
