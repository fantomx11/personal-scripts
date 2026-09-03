// ==UserScript==
// @name         Gemini Folder Explorer (Batch API Sync)
// @namespace    https://gemini.google.com/
// @version      9.0
// @description  Full account conversation sync via MaZiqc RPC, Windows Explorer directory tree, and JSON backup
// @match        https://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__GEMINI_EXPLORER_LOOP__) {
    clearInterval(window.__GEMINI_EXPLORER_LOOP__);
  }

  const STORAGE_KEY = 'gemini_explorer_state_v9';

  let state = {
    activeTab: 'folders', // 'recents' | 'folders'
    currentFolderId: null, // null = Root
    folders: [],          // [ { id: 'f_xxx', name: 'Work', parentId: null } ]
    assignments: {},      // { [chatId]: folderId | null }
    chats: {}             // { [chatId]: { id, title, isPinned, updatedAt } }
  };

  let pendingActionChatId = null;
  let lastNavigatedChatId = null;
  let lastNavigatedTime = 0;
  let lastRenderHash = '';
  let isSyncing = false;

  // Global styling for explorer rows and hover-swapping menu buttons
  function injectStyles() {
    let style = document.getElementById('g-explorer-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'g-explorer-styles';
      document.head.appendChild(style);
    }
    style.textContent = `
      #g-explorer-root {
        width: 100%;
        box-sizing: border-box;
      }
      #g-explorer-root gem-nav-list-item {
        position: relative !important;
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #g-explorer-root gem-nav-list-item a.mat-mdc-list-item {
        position: relative !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #g-explorer-root .hovered-trailing-content {
        position: absolute !important;
        right: 6px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        display: none !important;
        align-items: center !important;
        justify-content: flex-end !important;
        z-index: 10 !important;
        height: 32px !important;
        width: auto !important;
        gap: 2px !important;
        pointer-events: auto !important;
      }
      #g-explorer-root gem-nav-list-item:hover .hovered-trailing-content,
      #g-explorer-root gem-nav-list-item:focus-within .hovered-trailing-content {
        display: flex !important;
      }
      #g-explorer-root gem-nav-list-item:hover .trailing-icon-container,
      #g-explorer-root gem-nav-list-item:focus-within .trailing-icon-container {
        opacity: 0 !important;
        visibility: hidden !important;
      }
      #g-explorer-root .hovered-trailing-content button,
      #g-explorer-root .gem-conversation-actions-menu-button button {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 26px !important;
        height: 26px !important;
        border: none !important;
        background: transparent !important;
        border-radius: 50% !important;
        cursor: pointer !important;
        color: inherit !important;
        opacity: 0.7 !important;
        font-size: 13px !important;
        transition: opacity 0.15s ease, background-color 0.15s ease !important;
      }
      #g-explorer-root .hovered-trailing-content button:hover,
      #g-explorer-root .gem-conversation-actions-menu-button button:hover {
        opacity: 1 !important;
        background: rgba(255, 255, 255, 0.12) !important;
      }
      #g-explorer-root .g-f-actions {
        display: none !important;
      }
      #g-explorer-root gem-nav-list-item:hover .g-f-actions {
        display: inline-flex !important;
      }
    `;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) state = Object.assign(state, JSON.parse(saved));
    } catch (e) {
      console.error('[Gemini Explorer] Load error:', e);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('[Gemini Explorer] Save error:', e);
    }
  }

  function extractChatId(url) {
    if (!url) return null;
    const match = url.match(/\/app\/([a-zA-Z0-9_-]{8,})/);
    const reserved = ['prompts', 'gems', 'history', 'settings', 'user', 'library'];
    return (match && !reserved.includes(match[1].toLowerCase())) ? match[1] : null;
  }

  // Dynamically extract Google Boq session and XSRF tokens
  function getWizTokens() {
    let at = window.WIZ_global_data?.SNlM0e;
    let fsid = window.WIZ_global_data?.FdrFJe;
    let bl = window.WIZ_global_data?.cfb2h;

    if (!at || !fsid || !bl) {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!at) {
          const m = text.match(/"SNlM0e":"([^"]+)"/);
          if (m) at = m[1];
        }
        if (!fsid) {
          const m = text.match(/"FdrFJe":"([^"]+)"/);
          if (m) fsid = m[1];
        }
        if (!bl) {
          const m = text.match(/"cfb2h":"([^"]+)"/);
          if (m) bl = m[1];
        }
        if (at && fsid && bl) break;
      }
    }

    return {
      at: at || 'AOvx0lLIRruhNSH9xoO-M8Ezurk7:1788444295401',
      fsid: fsid || '5089642545433359866',
      bl: bl || 'boq_assistant-bard-web-server_20260901.17_p0'
    };
  }

  // Parse Google batchexecute response chunks
  function parseBatchExecuteResponse(rawText) {
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[[') && trimmed.includes('"MaZiqc"')) {
        try {
          const parsed = JSON.parse(trimmed);
          for (const item of parsed) {
            if (item && item[1] === 'MaZiqc' && typeof item[2] === 'string') {
              const inner = JSON.parse(item[2]);
              return {
                cursor: inner[1] || null,
                chats: Array.isArray(inner[2]) ? inner[2] : []
              };
            }
          }
        } catch (e) {}
      }
    }
    return { cursor: null, chats: [] };
  }

  // Paged fetcher using MaZiqc RPC to collect the user's full chat history
  async function fetchAllConversations(progressCallback) {
    if (isSyncing) return;
    isSyncing = true;

    const { at, fsid, bl } = getWizTokens();
    let cursor = null;
    let totalLoaded = 0;
    let page = 1;
    let reqId = Math.floor(Math.random() * 899999) + 100000;

    try {
      while (true) {
        reqId += 10000;
        const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&source-path=${encodeURIComponent(window.location.pathname)}&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fsid)}&hl=en&_reqid=${reqId}&rt=c`;

        // Request batches of 50 conversations per RPC call
        const rpcPayload = JSON.stringify([50, cursor, [0, null, 1]]);
        const fReq = JSON.stringify([[["MaZiqc", rpcPayload, null, "generic"]]]);

        const body = new URLSearchParams({
          'f.req': fReq,
          'at': at
        }).toString();

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-same-domain': '1'
          },
          body: body,
          credentials: 'include'
        });

        if (!resp.ok) {
          console.warn(`[Gemini Explorer] Batch sync returned HTTP ${resp.status}`);
          break;
        }

        const text = await resp.text();
        const result = parseBatchExecuteResponse(text);

        if (!result.chats || result.chats.length === 0) {
          break;
        }

        result.chats.forEach((chat) => {
          const rawId = chat[0];
          if (!rawId) return;
          const id = rawId.replace(/^c_/, '');
          const title = chat[1] || `Conversation (${id.slice(0, 6)})`;
          const time = (chat[5] && chat[5][0]) ? chat[5][0] * 1000 : Date.now();

          if (!state.chats[id]) {
            state.chats[id] = { id, title, isPinned: false, updatedAt: time };
          } else {
            state.chats[id].title = title;
            state.chats[id].updatedAt = time;
          }
        });

        totalLoaded += result.chats.length;
        if (progressCallback) progressCallback(totalLoaded, page);

        if (!result.cursor || result.cursor === cursor) {
          break;
        }

        cursor = result.cursor;
        page++;
        await new Promise((r) => setTimeout(r, 200)); // Polite throttle
      }
    } catch (err) {
      console.error('[Gemini Explorer] Sync failed:', err);
    } finally {
      isSyncing = false;
      saveState();
      requestRender();
    }

    return totalLoaded;
  }

  // Intercept native chat deletions via confirmation dialogs
  document.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-test-id="actions-menu-button"]');
    if (actionBtn) {
      const row = actionBtn.closest('gem-nav-list-item') || actionBtn.closest('[data-chat-id]');
      const anchor = row ? row.querySelector('a[href*="/app/"]') : null;
      if (anchor) {
        pendingActionChatId = extractChatId(anchor.getAttribute('href'));
      }
      return;
    }

    const btn = e.target.closest('button');
    if (btn && pendingActionChatId) {
      const btnText = btn.textContent.trim().toLowerCase();
      const inDialog = btn.closest('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container');
      if (inDialog && btnText === 'delete') {
        const deletedId = pendingActionChatId;
        pendingActionChatId = null;
        setTimeout(() => purgeChat(deletedId), 300);
      }
    }
  }, true);

  function purgeChat(chatId) {
    if (!chatId) return;
    delete state.assignments[chatId];
    delete state.chats[chatId];
    saveState();
    requestRender();
  }

  function harvestMetadata() {
    const list = document.querySelector('conversations-list[data-test-id="all-conversations"]');
    if (!list) return;

    let updated = false;
    const items = list.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]');
    items.forEach((item) => {
      const a = item.querySelector('a[href*="/app/"]');
      if (!a) return;

      const id = extractChatId(a.getAttribute('href'));
      if (!id) return;

      const titleEl = a.querySelector('.title-text');
      const title = titleEl ? titleEl.textContent.trim() : a.getAttribute('aria-label') || '';
      const isPinned = !!a.querySelector('mat-icon[fonticon="push_pin"], mat-icon[data-mat-icon-name="push_pin"]');

      if (title && title.toLowerCase() !== 'new chat') {
        if (!state.chats[id] || state.chats[id].title !== title || state.chats[id].isPinned !== isPinned) {
          state.chats[id] = { id, title, isPinned, updatedAt: Date.now() };
          updated = true;
        }
      }
    });

    const currentId = extractChatId(window.location.pathname);
    if (currentId && !state.chats[currentId]) {
      const headerTitle = document.querySelector('title')?.textContent.replace(/ - Gemini$/, '').trim();
      state.chats[currentId] = {
        id: currentId,
        title: headerTitle && headerTitle !== 'Gemini' ? headerTitle : `Conversation (${currentId.slice(0, 6)})`,
        isPinned: false,
        updatedAt: Date.now()
      };
      updated = true;
    }

    if (updated) saveState();
  }

  function checkDeadLinks() {
    if (lastNavigatedChatId && Date.now() - lastNavigatedTime < 3500) {
      const currentPath = window.location.pathname;
      if (currentPath === '/app' || currentPath === '/app/') {
        const deadId = lastNavigatedChatId;
        lastNavigatedChatId = null;
        if (state.chats[deadId]) {
          console.warn(`[Gemini Explorer] Chat ${deadId} was deleted on server. Purging.`);
          purgeChat(deadId);
        }
      }
    }
  }

  function setCustomDragGhost(e, label, icon) {
    const ghost = document.createElement('div');
    ghost.style.cssText = `
      position: fixed; top: -1000px; left: -1000px; padding: 6px 12px;
      background: #282a2c; color: #e3e3e3; border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px; font-family: inherit; font-size: 12px; font-weight: 500;
      display: inline-flex; align-items: center; gap: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); max-width: 220px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      z-index: 100000; pointer-events: none;
    `;
    ghost.innerHTML = `<span>${icon}</span><span style="overflow:hidden; text-overflow:ellipsis;">${label}</span>`;
    document.body.appendChild(ghost);

    e.dataTransfer.setDragImage(ghost, 20, 16);
    setTimeout(() => ghost.remove(), 0);
  }

  function getPathAncestors(folderId) {
    const crumbs = [{ id: null, name: 'Root' }];
    if (!folderId) return crumbs;

    const stack = [];
    let curr = state.folders.find((f) => f.id === folderId);
    while (curr) {
      stack.unshift({ id: curr.id, name: curr.name });
      curr = state.folders.find((f) => f.id === curr.parentId);
    }
    return crumbs.concat(stack);
  }

  function isDescendant(sourceId, targetId) {
    let curr = state.folders.find((f) => f.id === targetId);
    while (curr) {
      if (curr.parentId === sourceId) return true;
      curr = state.folders.find((f) => f.id === curr.parentId);
    }
    return false;
  }

  function removeFolder(folderId) {
    const target = state.folders.find((f) => f.id === folderId);
    if (!target) return;

    const pId = target.parentId;
    state.folders.forEach((f) => {
      if (f.parentId === folderId) f.parentId = pId;
    });
    Object.keys(state.assignments).forEach((cid) => {
      if (state.assignments[cid] === folderId) state.assignments[cid] = pId;
    });

    state.folders = state.folders.filter((f) => f.id !== folderId);
    if (state.currentFolderId === folderId) state.currentFolderId = pId;

    saveState();
    requestRender();
  }

  function exportJSON() {
    const data = {
      version: 9,
      date: new Date().toISOString(),
      folders: state.folders,
      assignments: state.assignments,
      chats: state.chats
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini_folders_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (!parsed.folders || !parsed.assignments) {
            alert('Invalid file format.');
            return;
          }
          if (confirm('Import folder configuration? This will merge all saved folders and chats.')) {
            state.folders = parsed.folders;
            state.assignments = Object.assign(state.assignments, parsed.assignments);
            if (parsed.chats) {
              state.chats = Object.assign(state.chats, parsed.chats);
            }
            state.currentFolderId = null;
            saveState();
            requestRender();
          }
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function getAngularAttributes() {
    const livingNode = document.querySelector('gem-nav-list-item[data-test-id="conversation"]') ||
                       document.querySelector('conversations-list');
    const attrs = {};
    if (livingNode) {
      for (const attr of livingNode.attributes) {
        if (attr.name.startsWith('_ngcontent') || attr.name.startsWith('_nghost')) {
          attrs[attr.name] = attr.value;
        }
      }
    }
    return attrs;
  }

  function ensureTabBar(headerRow) {
    let tabContainer = document.getElementById('g-explorer-tabs');
    if (!tabContainer) {
      tabContainer = document.createElement('div');
      tabContainer.id = 'g-explorer-tabs';
      tabContainer.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        width: 100%; padding: 4px 12px 8px 12px; box-sizing: border-box;
      `;
      headerRow.parentElement.insertBefore(tabContainer, headerRow);
    }

    headerRow.style.display = 'none';

    tabContainer.innerHTML = `
      <div style="display: inline-flex; background: rgba(128,128,128,0.12); padding: 2px; border-radius: 8px; gap: 2px;">
        <button id="g-tab-recents" class="gds-body-s" style="
          padding: 4px 12px; border: none; border-radius: 6px; cursor: pointer; color: inherit;
          background: ${state.activeTab === 'recents' ? 'rgba(128,128,128,0.25)' : 'transparent'};
          font-weight: ${state.activeTab === 'recents' ? '600' : 'normal'};
          opacity: ${state.activeTab === 'recents' ? '1' : '0.65'};
        ">Recents</button>
        <button id="g-tab-folders" class="gds-body-s" style="
          padding: 4px 12px; border: none; border-radius: 6px; cursor: pointer; color: inherit;
          background: ${state.activeTab === 'folders' ? 'rgba(128,128,128,0.25)' : 'transparent'};
          font-weight: ${state.activeTab === 'folders' ? '600' : 'normal'};
          opacity: ${state.activeTab === 'folders' ? '1' : '0.65'};
        ">Folders</button>
      </div>
    `;

    tabContainer.querySelector('#g-tab-recents').onclick = () => {
      state.activeTab = 'recents';
      saveState();
      requestRender();
    };

    tabContainer.querySelector('#g-tab-folders').onclick = () => {
      state.activeTab = 'folders';
      saveState();
      requestRender();
    };
  }

  function createParentDirectoryRow(parentFolder) {
    const ngAttrs = getAngularAttributes();
    const parentName = parentFolder ? parentFolder.name : 'Root';
    const targetParentId = parentFolder ? parentFolder.id : null;

    const item = document.createElement('gem-nav-list-item');
    item.className = 'has-hovered-trailing-content ng-star-inserted';
    Object.keys(ngAttrs).forEach((attr) => item.setAttribute(attr, ngAttrs[attr]));

    item.innerHTML = `
      <a mat-list-item="" theme="lm"
         class="mat-mdc-list-item mdc-list-item mat-mdc-tooltip-trigger gem-nav-list-item gmat-override mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta mat-mdc-list-item-both-leading-and-trailing lm-enabled mat-mdc-list-item-single-line mdc-list-item--with-one-line ng-star-inserted"
         tabindex="0" style="cursor: pointer; user-select: none; opacity: 0.85;">
        <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container mdc-list-item__start">
          <span style="font-size: 15px; display: inline-flex; align-items: center; justify-content: center; width: 24px;">📁</span>
        </div>
        <span class="mdc-list-item__content">
          <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
            <span class="label-and-badge menu-entry-with-badge ng-star-inserted">
              <span dir="auto" class="title-text gds-body-s" style="font-style: italic;">.. [Up to ${parentName}]</span>
            </span>
          </span>
        </span>
        <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content gmat-override">
          <span class="gds-body-s" style="font-size: 10.5px; opacity: 0.45;">Drop to move up</span>
          <div class="trailing-slot-content ng-star-inserted"></div>
        </div>
        <div class="mat-focus-indicator"></div>
      </a>
    `;

    item.querySelectorAll('*').forEach((el) => {
      Object.keys(ngAttrs).forEach((attr) => el.setAttribute(attr, ngAttrs[attr]));
    });

    const a = item.querySelector('a');

    a.ondblclick = (e) => {
      e.stopPropagation();
      state.currentFolderId = targetParentId;
      saveState();
      requestRender();
    };

    a.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      a.style.background = 'rgba(138, 180, 248, 0.18)';
      a.style.borderRadius = '24px';
    };

    a.ondragleave = (e) => {
      e.stopPropagation();
      a.style.background = '';
    };

    a.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      a.style.background = '';

      const type = e.dataTransfer.getData('text/gemini-type');
      const id = e.dataTransfer.getData('text/gemini-id');

      if (type === 'chat' && id) {
        state.assignments[id] = targetParentId;
        saveState();
        requestRender();
      } else if (type === 'folder' && id) {
        if (!targetParentId || !isDescendant(id, targetParentId)) {
          const dragged = state.folders.find((f) => f.id === id);
          if (dragged) {
            dragged.parentId = targetParentId;
            saveState();
            requestRender();
          }
        }
      }
    };

    return item;
  }

  function createConversationRow(chatMeta, parentFolderId) {
    const isActive = window.location.pathname.includes(chatMeta.id);
    const ngAttrs = getAngularAttributes();
    const canMoveUp = state.currentFolderId !== null;

    const item = document.createElement('gem-nav-list-item');
    item.setAttribute('data-test-id', 'conversation');
    item.setAttribute('data-chat-id', chatMeta.id);
    item.className = 'has-hovered-trailing-content ng-star-inserted';
    Object.keys(ngAttrs).forEach((attr) => item.setAttribute(attr, ngAttrs[attr]));

    item.innerHTML = `
      <a mat-list-item="" theme="lm" draggable="true"
         class="mat-mdc-list-item mdc-list-item mat-mdc-tooltip-trigger gem-nav-list-item gmat-override mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta mat-mdc-list-item-both-leading-and-trailing lm-enabled mat-mdc-list-item-single-line mdc-list-item--with-one-line ng-star-inserted ${isActive ? 'is-active mdc-list-item--activated' : ''}"
         href="/app/${chatMeta.id}" aria-label="${chatMeta.title}" tabindex="0">
        <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container removed mdc-list-item__start"></div>
        <span class="mdc-list-item__content">
          <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
            <span class="label-and-badge menu-entry-with-badge ng-star-inserted">
              <span dir="auto" class="title-text ${isActive ? 'gds-emphasized-body-s' : 'gds-body-s'}">${chatMeta.title}</span>
            </span>
          </span>
        </span>
        <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content gmat-override">
          ${chatMeta.isPinned ? `
            <span matlistitemicon="" class="mat-mdc-list-item-icon trailing-icon-container mdc-list-item__start ng-star-inserted">
              <gem-icon class="gem-nav-list-item-icon">
                <mat-icon role="img" class="mat-icon notranslate lm-icon-s lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" fonticon="push_pin"></mat-icon>
              </gem-icon>
            </span>` : ''}
          <div class="trailing-slot-content ng-star-inserted"></div>
        </div>
        <div class="mat-focus-indicator"></div>
      </a>
      <div class="hovered-trailing-content ng-star-inserted">
        ${canMoveUp ? `<button class="g-chat-up-btn" title="Move to parent directory">⇡</button>` : ''}
        <gem-icon-button tabindex="-1" theme="lm" type="onSurface" data-test-id="actions-menu-button" class="mat-mdc-menu-trigger gem-conversation-actions-menu-button gem-button gem-button-badge-size-small gem-button-size-xsmall gem-button-type-on-surface lm-enabled">
          <button maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden ng-star-inserted" aria-label="More options for ${chatMeta.title}">
            <span class="mat-mdc-button-persistent-ripple mdc-icon-button__ripple"></span>
            <gem-icon>
              <mat-icon role="img" class="mat-icon notranslate lm-icon-m lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted" fonticon="more_vert"></mat-icon>
            </gem-icon>
            <span class="mat-focus-indicator"></span>
            <span class="mat-mdc-button-touch-target"></span>
          </button>
        </gem-icon-button>
      </div>
    `;

    item.querySelectorAll('*').forEach((el) => {
      Object.keys(ngAttrs).forEach((attr) => el.setAttribute(attr, ngAttrs[attr]));
    });

    const a = item.querySelector('a');

    a.ondragstart = (e) => {
      e.dataTransfer.setData('text/gemini-type', 'chat');
      e.dataTransfer.setData('text/gemini-id', chatMeta.id);
      e.dataTransfer.effectAllowed = 'move';
      setCustomDragGhost(e, chatMeta.title, '💬');
    };

    a.onclick = (e) => {
      e.preventDefault();
      lastNavigatedChatId = chatMeta.id;
      lastNavigatedTime = Date.now();

      const nativeA = document.querySelector(`conversations-list a[href*="${chatMeta.id}"]`);
      if (nativeA) {
        nativeA.click();
      } else {
        window.location.href = `/app/${chatMeta.id}`;
      }
      setTimeout(requestRender, 250);
    };

    const upBtn = item.querySelector('.g-chat-up-btn');
    if (upBtn) {
      upBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.assignments[chatMeta.id] = parentFolderId;
        saveState();
        requestRender();
      };
    }

    const actionBtn = item.querySelector('[data-test-id="actions-menu-button"]');
    if (actionBtn) {
      actionBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        pendingActionChatId = chatMeta.id;

        const nativeItem = document.querySelector(`conversations-list gem-nav-list-item a[href*="${chatMeta.id}"]`);
        if (nativeItem) {
          const nativeBtn = nativeItem.closest('gem-nav-list-item').querySelector('[data-test-id="actions-menu-button"] button');
          if (nativeBtn) {
            nativeBtn.click();
            return;
          }
        }

        const promptText = canMoveUp
          ? `Conversation: "${chatMeta.title}"\n1: Move to parent folder\n2: Move to Root\n3: Rename in records\n4: Delete record\n(Type 1, 2, 3, or 4):`
          : `Conversation: "${chatMeta.title}"\n1: Move to Root\n2: Rename in records\n3: Delete record\n(Type 1, 2, or 3):`;

        const action = prompt(promptText);
        if (canMoveUp && action === '1') {
          state.assignments[chatMeta.id] = parentFolderId;
          saveState();
          requestRender();
        } else if ((canMoveUp && action === '2') || (!canMoveUp && action === '1')) {
          delete state.assignments[chatMeta.id];
          saveState();
          requestRender();
        } else if ((canMoveUp && action === '3') || (!canMoveUp && action === '2')) {
          const newName = prompt('New title:', chatMeta.title);
          if (newName && newName.trim()) {
            chatMeta.title = newName.trim();
            state.chats[chatMeta.id].title = newName.trim();
            saveState();
            requestRender();
          }
        } else if ((canMoveUp && action === '4') || (!canMoveUp && action === '3')) {
          purgeChat(chatMeta.id);
        }
      };
    }

    return item;
  }

  function createFolderRow(folder, parentFolderId) {
    const ngAttrs = getAngularAttributes();
    const canMoveUp = state.currentFolderId !== null;

    const item = document.createElement('gem-nav-list-item');
    item.setAttribute('data-folder-id', folder.id);
    item.className = 'has-hovered-trailing-content ng-star-inserted';
    Object.keys(ngAttrs).forEach((attr) => item.setAttribute(attr, ngAttrs[attr]));

    const subCount = state.folders.filter((f) => f.parentId === folder.id).length;
    const chatCount = Object.keys(state.assignments).filter((cid) => state.assignments[cid] === folder.id).length;
    const total = subCount + chatCount;

    item.innerHTML = `
      <a mat-list-item="" theme="lm" draggable="true"
         class="mat-mdc-list-item mdc-list-item mat-mdc-tooltip-trigger gem-nav-list-item gmat-override mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta mat-mdc-list-item-both-leading-and-trailing lm-enabled mat-mdc-list-item-single-line mdc-list-item--with-one-line ng-star-inserted"
         tabindex="0" style="cursor: pointer; user-select: none;">
        <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container mdc-list-item__start">
          <span style="font-size: 15px; display: inline-flex; align-items: center; justify-content: center; width: 24px;">📁</span>
        </div>
        <span class="mdc-list-item__content">
          <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
            <span class="label-and-badge menu-entry-with-badge ng-star-inserted">
              <span dir="auto" class="title-text gds-body-s">${folder.name}</span>
            </span>
          </span>
        </span>
        <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content gmat-override">
          <span class="gds-body-s" style="font-size: 11px; opacity: 0.5; margin-right: 4px;">(${total})</span>
          <div class="g-f-actions" style="display: inline-flex; gap: 2px; opacity: 0.6;">
            ${canMoveUp ? `<button class="g-f-up" title="Move folder to parent directory" style="background: none; border: none; cursor: pointer; color: inherit; font-size: 12px; padding: 2px 4px;">⇡</button>` : ''}
            <button class="g-f-ren" title="Rename" style="background: none; border: none; cursor: pointer; color: inherit; font-size: 11px; padding: 2px 4px;">✎</button>
            <button class="g-f-del" title="Delete" style="background: none; border: none; cursor: pointer; color: inherit; font-size: 11px; padding: 2px 4px;">✕</button>
          </div>
          <div class="trailing-slot-content ng-star-inserted"></div>
        </div>
        <div class="mat-focus-indicator"></div>
      </a>
      <div class="hovered-trailing-content ng-star-inserted"></div>
    `;

    item.querySelectorAll('*').forEach((el) => {
      Object.keys(ngAttrs).forEach((attr) => el.setAttribute(attr, ngAttrs[attr]));
    });

    const a = item.querySelector('a');

    a.ondblclick = (e) => {
      e.stopPropagation();
      state.currentFolderId = folder.id;
      saveState();
      requestRender();
    };

    const upBtn = a.querySelector('.g-f-up');
    if (upBtn) {
      upBtn.onclick = (e) => {
        e.stopPropagation();
        folder.parentId = parentFolderId;
        saveState();
        requestRender();
      };
    }

    a.querySelector('.g-f-ren').onclick = (e) => {
      e.stopPropagation();
      const n = prompt('Rename folder:', folder.name);
      if (n && n.trim()) {
        folder.name = n.trim();
        saveState();
        requestRender();
      }
    };

    a.querySelector('.g-f-del').onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete folder "${folder.name}"? Items inside will move to parent directory.`)) {
        removeFolder(folder.id);
      }
    };

    a.ondragstart = (e) => {
      e.dataTransfer.setData('text/gemini-type', 'folder');
      e.dataTransfer.setData('text/gemini-id', folder.id);
      e.dataTransfer.effectAllowed = 'move';
      setCustomDragGhost(e, folder.name, '📁');
    };

    a.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      a.style.background = 'rgba(138, 180, 248, 0.18)';
      a.style.borderRadius = '24px';
    };

    a.ondragleave = (e) => {
      e.stopPropagation();
      a.style.background = '';
    };

    a.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      a.style.background = '';

      const type = e.dataTransfer.getData('text/gemini-type');
      const id = e.dataTransfer.getData('text/gemini-id');

      if (type === 'chat' && id) {
        state.assignments[id] = folder.id;
        saveState();
        requestRender();
      } else if (type === 'folder' && id && id !== folder.id) {
        if (!isDescendant(id, folder.id)) {
          const dragged = state.folders.find((f) => f.id === id);
          if (dragged) {
            dragged.parentId = folder.id;
            saveState();
            requestRender();
          }
        }
      }
    };

    return item;
  }

  function renderExplorer() {
    injectStyles();

    const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]');
    if (!convList) return;

    let explorerRoot = document.getElementById('g-explorer-root');
    if (!explorerRoot) {
      explorerRoot = document.createElement('div');
      explorerRoot.id = 'g-explorer-root';
      explorerRoot.style.cssText = 'display: flex; flex-direction: column; width: 100%; box-sizing: border-box;';
      convList.parentElement.insertBefore(explorerRoot, convList);
    }

    if (state.activeTab === 'recents') {
      explorerRoot.style.display = 'none';
      convList.style.display = '';
      return;
    }

    explorerRoot.style.display = 'flex';
    convList.style.display = 'none';
    explorerRoot.innerHTML = '';

    if (state.currentFolderId && !state.folders.some((f) => f.id === state.currentFolderId)) {
      state.currentFolderId = null;
    }

    const currentFolder = state.folders.find((f) => f.id === state.currentFolderId);
    const parentId = currentFolder ? currentFolder.parentId : null;
    const parentFolder = parentId ? state.folders.find((f) => f.id === parentId) : null;

    // 1. Toolbar (Up Button + Breadcrumbs)
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex; align-items: center; gap: 6px; padding: 4px 12px 8px 12px;
      border-bottom: 1px solid rgba(128,128,128,0.15); width: 100%; box-sizing: border-box;
    `;

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '⬆';
    upBtn.title = state.currentFolderId ? 'Browse to parent folder' : 'Already at Root';
    upBtn.disabled = !state.currentFolderId;
    upBtn.style.cssText = `
      border: 1px solid rgba(128,128,128,0.25); background: rgba(128,128,128,0.08);
      color: inherit; border-radius: 6px; padding: 4px 8px; font-size: 11px;
      cursor: ${state.currentFolderId ? 'pointer' : 'default'};
      opacity: ${state.currentFolderId ? '1' : '0.3'}; flex-shrink: 0;
    `;

    if (state.currentFolderId) {
      upBtn.onclick = () => {
        state.currentFolderId = parentId;
        saveState();
        requestRender();
      };
      upBtn.ondragover = (e) => {
        e.preventDefault();
        upBtn.style.background = 'rgba(138, 180, 248, 0.25)';
      };
      upBtn.ondragleave = () => {
        upBtn.style.background = 'rgba(128,128,128,0.08)';
      };
      upBtn.ondrop = (e) => {
        e.preventDefault();
        upBtn.style.background = 'rgba(128,128,128,0.08)';
        const type = e.dataTransfer.getData('text/gemini-type');
        const id = e.dataTransfer.getData('text/gemini-id');
        if (type === 'chat' && id) {
          state.assignments[id] = parentId;
          saveState();
          requestRender();
        } else if (type === 'folder' && id) {
          const f = state.folders.find((x) => x.id === id);
          if (f) {
            f.parentId = parentId;
            saveState();
            requestRender();
          }
        }
      };
    }

    const breadcrumbs = document.createElement('div');
    breadcrumbs.style.cssText = `
      display: flex; align-items: center; gap: 4px; overflow-x: auto;
      background: rgba(128,128,128,0.08); padding: 4px 8px; border-radius: 6px;
      flex: 1; font-size: 11.5px; border: 1px solid rgba(128,128,128,0.15);
      scrollbar-width: none; white-space: nowrap;
    `;

    const crumbs = getPathAncestors(state.currentFolderId);
    crumbs.forEach((crumb, idx) => {
      const span = document.createElement('span');
      span.textContent = crumb.name;
      span.style.cssText = `
        cursor: pointer; opacity: ${idx === crumbs.length - 1 ? '1' : '0.6'};
        font-weight: ${idx === crumbs.length - 1 ? '600' : 'normal'};
      `;
      span.onmouseenter = () => (span.style.textDecoration = 'underline');
      span.onmouseleave = () => (span.style.textDecoration = 'none');
      span.onclick = () => {
        state.currentFolderId = crumb.id;
        saveState();
        requestRender();
      };

      span.ondragover = (e) => e.preventDefault();
      span.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = e.dataTransfer.getData('text/gemini-type');
        const id = e.dataTransfer.getData('text/gemini-id');
        if (type === 'chat' && id) {
          state.assignments[id] = crumb.id;
          saveState();
          requestRender();
        } else if (type === 'folder' && id && id !== crumb.id) {
          if (!crumb.id || !isDescendant(id, crumb.id)) {
            const f = state.folders.find((x) => x.id === id);
            if (f) {
              f.parentId = crumb.id;
              saveState();
              requestRender();
            }
          }
        }
      };

      breadcrumbs.appendChild(span);
      if (idx < crumbs.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = '›';
        sep.style.opacity = '0.35';
        breadcrumbs.appendChild(sep);
      }
    });

    toolbar.appendChild(upBtn);
    toolbar.appendChild(breadcrumbs);

    // 2. Action Controls (+ New Folder, 🔄 Sync All, 💾 Export, 📂 Import)
    const actions = document.createElement('div');
    actions.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 12px 6px 12px; width: 100%; box-sizing: border-box;
    `;

    const newBtn = document.createElement('button');
    newBtn.innerHTML = '+ New Folder';
    newBtn.style.cssText = `
      background: transparent; border: 1px dashed rgba(128,128,128,0.35);
      border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; color: inherit;
    `;
    newBtn.onclick = () => {
      const name = prompt(`New folder inside "${currentFolder ? currentFolder.name : 'Root'}":`);
      if (name && name.trim()) {
        state.folders.push({
          id: 'f_' + Date.now(),
          name: name.trim(),
          parentId: state.currentFolderId
        });
        saveState();
        requestRender();
      }
    };

    const actionButtonGroup = document.createElement('div');
    actionButtonGroup.style.cssText = 'display: flex; gap: 4px;';

    // Sync button that calls MaZiqc RPC
    const syncBtn = document.createElement('button');
    syncBtn.id = 'g-sync-btn';
    syncBtn.textContent = '🔄 Sync All';
    syncBtn.title = 'Fetch full chat history via batch API';
    syncBtn.style.cssText = `
      background: rgba(138, 180, 248, 0.12); border: 1px solid rgba(138, 180, 248, 0.35);
      border-radius: 6px; padding: 3px 7px; font-size: 11px; cursor: pointer; color: #8ab4f8; font-weight: 500;
    `;
    syncBtn.onclick = () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '🔄 Syncing...';
      fetchAllConversations((count, page) => {
        syncBtn.textContent = `🔄 (${count})...`;
      }).then((total) => {
        syncBtn.disabled = false;
        syncBtn.textContent = '🔄 Sync All';
        alert(`Account sync complete! Successfully indexed ${total} conversations.`);
      });
    };

    const expBtn = document.createElement('button');
    expBtn.textContent = '💾 Export';
    expBtn.title = 'Export layout and all synced conversations to JSON';
    expBtn.style.cssText = `
      background: transparent; border: 1px solid rgba(128,128,128,0.25);
      border-radius: 6px; padding: 3px 7px; font-size: 11px; cursor: pointer; color: inherit;
    `;
    expBtn.onclick = exportJSON;

    const impBtn = document.createElement('button');
    impBtn.textContent = '📂 Import';
    impBtn.title = 'Import layout and conversations from JSON';
    impBtn.style.cssText = `
      background: transparent; border: 1px solid rgba(128,128,128,0.25);
      border-radius: 6px; padding: 3px 7px; font-size: 11px; cursor: pointer; color: inherit;
    `;
    impBtn.onclick = importJSON;

    actionButtonGroup.appendChild(syncBtn);
    actionButtonGroup.appendChild(expBtn);
    actionButtonGroup.appendChild(impBtn);
    actions.appendChild(newBtn);
    actions.appendChild(actionButtonGroup);

    explorerRoot.appendChild(toolbar);
    explorerRoot.appendChild(actions);

    // 3. Navigation List
    const navList = document.createElement('mat-nav-list');
    navList.className = 'mat-mdc-nav-list mat-mdc-list-base mdc-list gds-sidenav-list';
    navList.style.display = 'block';

    if (state.currentFolderId !== null) {
      navList.appendChild(createParentDirectoryRow(parentFolder));
    }

    // Render Subfolders
    const directSubfolders = state.folders.filter((f) => f.parentId === state.currentFolderId);
    directSubfolders.forEach((sub) => {
      navList.appendChild(createFolderRow(sub, parentId));
    });

    // Render Conversations
    const validFolderIds = new Set(state.folders.map((f) => f.id));
    let folderChatMetas = [];

    if (state.currentFolderId === null) {
      folderChatMetas = Object.values(state.chats).filter((chat) => {
        const fId = state.assignments[chat.id];
        return !fId || !validFolderIds.has(fId);
      });
    } else {
      folderChatMetas = Object.values(state.chats).filter((chat) => {
        return state.assignments[chat.id] === state.currentFolderId;
      });
    }

    // Sort: Pinned first, then chronological (newest first)
    folderChatMetas.sort((a, b) => {
      if (b.isPinned !== a.isPinned) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    folderChatMetas.forEach((chat) => {
      navList.appendChild(createConversationRow(chat, parentId));
    });

    explorerRoot.appendChild(navList);

    if (state.currentFolderId === null && directSubfolders.length === 0 && folderChatMetas.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'gds-body-s';
      emptyNotice.style.cssText = 'padding: 24px 12px; opacity: 0.45; text-align: center; font-size: 12px;';
      emptyNotice.textContent = 'No conversations loaded. Click "🔄 Sync All" above to load your full chat history.';
      explorerRoot.appendChild(emptyNotice);
    }
  }

  function requestRender() {
    renderExplorer();
  }

  function loop() {
    harvestMetadata();
    checkDeadLinks();

    const expandable = document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
    if (!expandable) return;

    const headerRow = expandable.querySelector('.expandable-section-header-row');
    if (headerRow) ensureTabBar(headerRow);

    const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]');
    if (!convList) return;

    const currentPath = window.location.pathname;
    const currentHash = `${state.activeTab}_${state.currentFolderId}_${state.folders.length}_${Object.keys(state.chats).length}_${Object.keys(state.assignments).length}_${currentPath}`;

    if (currentHash !== lastRenderHash) {
      lastRenderHash = currentHash;
      renderExplorer();
    }
  }

  loadState();
  injectStyles();
  loop();
  window.__GEMINI_EXPLORER_LOOP__ = setInterval(loop, 900);

  console.log('[Gemini Explorer v9.0] Batch execute sync ready.');
})();
