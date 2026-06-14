(function () {
    'use strict';

    // --- CLOSURE STATE ---
    // Persistent memory variables are completely removed.
    let win = null;
    let lastUser = "Unknown User";
    let lastTimestamp = "Unknown Time";

    function connectVault() {
        win = window.open("", "discordManualVault", "width=450,height=800");
        if (!win || win.closed) {
            alert("Please allow popups to use the Chat Vault.");
            return;
        }

        // Only inject layout if it's a fresh window or was refreshed
        if (!win.document.getElementById('json-output')) {
            setupVaultUI();
        }
    }

    function setupVaultUI() {
        win.document.title = "Discord Chat Vault";

        win.document.body.innerHTML = `
            <style>
                body { background: #1e1f22; color: #dbdee1; font-family: "gg sans", "Noto Sans", sans-serif; padding: 20px; text-align: center; }
                .card { background: #2b2d31; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #3f4147; }
                #live-count { font-size: 54px; color: #5865f2; font-weight: 800; display: block; }
                textarea {
                    width: 100%; height: 260px; background: #111214; color: #23a55a;
                    font-family: monospace; font-size: 11px; border: 1px solid #3f4147;
                    border-radius: 4px; padding: 10px; box-sizing: border-box; margin-bottom: 15px;
                }
                button { width: 100%; padding: 15px; margin: 8px 0; border: none; border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 14px; transition: background 0.2s; }
                button:active { opacity: 0.7; }
                .btn-capture { background: #5865f2; color: #fff; margin-bottom: 12px; }
                .btn-capture:hover { background: #4752c4; }
                .btn-dl { background: #23a55a; color: #fff; }
                .btn-dl:hover { background: #1a7f43; }
                .label { font-size: 11px; color: #949ba4; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-top: 5px; }
            </style>
            <div class="card">
                <span id="live-count">0</span>
                <div class="label">Total Unique Messages Stored</div>
            </div>
            <button id="btn-capture" class="btn-capture">📸 Capture Visible Messages</button>
            <textarea id="json-output" placeholder="[]"></textarea>
            <button id="btn-dl" class="btn-dl">💾 Download .txt Log</button>
        `;

        // Bind event listeners directly from this closure context
        win.document.getElementById('btn-capture').addEventListener('click', captureVisible);
        win.document.getElementById('btn-dl').addEventListener('click', downloadAsText);
    }

    function captureVisible() {
        try {
            const textarea = win.document.getElementById('json-output');
            
            // 1. Pull and Parse the existing state straight from the DOM textbox
            let currentMessages = [];
            try {
                currentMessages = JSON.parse(textarea.value.trim() || "[]");
                if (!Array.isArray(currentMessages)) currentMessages = [];
            } catch (e) {
                // If the user cleared the box or it contains bad syntax, reset to empty array safely
                currentMessages = [];
            }

            // 2. Build a local deduplication map on the fly from the current textbox state
            const localSeenKeys = new Set(currentMessages.map(m => m.id).filter(Boolean));

            // Target the message container list items
           const elements = document.querySelectorAll('[id^="chat-messages-"]');
            
            if (elements.length === 0) {
                alert("No visible messages found on screen! Make sure you are viewing a text channel.");
                return;
            }

            let newlyAdded = 0;

            elements.forEach(messageElement => {
                const msgId = messageElement.getAttribute('id');
                if (!msgId) return;
                
                const contentElement = messageElement.querySelector('[class*=content]');

                const usernameEl = contentElement.querySelector('[id^="message-username"]');
                const timestampEl = contentElement.querySelector('[id^="message-timestamp"]');
                const contentEl = contentElement.querySelector('[id^="message-content"]');

                if (usernameEl) {
                    lastUser = usernameEl.innerText.trim();
                }
                if (timestampEl) {
                    lastTimestamp = timestampEl.getAttribute('datetime') || timestampEl.innerText.trim();
                }

                const content = contentEl ? contentEl.innerText.trim() : "";
                if (!content) return; // Skip empty blocks or system banners

                const msg = {
                    id: msgId, // Preserved so we can read it back on the next click iteration
                    username: lastUser,
                    timestamp: lastTimestamp,
                    content: content
                };

                // Deduplicate against the state we pulled out of the text box
                if (!localSeenKeys.has(msgId)) {
                    localSeenKeys.add(msgId);
                    currentMessages.push(msg);
                    newlyAdded++;
                }
            });

            // 3. Commit the updated compilation right back out to the DOM components
            textarea.value = JSON.stringify(currentMessages, null, 2);
            win.document.getElementById('live-count').innerText = currentMessages.length;
            
            console.log(`Snapshot complete. Added ${newlyAdded} items to textbox state.`);
        } catch (err) {
            console.error("Capture failed:", err);
            alert("Runtime error:\n" + err.message);
        }
    }

    function downloadAsText() {
        try {
            // Read data fresh out of the textbox string
            const textareaValue = win.document.getElementById('json-output').value.trim();
            let currentMessages = JSON.parse(textareaValue || "[]");
            
            if (!Array.isArray(currentMessages) || currentMessages.length === 0) {
                alert("No messages found inside the textbox to download!");
                return;
            }

            // Format the final output layout
            const textContent = currentMessages
                .map(m => `[${m.timestamp}] ${m.username}: ${m.content}`)
                .join('\n\n');

            const element = win.document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(textContent));
            element.setAttribute('download', `discord_snapshot_chat_${Date.now()}.txt`);
            element.style.display = 'none';
            win.document.body.appendChild(element);
            element.click();
            win.document.body.removeChild(element);
        } catch (err) {
            alert("Failed to parse text box contents for download. Make sure it is valid JSON syntax!");
        }
    }

    // Create a temporary floating trigger button
    function injectLaunchButton() {
        // Prevent duplicate buttons if script runs twice
        if (document.getElementById('vault-launcher-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'vault-launcher-btn';
        btn.innerText = '🔓 Open Chat Vault';
        
        // Style it to float cleanly in the bottom right corner
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '999999',
            backgroundColor: '#5865f2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '12px 20px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontFamily: 'sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        });

        // When clicked, open the vault and remove the button
        btn.addEventListener('click', () => {
            connectVault();
            btn.remove(); 
        });

        document.body.appendChild(btn);
    }
debugger;
    // Initialize by creating the button
    if (document.readyState === 'complete') {
        injectLaunchButton();
    } else {
        window.addEventListener('load', injectLaunchButton);
    }
})();
