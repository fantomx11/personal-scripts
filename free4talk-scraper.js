(function () {
    'use strict';

    const VAULT_NAME = "f4tSelfContainedVault";
    window.f4tScraper = window.f4tScraper || { observer: null, vault: null };

    const getMsgKey = m => `${m.timestamp}|${m.user.trim()}|${m.message.trim()}`;

    function connectVault() {
        let win = window.open("", VAULT_NAME, "width=450,height=800");
        if (!win || win.closed) {
            alert("Please allow popups to use the Chat Vault.");
            return null;
        }

        // Initialize state if first time opening
        if (!win.sessionMessages) {
            win.sessionMessages = [];
            win.seenKeys = new Set();
            setupVaultUI(win);
        }
        
        window.f4tScraper.vault = win;
        return win;
    }

    // This function now works regardless of which window calls it
    function internalAddMessage(win, message) {
        const key = getMsgKey(message);
        if (!win.seenKeys.has(key)) {
            win.seenKeys.add(key);
            win.sessionMessages.push(message);
            
            const countEl = win.document.getElementById('live-count');
            const jsonEl = win.document.getElementById('json-output');
            if (countEl) countEl.innerText = win.sessionMessages.length;
            if (jsonEl) jsonEl.value = JSON.stringify(win.sessionMessages, null, 2);
        }
    }

    function setupVaultUI(win) {
        win.document.title = "F4T Chat Vault";
        
        // Inject helper functions directly into the popup's scope
        win.downloadAsText = function() {
            if (!win.sessionMessages || win.sessionMessages.length === 0) return;
            const textContent = win.sessionMessages
                .map(m => `[${m.timestamp}] ${m.user}: ${m.message}`)
                .join('\n');

            const blob = new Blob([textContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const element = win.document.createElement('a');
            element.href = url;
            element.download = `f4t_chat_${Date.now()}.txt`;
            win.document.body.appendChild(element);
            element.click();
            win.document.body.removeChild(element);
        };

        win.manualMerge = function() {
            try {
                const input = win.document.getElementById('json-output').value;
                const imported = JSON.parse(input || "[]");
                if (Array.isArray(imported)) {
                    imported.forEach(m => internalAddMessage(win, m));
                    alert("Import/Merge complete!");
                }
            } catch(e) {
                alert("Invalid JSON format in textarea.");
            }
        };

        win.document.body.innerHTML = `
            <style>
                body { background: #1c1c1e; color: #ffffff; font-family: -apple-system, system-ui, sans-serif; padding: 20px; text-align: center; }
                .card { background: #2c2c2e; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #3a3a3c; }
                #live-count { font-size: 54px; color: #32d74b; font-weight: 800; display: block; }
                textarea {
                    width: 100%; height: 250px; background: #000; color: #32d74b;
                    font-family: monospace; font-size: 11px; border: 1px solid #3a3a3c;
                    border-radius: 8px; padding: 10px; box-sizing: border-box; margin-bottom: 10px;
                }
                button { width: 100%; padding: 14px; margin: 5px 0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
                .btn-dl { background: #0a84ff; color: #fff; }
                .btn-merge { background: #5856d6; color: #fff; }
                .label { font-size: 11px; color: #8e8e93; text-transform: uppercase; letter-spacing: 1px; }
            </style>
            <div class="card">
                <span id="live-count">0</span>
                <div class="label">Total Messages Collected</div>
            </div>
            <textarea id="json-output" placeholder="JSON data..."></textarea>
            <button class="btn-dl" onclick="downloadAsText()">Download .txt Log</button>
            <button class="btn-merge" onclick="manualMerge()">Import / Merge JSON</button>
        `;
    }

    function processNode(node) {
        if (!node || node.nodeType !== 1) return;
        const msgEl = node.hasAttribute?.('data-message-id') ? node : node.closest?.('[data-message-id]');
        
        if (msgEl && msgEl.querySelector(".user")) {
            const vault = window.f4tScraper.vault;
            if (!vault || vault.closed) return;

            const time = msgEl.querySelector(".time")?.innerText || "";
            const name = msgEl.querySelector(".username")?.innerText || "Unknown";
            const message = msgEl.querySelector(".main-content")?.innerText || "";

            internalAddMessage(vault, {
                timestamp: time.trim(),
                user: name.trim(),
                message: message.trim()
            });
        }
    }

    window.initScraper = function() {
        const vault = connectVault();
        if (!vault) return;

        if (window.f4tScraper.observer) window.f4tScraper.observer.disconnect();

        // Initial sweep
        document.querySelectorAll("[data-message-id]").forEach(el => processNode(el));

        window.f4tScraper.observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        // Check if the node itself is a message or contains messages
                        if (node.hasAttribute('data-message-id')) {
                            processNode(node);
                        } else {
                            node.querySelectorAll('[data-message-id]').forEach(processNode);
                        }
                    }
                });
            });
        });

        window.f4tScraper.observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.readyState === 'complete') {
        window.initScraper();
    } else {
        window.addEventListener('load', window.initScraper);
    }
})();
