/**
 * YouTube Live Chat Scraper
 * A tool to observe, capture, and persist YouTube live chat messages to localStorage.
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
  const streamTitle = window.parent.document.getElementById("title")?.innerText || "Untitled";
  const descElement = window.parent.document.querySelector("#description #tooltip");
  const streamDate = descElement ? new Date(extractDate(descElement.innerText.trim())) : new Date();
  const channelName = window.parent.document.querySelector("#owner #channel-name")?.innerText || "Unknown Channel";
  const scrapeDate = new Date();

  /** @type {Object} The internal database loaded from storage */
  const chatDB = JSON.parse(localStorage.getItem(dbKey) || '{}');

  /** * @typedef {Object} ChatMessage
   * @property {string} timestamp - Human readable time (e.g., "1:20" or "4:30 PM")
   * @property {string} user - Author name
   * @property {string} message - Content of the message
   */

  let streamData = chatDB[streamId] || { title: streamTitle, channel: channelName, messages: [] };

  /** @type {ChatMessage[]} The active log for the current session */
  let liveChatLog = Array.isArray(streamData) ? streamData : streamData.messages;
  
  /** @type {Set<string>} Unique keys to prevent duplicate entries */
  const seenKeys = new Set(liveChatLog.map(m => `${m.timestamp}|${m.user}|${m.message}`));

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
  function saveMessage({ timestamp, user, message }) {
    if (!timestamp || !user || !message) return false;
    timestamp = timestamp.replace(/\u202F|\s/g, ' ').trim();

    const key = `${timestamp}|${user}|${message}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      liveChatLog.push({ timestamp, user, message });
      return true;
    }
    return false;
  }

  /**
   * Processes an individual DOM node into the local data store.
   * @param {Element} node - The chat message HTML element.
   * @returns {boolean}
   */
  function processNode(node) {
    const timestamp = node.querySelector('#timestamp')?.innerText.trim();
    const user = node.querySelector('#author-name')?.innerText.trim();
    const message = node.querySelector('#message')?.innerText.trim();
    return saveMessage({ timestamp, user, message });
  }

  /**
   * Scrapes all messages currently visible in the chat history.
   */
  function scrapeExisting() {
    const nodes = document.querySelectorAll('yt-live-chat-text-message-renderer');
    let newMessagesFound = false;
    nodes.forEach(node => {
      newMessagesFound = processNode(node) || newMessagesFound;
    });
    if (newMessagesFound) persistToStorage();
  };

  /** @type {MutationObserver} Watches for new incoming chat nodes */
  const observer = new MutationObserver((mutations) => {
    let newMessagesFound = false;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER') {
          newMessagesFound = processNode(node) || newMessagesFound;
        }
      });
    }
    if (newMessagesFound) persistToStorage();
  });

  // #endregion

  // #region --- PERSISTENCE & EXPORT ---

  /**
   * Syncs the in-memory chat log to the browser's localStorage.
   */
  function persistToStorage() {
    liveChatLog.sort((a, b) => getSortableTime(a.timestamp) - getSortableTime(b.timestamp));

    chatDB[streamId] = {
      title: streamTitle,
      channel: channelName,
      streamDate: streamDate,
      scrapeDate: scrapeDate,
      messages: liveChatLog
    };

    try {
      localStorage.setItem(dbKey, JSON.stringify(chatDB));
    } catch (e) {
      console.error("Storage full! Database exceeds 5MB.", e);
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
    const text = entry.messages.map(m => `[${m.timestamp}] ${m.user}: ${m.message}`).join('\n');

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
      observer.observe(chatContainer, { childList: true });
      console.log(`Scraper active for: ${streamTitle}`);
    } else {
      console.error("Wrong context! Switch the console to 'chatframe'.");
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
      liveChatLog = [];
      seenKeys.clear();
    } else {
      const db = JSON.parse(localStorage.getItem(dbKey) || '{}');
      delete db[id];
      localStorage.setItem(dbKey, JSON.stringify(db));
      if (id === streamId) {
        liveChatLog = [];
        seenKeys.clear();
      }
    }
    console.log("Vault updated.");
  }

  function previewLog() {
    console.log(liveChatLog.slice(-20).map(m => `[${m.timestamp}] ${m.user}: ${m.message}`).join('\n'));
  }

  init();

  window.ytChatScraper = {
    scrapeExisting,
    clearVault,
    downloadLog,
    previewLog,
    init,
    listLogs,
    observer
  };

  // #endregion
})();