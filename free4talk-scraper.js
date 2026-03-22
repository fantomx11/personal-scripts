/**
 * Free4Talk Session Scraper (V12 - Fixed Download)
 * Bypasses the "HTML source" download bug by using a direct data-string approach.
 */
(function () {
    const VAULT_NAME = "f4tSelfContainedVault";

    if (window.f4tScraper && window.f4tScraper.observer) {
        window.f4tScraper.observer.disconnect();
    }

    window.f4tScraper = { observer: null, vault: null };

    const getMsgKey = m => `${m.timestamp}|${m.user.trim()}|${m.message.trim()}`;

    function connectVault() {
        let win = window.open("", VAULT_NAME, "width=450,height=750");
        if (!win.sessionMessages) {
            win.sessionMessages = [];
            win.seenKeys = new Set();
            setupVaultUI(win);
        }
        window.f4tScraper.vault = win;
        return win;
    }

    function setupVaultUI(win) {
        win.document.title = "F4T Chat Vault";
        
        // --- INTERNAL VAULT FUNCTIONS ---
        win.downloadAsText = function() {
            if (!win.sessionMessages || win.sessionMessages.length === 0) {
                alert("No messages to download!");
                return;
            }

            // Generate text content
            const textContent = win.sessionMessages
                .map(m => `[${m.timestamp}] ${m.user}: ${m.message}`)
                .join('\n');

            // Use the 'data' URI scheme instead of Blob if Blobs are being weird
            const element = win.document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(textContent));
            element.setAttribute('download', `f4t_chat_${Date.now()}.txt`);

            element.style.display = 'none';
            win.document.body.appendChild(element);
            element.click();
            win.document.body.removeChild(element);
        };

        win.syncFromTextarea = function() {
            const area = win.document.getElementById('json-output');
            try {
                const data = JSON.parse(area.value);
                let added = 0;
                data.forEach(msg => {
                    const key = `${msg.timestamp}|${msg.user.trim()}|${msg.message.trim()}`;
                    if (!win.seenKeys.has(key)) {
                        win.seenKeys.add(key);
                        win.sessionMessages.push(msg);
                        added++;
                    }
                });
                win.document.getElementById('live-count').innerText = win.sessionMessages.length;
                area.value = JSON.stringify(win.sessionMessages);
            } catch (e) { alert("Invalid JSON."); }
        };

        win.document.body.innerHTML = `
            <style>
                body { background: #1c1c1e; color: #ffffff; font-family: sans-serif; padding: 20px; text-align: center; }
                .card { background: #2c2c2e; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #3a3a3c; }
                #live-count { font-size: 54px; color: #32d74b; font-weight: 800; display: block; }
                textarea { 
                    width: 100%; height: 280px; background: #000; color: #32d74b; 
                    font-family: monospace; font-size: 11px; border: 1px solid #3a3a3c; 
                    border-radius: 8px; padding: 10px; box-sizing: border-box; margin-bottom: 10px;
                }
                button { width: 100%; padding: 14px; margin: 5px 0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
                .btn-sync { background: #ff9f0a; color: #fff; }
                .btn-dl { background: #0a84ff; color: #fff; }
            </style>
            <div class="card">
                <span id="live-count">0</span>
                <div style="font-size:11px; color:#8e8e93;">TOTAL MESSAGES</div>
            </div>
            <textarea id="json-output" placeholder="JSON will appear here..."></textarea>
            <button class="btn-sync" onclick="window.syncFromTextarea()">🔄 Sync from Textarea</button>
            <button class="btn-dl" onclick="window.downloadAsText()">💾 Download .txt Log</button>
        `;
    }

    function processNode(node) {
        const msgWrapper = node.classList?.contains('bBveSp') ? node : node.querySelector('.sc-fzsDOv.bBveSp');
        if (!msgWrapper) return;

        const user = msgWrapper.querySelector('.name span')?.innerText;
        const messageElement = msgWrapper.querySelector('.text.main-content p') || msgWrapper.querySelector('.html.text-overflow');
        const timestamp = msgWrapper.querySelector('.time span')?.innerText || new Date().toLocaleTimeString();

        if (user && messageElement) {
            const vault = window.f4tScraper.vault;
            if (!vault || vault.closed) return;

            const msg = { timestamp: timestamp.trim(), user: user.trim(), message: messageElement.innerText.trim() };
            const key = getMsgKey(msg);
            
            if (!vault.seenKeys.has(key)) {
                vault.seenKeys.add(key);
                vault.sessionMessages.push(msg);
                
                vault.document.getElementById('live-count').innerText = vault.sessionMessages.length;
                vault.document.getElementById('json-output').value = JSON.stringify(vault.sessionMessages);
            }
        }
    }

    function init() {
        connectVault();
        const chatContainer = document.querySelector('.sc-VJcYb.gQGLVQ') || document.body;
        document.querySelectorAll('.sc-fzsDOv.bBveSp').forEach(processNode);
        window.f4tScraper.observer = new MutationObserver((mutations) => {
            mutations.forEach(m => m.addedNodes.forEach(node => { if (node.nodeType === 1) processNode(node); }));
        });
        window.f4tScraper.observer.observe(chatContainer, { childList: true, subtree: true });
    }

    init();
})();
