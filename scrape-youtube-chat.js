const DB_KEY = 'yt_chat_database';
const urlParams = new URLSearchParams(window.parent.location.search);
const STREAM_ID = urlParams.get('v') || 'unknown_stream';

const chatDB = JSON.parse(localStorage.getItem(DB_KEY) || '{}');

// 1. Initial Load from LocalStorage
window.liveChatLog = chatDB[STREAM_ID] || [];
const seenKeys = new Set(window.liveChatLog.map(m => `${m.timestamp}|${m.user}|${m.message}`));

function getSortableTime(ts) {
  ts = ts.replace(/\u202F|\s/g, ' ').trim();
    
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

function saveMessage({timestamp, user, message}) {
  if (user && message) {
    const key = `${timestamp}|${user}|${message}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      window.liveChatLog.push({ timestamp, user, message });
      return true;
    }
  }
  return false;
}

function processNode(node) {
  const timestamp = node.querySelector('#timestamp')?.innerText.trim();
  const user = node.querySelector('#author-name')?.innerText.trim();
  const message = node.querySelector('#message')?.innerText.trim();

  return saveMessage({timestamp, user, message});
}

// 2. "Catch-Up" Phase: Grab what's already on screen
function scrapeExisting() {
  const nodes = document.querySelectorAll('yt-live-chat-text-message-renderer');
  const found = [];
  let newMessagesFound = false;
  
  nodes.forEach(node => {
    newMessagesFound = processNode(node) || newMessagesFound;
  });

  if(newMessagesFound) {
    persistToStorage();
  }
};

// 3. Observer Phase: Listen for future messages
const observer = new MutationObserver((mutations) => {
  const incoming = [];
  let newMessagesFound = false;
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (node.nodeName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER') {
        newMessagesFound = processNode(node) || newMessagesFound;
      }
    });
  }
  if (newMessagesFound) {
    persistToStorage();
  }
});

function persistToStorage() {
  // Sort the current log
  window.liveChatLog.sort((a, b) => getSortableTime(a.timestamp) - getSortableTime(b.timestamp));
  
  // Update the local database object
  chatDB[STREAM_ID] = window.liveChatLog;
  
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(chatDB));
    console.log(`Database updated for ${STREAM_ID}. Total in this stream: ${window.liveChatLog.length}`);
  } catch (e) {
    console.error("Storage full! Database exceeds 5MB.", e);
  }
};

// EXECUTION
const chatContainer = document.querySelector('#items.yt-live-chat-item-list-renderer');
if (chatContainer) {
  scrapeExisting(); // Get the backlog first
  observer.observe(chatContainer, { childList: true });
  console.log("Observer active. Capturing live updates...");
} else {
  console.error("Wrong context! Switch the console to 'chatframe'.");
}

function downloadLog(streamId = STREAM_ID) {
  const chatDB = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
  const data = liveChatLog;
  const text = data.map(m => `[${m.timestamp}] ${m.user}: ${m.message}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chat_vault_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
};

function clearVault(streamId) {
  if(streamId == undefined) {
    localStorage.removeItem(DB_KEY);
    window.liveChatLog = [];
    seenKeys.clear();
  } else {
    const chatDB = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    delete chatDB[streamId];
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(chatDB));
    } catch (e) {
      console.error("Storage full! Database exceeds 5MB.", e);
    }
    if(streamId == STREAM_ID) {
      window.liveChatLog = [];
      seenKeys.clear();      
    }
  }
  
  console.log("Vault wiped clean.");
}

function previewLog() {
  console.log(liveChatLog.slice(-20).map(m => `[${m.timestamp}] ${m.user}: ${m.message}`).join('\n'));  
}
