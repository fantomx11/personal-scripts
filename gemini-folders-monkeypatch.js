// ==UserScript==
// @name         Gemini Folder Explorer
// @namespace    https://gemini.google.com/
// @version      1.0
// @description  Windows Explorer directory tree and client-side folder organization for Gemini with native Material styling.
// @match        https://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // 1. MATERIAL OUTLINE ICONS (Google Lumi Style)
  // ==========================================
  class Icons {
    static svg(pathContent, size = 20, viewBox = '0 0 24 24') {
      return `
        <svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" 
             stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
             style="display: block; flex-shrink: 0;">
          ${pathContent}
        </svg>
      `;
    }

    static get FOLDER() {
      return this.svg('<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.5l-2-2H5a2 2 0 0 0-2 2z"/>', 20);
    }

    static get FOLDER_UP() {
      return this.svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 18);
    }

    static get NEW_FOLDER() {
      return this.svg('<path d="M12 10v6m-3-3h6M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.5l-2-2H5a2 2 0 0 0-2 2z"/>', 16);
    }

    static get IMPORT() {
      return this.svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', 15);
    }

    static get EXPORT() {
      return this.svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>', 15);
    }

    static get EDIT() {
      return this.svg('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>', 13);
    }

    static get DELETE() {
      return this.svg('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 13);
    }

    static get MORE_VERT() {
      return this.svg('<circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>', 18);
    }

    static get PIN() {
      return this.svg('<line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-2-7V4h1V2H6v2h1v6l-2 7z"></path>', 14);
    }
  }

  // ==========================================
  // 2. SCHEMA MIGRATOR & UPGRADERS
  // ==========================================
  class SchemaMigrator {
    static CURRENT_SCHEMA_VERSION = 1;
    static updaters = {};

    static migrate(payload) {
      if (!payload || typeof payload !== 'object') return payload;
      let currentVersion = payload.schemaVersion || 1;

      while (currentVersion < SchemaMigrator.CURRENT_SCHEMA_VERSION) {
        const targetVersion = currentVersion + 1;
        const updater = SchemaMigrator.updaters[targetVersion];
        if (typeof updater === 'function') {
          payload = updater(payload);
        }
        currentVersion = targetVersion;
        payload.schemaVersion = currentVersion;
      }

      payload.schemaVersion = SchemaMigrator.CURRENT_SCHEMA_VERSION;
      return payload;
    }
  }

  // ==========================================
  // 3. STATE & PERSISTENCE STORE
  // ==========================================
  class ExplorerStore {
    constructor(storageKey = 'gemini_explorer_state') {
      this.storageKey = storageKey;
      this.state = {
        schemaVersion: SchemaMigrator.CURRENT_SCHEMA_VERSION,
        activeTab: 'folders',
        currentFolderId: null,
        folders: [],
        assignments: {},
        chats: {}
      };
      this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          let parsed = JSON.parse(raw);
          parsed = SchemaMigrator.migrate(parsed);
          Object.assign(this.state, parsed);
        }
      } catch (e) {
        console.error('[Gemini Explorer] Store load error:', e);
      }
    }

    save() {
      try {
        this.state.schemaVersion = SchemaMigrator.CURRENT_SCHEMA_VERSION;
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch (e) {
        console.error('[Gemini Explorer] Store save error:', e);
      }
    }

    createFolder(name, parentId = this.state.currentFolderId) {
      const folder = {
        id: `f_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: name.trim(),
        parentId
      };
      this.state.folders.push(folder);
      this.save();
      return folder;
    }

    renameFolder(folderId, newName) {
      const folder = this.state.folders.find((f) => f.id === folderId);
      if (folder && newName.trim()) {
        folder.name = newName.trim();
        this.save();
      }
    }

    deleteFolder(folderId) {
      const target = this.state.folders.find((f) => f.id === folderId);
      if (!target) return;

      const fallbackParent = target.parentId;
      this.state.folders.forEach((f) => {
        if (f.parentId === folderId) f.parentId = fallbackParent;
      });
      Object.keys(this.state.assignments).forEach((cid) => {
        if (this.state.assignments[cid] === folderId) {
          this.state.assignments[cid] = fallbackParent;
        }
      });

      this.state.folders = this.state.folders.filter((f) => f.id !== folderId);
      if (this.state.currentFolderId === folderId) {
        this.state.currentFolderId = fallbackParent;
      }
      this.save();
    }

    assignChat(chatId, folderId) {
      this.state.assignments[chatId] = folderId;
      this.save();
    }

    purgeChat(chatId) {
      if (!chatId) return;
      delete this.state.assignments[chatId];
      delete this.state.chats[chatId];
      this.save();
    }

    upsertChat(id, title, isPinned = false) {
      let changed = false;
      if (!this.state.chats[id]) {
        this.state.chats[id] = { id, title, isPinned, updatedAt: Date.now() };
        changed = true;
      } else {
        const existing = this.state.chats[id];
        if (existing.title !== title || existing.isPinned !== isPinned) {
          existing.title = title;
          existing.isPinned = isPinned;
          changed = true;
        }
      }
      if (changed) this.save();
      return changed;
    }

    getPathAncestors(folderId = this.state.currentFolderId) {
      const crumbs = [{ id: null, name: 'Root' }];
      if (!folderId) return crumbs;

      const stack = [];
      let curr = this.state.folders.find((f) => f.id === folderId);
      while (curr) {
        stack.unshift({ id: curr.id, name: curr.name });
        curr = this.state.folders.find((f) => f.id === curr.parentId);
      }
      return crumbs.concat(stack);
    }

    isDescendant(sourceId, targetId) {
      let curr = this.state.folders.find((f) => f.id === targetId);
      while (curr) {
        if (curr.parentId === sourceId) return true;
        curr = this.state.folders.find((f) => f.id === curr.parentId);
      }
      return false;
    }

    exportJSON() {
      const payload = {
        schemaVersion: SchemaMigrator.CURRENT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        folders: this.state.folders,
        assignments: this.state.assignments,
        chats: this.state.chats
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini_folders_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    importJSON(file, onComplete) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          let parsed = JSON.parse(e.target.result);
          parsed = SchemaMigrator.migrate(parsed);

          if (!parsed.folders || !parsed.assignments) {
            throw new Error('Missing folders or assignments payload.');
          }

          this.state.folders = parsed.folders;
          this.state.assignments = Object.assign(this.state.assignments, parsed.assignments);
          if (parsed.chats) {
            this.state.chats = Object.assign(this.state.chats, parsed.chats);
          }
          this.state.currentFolderId = null;
          this.save();
          if (onComplete) onComplete(true);
        } catch (err) {
          alert('Import failed: ' + err.message);
          if (onComplete) onComplete(false);
        }
      };
      reader.readAsText(file);
    }
  }

  // ==========================================
  // 4. DRAG & DROP CONTROLLER
  // ==========================================
  class DragDropService {
    static setGhost(e, label, svgIcon) {
      const ghost = document.createElement('div');
      ghost.style.cssText = `
        position: fixed; top: -1000px; left: -1000px; padding: 6px 14px;
        background: #282a2c; color: #e3e3e3; border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px; font-family: inherit; font-size: 13px; font-weight: 500;
        display: inline-flex; align-items: center; gap: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); max-width: 220px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        z-index: 100000; pointer-events: none;
      `;
      ghost.innerHTML = `<span style="display:flex;align-items:center;opacity:0.85;">${svgIcon}</span><span style="overflow:hidden;text-overflow:ellipsis;">${label}</span>`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 16);
      setTimeout(() => ghost.remove(), 0);
    }

    static handleDrop(e, targetFolderId, store, onUpdate) {
      e.preventDefault();
      e.stopPropagation();

      const type = e.dataTransfer.getData('text/gemini-type');
      const id = e.dataTransfer.getData('text/gemini-id');

      if (type === 'chat' && id) {
        store.assignChat(id, targetFolderId);
        onUpdate();
      } else if (type === 'folder' && id && id !== targetFolderId) {
        if (!targetFolderId || !store.isDescendant(id, targetFolderId)) {
          const folder = store.state.folders.find((f) => f.id === id);
          if (folder) {
            folder.parentId = targetFolderId;
            store.save();
            onUpdate();
          }
        }
      }
    }
  }

  // ==========================================
  // 5. DOM HARVESTER
  // ==========================================
  class Harvester {
    constructor(store, onUpdate) {
      this.store = store;
      this.onUpdate = onUpdate;
      this.pendingActionChatId = null;
      this.lastNavigatedChatId = null;
      this.lastNavigatedTime = 0;
      this.bindNativeDeleteInterceptors();
    }

    static extractChatId(url) {
      if (!url) return null;
      const match = url.match(/\/app\/([a-zA-Z0-9_-]{8,})/);
      const reserved = ['prompts', 'gems', 'history', 'settings', 'user', 'library'];
      return (match && !reserved.includes(match[1].toLowerCase())) ? match[1] : null;
    }

    harvest() {
      const list = document.querySelector('conversations-list[data-test-id="all-conversations"]');
      if (!list) return;

      let changed = false;
      const items = list.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]');
      items.forEach((item) => {
        const a = item.querySelector('a[href*="/app/"]');
        if (!a) return;

        const id = Harvester.extractChatId(a.getAttribute('href'));
        if (!id) return;

        const titleEl = a.querySelector('.title-text');
        const title = titleEl ? titleEl.textContent.trim() : a.getAttribute('aria-label') || '';
        const isPinned = !!a.querySelector('mat-icon[fonticon="push_pin"], mat-icon[data-mat-icon-name="push_pin"]');

        if (title && title.toLowerCase() !== 'new chat') {
          if (this.store.upsertChat(id, title, isPinned)) changed = true;
        }
      });

      const currentId = Harvester.extractChatId(window.location.pathname);
      if (currentId && !this.store.state.chats[currentId]) {
        const titleText = document.querySelector('title')?.textContent.replace(/ - Gemini$/, '').trim();
        const fallbackTitle = titleText && titleText !== 'Gemini' ? titleText : `Chat (${currentId.slice(0, 6)})`;
        if (this.store.upsertChat(currentId, fallbackTitle, false)) changed = true;
      }

      if (changed) this.onUpdate();
    }

    checkDeadLinks() {
      if (this.lastNavigatedChatId && Date.now() - this.lastNavigatedTime < 3500) {
        const currentPath = window.location.pathname;
        if (currentPath === '/app' || currentPath === '/app/') {
          const deadId = this.lastNavigatedChatId;
          this.lastNavigatedChatId = null;
          if (this.store.state.chats[deadId]) {
            console.warn(`[Gemini Explorer] Purged dead conversation: ${deadId}`);
            this.store.purgeChat(deadId);
            this.onUpdate();
          }
        }
      }
    }

    bindNativeDeleteInterceptors() {
      document.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-test-id="actions-menu-button"]');
        if (actionBtn) {
          const row = actionBtn.closest('gem-nav-list-item') || actionBtn.closest('[data-chat-id]');
          const anchor = row ? row.querySelector('a[href*="/app/"]') : null;
          if (anchor) this.pendingActionChatId = Harvester.extractChatId(anchor.getAttribute('href'));
          return;
        }

        const btn = e.target.closest('button');
        if (btn && this.pendingActionChatId) {
          const text = btn.textContent.trim().toLowerCase();
          const inDialog = btn.closest('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container');
          if (inDialog && text === 'delete') {
            const targetId = this.pendingActionChatId;
            this.pendingActionChatId = null;
            setTimeout(() => {
              this.store.purgeChat(targetId);
              this.onUpdate();
            }, 300);
          }
        }
      }, true);
    }
  }

  // ==========================================
  // 6. UI RENDERER
  // ==========================================
  class Renderer {
    constructor(store, harvester, onUpdate) {
      this.store = store;
      this.harvester = harvester;
      this.onUpdate = onUpdate;
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('g-explorer-styles')) return;
      const style = document.createElement('style');
      style.id = 'g-explorer-styles';
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
        /* Match Native Row Height, Padding, and Shape */
        #g-explorer-root gem-nav-list-item a.mat-mdc-list-item {
          position: relative !important;
          width: 100% !important;
          height: 40px !important;
          min-height: 40px !important;
          border-radius: 20px !important;
          box-sizing: border-box !important;
          padding: 0 12px 0 16px !important;
          display: flex !important;
          align-items: center !important;
        }
        #g-explorer-root .leading-icon-container {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 24px !important;
          height: 24px !important;
          margin-right: 12px !important;
          opacity: 0.85;
        }
        #g-explorer-root .title-text {
          font-size: 14px !important;
          line-height: 20px !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        /* Actions Hover State */
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
          gap: 2px !important;
        }
        #g-explorer-root gem-nav-list-item:hover .hovered-trailing-content,
        #g-explorer-root gem-nav-list-item:focus-within .hovered-trailing-content {
          display: flex !important;
        }
        #g-explorer-root gem-nav-list-item:hover .trailing-icon-container {
          opacity: 0 !important;
          visibility: hidden !important;
        }
        #g-explorer-root .hovered-trailing-content button,
        #g-explorer-root .g-f-actions button {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 28px !important;
          height: 28px !important;
          border: none !important;
          background: transparent !important;
          border-radius: 50% !important;
          cursor: pointer !important;
          color: inherit !important;
          opacity: 0.7 !important;
          transition: opacity 0.15s ease, background 0.15s ease !important;
        }
        #g-explorer-root .hovered-trailing-content button:hover,
        #g-explorer-root .g-f-actions button:hover {
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
      document.head.appendChild(style);
    }

    getAngularAttrs() {
      const node = document.querySelector('gem-nav-list-item[data-test-id="conversation"]') ||
                   document.querySelector('conversations-list');
      const attrs = {};
      if (node) {
        for (const attr of node.attributes) {
          if (attr.name.startsWith('_ngcontent') || attr.name.startsWith('_nghost')) {
            attrs[attr.name] = attr.value;
          }
        }
      }
      return attrs;
    }

    applyAngularAttrs(el) {
      const attrs = this.getAngularAttrs();
      el.querySelectorAll('*').forEach((child) => {
        Object.keys(attrs).forEach((k) => child.setAttribute(k, attrs[k]));
      });
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    }

    renderTabBar(headerRow) {
      let tabContainer = document.getElementById('g-explorer-tabs');
      if (!tabContainer) {
        tabContainer = document.createElement('div');
        tabContainer.id = 'g-explorer-tabs';
        tabContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 4px 12px 8px; box-sizing: border-box;';
        headerRow.parentElement.insertBefore(tabContainer, headerRow);
      }
      headerRow.style.display = 'none';

      const isRecents = this.store.state.activeTab === 'recents';
      tabContainer.innerHTML = `
        <div style="display: inline-flex; background: rgba(128,128,128,0.12); padding: 2px; border-radius: 8px; gap: 2px;">
          <button id="g-tab-recents" class="gds-body-s" style="padding: 4px 12px; border: none; border-radius: 6px; cursor: pointer; color: inherit; background: ${isRecents ? 'rgba(128,128,128,0.25)' : 'transparent'}; font-weight: ${isRecents ? '600' : 'normal'}; opacity: ${isRecents ? '1' : '0.65'};">Recents</button>
          <button id="g-tab-folders" class="gds-body-s" style="padding: 4px 12px; border: none; border-radius: 6px; cursor: pointer; color: inherit; background: ${!isRecents ? 'rgba(128,128,128,0.25)' : 'transparent'}; font-weight: ${!isRecents ? '600' : 'normal'}; opacity: ${!isRecents ? '1' : '0.65'};">Folders</button>
        </div>
      `;

      tabContainer.querySelector('#g-tab-recents').onclick = () => {
        this.store.state.activeTab = 'recents';
        this.store.save();
        this.onUpdate();
      };
      tabContainer.querySelector('#g-tab-folders').onclick = () => {
        this.store.state.activeTab = 'folders';
        this.store.save();
        this.onUpdate();
      };
    }

    openNativeMenu(chatId, triggerButton) {
      const nativeItem = document.querySelector(`conversations-list gem-nav-list-item a[href*="${chatId}"]`);
      if (!nativeItem) return false;

      const nativeRow = nativeItem.closest('gem-nav-list-item');
      // The trigger directive lives on the gem-icon-button wrapper
      const triggerWrapper = nativeRow?.querySelector('[data-test-id="actions-menu-button"]');
      const nativeBtn = triggerWrapper?.querySelector('button');
      const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]');
      if (!triggerWrapper || !nativeBtn || !convList) return false;

      this.harvester.pendingActionChatId = chatId;
      const rect = triggerButton.getBoundingClientRect();

      // Preserve native inline styles
      const prevListCss = convList.style.cssText;
      const prevTriggerCss = triggerWrapper.style.cssText;

      // Collapse native list into zero-flow viewport anchor
      convList.style.cssText = `
        display: block !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        z-index: -9999 !important;
      `;

      // Position the actual Material menu trigger directive directly over our button
      triggerWrapper.style.cssText = `
        position: fixed !important;
        top: ${rect.top}px !important;
        left: ${rect.left}px !important;
        width: ${rect.width}px !important;
        height: ${rect.height}px !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        opacity: 0 !important;
        pointer-events: auto !important;
        z-index: 999999 !important;
      `;

      nativeBtn.click();

      const cleanup = () => {
        convList.style.cssText = prevListCss;
        triggerWrapper.style.cssText = prevTriggerCss;
      };

      const overlayContainer = document.querySelector('.cdk-overlay-container');
      if (overlayContainer) {
        const observer = new MutationObserver(() => {
          if (!overlayContainer.querySelector('.cdk-overlay-pane')) {
            cleanup();
            observer.disconnect();
          }
        });
        observer.observe(overlayContainer, { childList: true, subtree: true });
      } else {
        setTimeout(cleanup, 350);
      }

      return true;
    }

    createParentDirectoryRow(parentFolder) {
      const item = document.createElement('gem-nav-list-item');
      item.className = 'has-hovered-trailing-content ng-star-inserted';
      const pName = parentFolder ? parentFolder.name : 'Root';
      const targetId = parentFolder ? parentFolder.id : null;

      item.innerHTML = `
        <a mat-list-item="" theme="lm" class="mat-mdc-list-item mdc-list-item gem-nav-list-item mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta lm-enabled mat-mdc-list-item-single-line ng-star-inserted" tabindex="0" style="cursor: pointer; opacity: 0.85;">
          <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container mdc-list-item__start">
            <gem-icon class="gem-nav-list-item-icon">${Icons.FOLDER_UP}</gem-icon>
          </div>
          <span class="mdc-list-item__content">
            <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
              <span dir="auto" class="title-text gds-body-s" style="font-style: italic;">.. [Up to ${pName}]</span>
            </span>
          </span>
          <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content">
            <span class="gds-body-s" style="font-size: 11px; opacity: 0.45;">Drop to move up</span>
          </div>
        </a>
      `;

      const a = item.querySelector('a');
      a.ondblclick = () => {
        this.store.state.currentFolderId = targetId;
        this.store.save();
        this.onUpdate();
      };
      a.ondragover = (e) => { e.preventDefault(); a.style.background = 'rgba(138, 180, 248, 0.18)'; };
      a.ondragleave = () => { a.style.background = ''; };
      a.ondrop = (e) => {
        a.style.background = '';
        DragDropService.handleDrop(e, targetId, this.store, this.onUpdate);
      };

      return this.applyAngularAttrs(item);
    }

    createFolderRow(folder, parentFolderId) {
      const item = document.createElement('gem-nav-list-item');
      item.setAttribute('data-folder-id', folder.id);
      item.className = 'has-hovered-trailing-content ng-star-inserted';

      const subCount = this.store.state.folders.filter((f) => f.parentId === folder.id).length;
      const chatCount = Object.keys(this.store.state.assignments).filter((cid) => this.store.state.assignments[cid] === folder.id).length;
      const canMoveUp = this.store.state.currentFolderId !== null;

      item.innerHTML = `
        <a mat-list-item="" theme="lm" draggable="true" class="mat-mdc-list-item mdc-list-item gem-nav-list-item mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta lm-enabled mat-mdc-list-item-single-line ng-star-inserted" tabindex="0" style="cursor: pointer;">
          <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container mdc-list-item__start">
            <gem-icon class="gem-nav-list-item-icon">${Icons.FOLDER}</gem-icon>
          </div>
          <span class="mdc-list-item__content">
            <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
              <span dir="auto" class="title-text gds-body-s">${folder.name}</span>
            </span>
          </span>
          <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content">
            <span class="gds-body-s" style="font-size: 11px; opacity: 0.5; margin-right: 4px;">(${subCount + chatCount})</span>
            <div class="g-f-actions" style="display: inline-flex; gap: 2px;">
              ${canMoveUp ? `<button class="g-f-up" title="Move to parent">${Icons.FOLDER_UP}</button>` : ''}
              <button class="g-f-ren" title="Rename">${Icons.EDIT}</button>
              <button class="g-f-del" title="Delete">${Icons.DELETE}</button>
            </div>
          </div>
        </a>
      `;

      const a = item.querySelector('a');
      a.ondblclick = () => {
        this.store.state.currentFolderId = folder.id;
        this.store.save();
        this.onUpdate();
      };
      a.ondragstart = (e) => {
        e.dataTransfer.setData('text/gemini-type', 'folder');
        e.dataTransfer.setData('text/gemini-id', folder.id);
        DragDropService.setGhost(e, folder.name, Icons.FOLDER);
      };
      a.ondragover = (e) => { e.preventDefault(); a.style.background = 'rgba(138, 180, 248, 0.18)'; };
      a.ondragleave = () => { a.style.background = ''; };
      a.ondrop = (e) => {
        a.style.background = '';
        DragDropService.handleDrop(e, folder.id, this.store, this.onUpdate);
      };

      const upBtn = a.querySelector('.g-f-up');
      if (upBtn) {
        upBtn.onclick = (e) => {
          e.stopPropagation();
          folder.parentId = parentFolderId;
          this.store.save();
          this.onUpdate();
        };
      }
      a.querySelector('.g-f-ren').onclick = (e) => {
        e.stopPropagation();
        const n = prompt('Rename folder:', folder.name);
        if (n) this.store.renameFolder(folder.id, n);
        this.onUpdate();
      };
      a.querySelector('.g-f-del').onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${folder.name}"? Sub-items will move up.`)) {
          this.store.deleteFolder(folder.id);
          this.onUpdate();
        }
      };

      return this.applyAngularAttrs(item);
    }

    createConversationRow(chat, parentFolderId) {
      const item = document.createElement('gem-nav-list-item');
      item.setAttribute('data-test-id', 'conversation');
      item.setAttribute('data-chat-id', chat.id);
      item.className = 'has-hovered-trailing-content ng-star-inserted';
      const isActive = window.location.pathname.includes(chat.id);
      const canMoveUp = this.store.state.currentFolderId !== null;

      item.innerHTML = `
        <a mat-list-item="" theme="lm" draggable="true" 
           class="mat-mdc-list-item mdc-list-item mat-mdc-tooltip-trigger gem-nav-list-item gmat-override mat-mdc-list-item-interactive mdc-list-item--with-leading-icon mdc-list-item--with-trailing-meta mat-mdc-list-item-both-leading-and-trailing lm-enabled mat-mdc-list-item-single-line mdc-list-item--with-one-line ng-star-inserted ${isActive ? 'is-active mdc-list-item--activated' : ''}" 
           href="/app/${chat.id}" aria-label="${chat.title}" tabindex="0">
          <div matlistitemicon="" class="mat-mdc-list-item-icon leading-icon-container removed mdc-list-item__start"></div>
          <span class="mdc-list-item__content">
            <span class="mat-mdc-list-item-unscoped-content mdc-list-item__primary-text">
              <span class="label-and-badge menu-entry-with-badge ng-star-inserted">
                <span dir="auto" class="title-text ${isActive ? 'gds-emphasized-body-s' : 'gds-body-s'}">${chat.title}</span>
              </span>
            </span>
          </span>
          <div matlistitemmeta="" class="mat-mdc-list-item-meta mdc-list-item__end trailing-content gmat-override">
            ${chat.isPinned ? `<span class="mat-mdc-list-item-icon trailing-icon-container ng-star-inserted">${Icons.PIN}</span>` : ''}
            <div class="trailing-slot-content ng-star-inserted"></div>
          </div>
          <div class="mat-focus-indicator"></div>
        </a>
        <div class="hovered-trailing-content ng-star-inserted">
          ${canMoveUp ? `<button class="g-chat-up-btn" title="Move to parent directory">${Icons.FOLDER_UP}</button>` : ''}
          <button class="g-chat-opt-btn" title="Options">${Icons.MORE_VERT}</button>
        </div>
      `;

      const a = item.querySelector('a');
      a.ondragstart = (e) => {
        e.dataTransfer.setData('text/gemini-type', 'chat');
        e.dataTransfer.setData('text/gemini-id', chat.id);
        DragDropService.setGhost(e, chat.title, Icons.MORE_VERT);
      };

      a.onclick = (e) => {
        e.preventDefault();
        this.harvester.lastNavigatedChatId = chat.id;
        this.harvester.lastNavigatedTime = Date.now();

        const native = document.querySelector(`conversations-list a[href*="${chat.id}"]`);
        if (native) native.click();
        else window.location.href = `/app/${chat.id}`;
        setTimeout(this.onUpdate, 250);
      };

      const upBtn = item.querySelector('.g-chat-up-btn');
      if (upBtn) {
        upBtn.onclick = (e) => {
          e.stopPropagation();
          this.store.assignChat(chat.id, parentFolderId);
          this.onUpdate();
        };
      }

      const optBtn = item.querySelector('.g-chat-opt-btn');
      optBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const opened = this.openNativeMenu(chat.id, optBtn);
        if (opened) return;

        const choice = prompt(`Conversation: "${chat.title}"\n1: Move to Root\n2: Rename Local Title\n3: Remove from Layout\n(Choose 1, 2, or 3):`);
        if (choice === '1') this.store.assignChat(chat.id, null);
        else if (choice === '2') {
          const t = prompt('New title:', chat.title);
          if (t) this.store.upsertChat(chat.id, t.trim(), chat.isPinned);
        } else if (choice === '3') this.store.purgeChat(chat.id);
        this.onUpdate();
      };

      return this.applyAngularAttrs(item);
    }

    renderToolbar() {
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 4px 12px 8px; border-bottom: 1px solid rgba(128,128,128,0.15); width: 100%; box-sizing: border-box;';

      const currentFolder = this.store.state.folders.find((f) => f.id === this.store.state.currentFolderId);
      const parentId = currentFolder ? currentFolder.parentId : null;

      const upBtn = document.createElement('button');
      upBtn.innerHTML = Icons.FOLDER_UP;
      upBtn.title = this.store.state.currentFolderId ? 'Browse to parent directory' : 'Root';
      upBtn.disabled = !this.store.state.currentFolderId;
      upBtn.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid rgba(128,128,128,0.25); background: rgba(128,128,128,0.08); 
        color: inherit; border-radius: 8px; width: 28px; height: 28px;
        cursor: ${this.store.state.currentFolderId ? 'pointer' : 'default'}; 
        opacity: ${this.store.state.currentFolderId ? '1' : '0.3'}; flex-shrink: 0;
      `;

      if (this.store.state.currentFolderId) {
        upBtn.onclick = () => {
          this.store.state.currentFolderId = parentId;
          this.store.save();
          this.onUpdate();
        };
        upBtn.ondragover = (e) => { e.preventDefault(); upBtn.style.background = 'rgba(138, 180, 248, 0.25)'; };
        upBtn.ondragleave = () => { upBtn.style.background = 'rgba(128,128,128,0.08)'; };
        upBtn.ondrop = (e) => {
          upBtn.style.background = 'rgba(128,128,128,0.08)';
          DragDropService.handleDrop(e, parentId, this.store, this.onUpdate);
        };
      }

      const breadcrumbs = document.createElement('div');
      breadcrumbs.style.cssText = 'display: flex; align-items: center; gap: 4px; overflow-x: auto; background: rgba(128,128,128,0.08); padding: 4px 10px; border-radius: 8px; flex: 1; height: 28px; box-sizing: border-box; font-size: 12px; border: 1px solid rgba(128,128,128,0.15); scrollbar-width: none; white-space: nowrap;';

      const crumbs = this.store.getPathAncestors();
      crumbs.forEach((crumb, idx) => {
        const span = document.createElement('span');
        span.textContent = crumb.name;
        span.style.cssText = `cursor: pointer; opacity: ${idx === crumbs.length - 1 ? '1' : '0.65'}; font-weight: ${idx === crumbs.length - 1 ? '600' : 'normal'};`;
        span.onclick = () => {
          this.store.state.currentFolderId = crumb.id;
          this.store.save();
          this.onUpdate();
        };
        span.ondragover = (e) => e.preventDefault();
        span.ondrop = (e) => DragDropService.handleDrop(e, crumb.id, this.store, this.onUpdate);
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
      return toolbar;
    }

    renderActionControls() {
      const actions = document.createElement('div');
      actions.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 12px 8px; width: 100%; box-sizing: border-box;';

      const newBtn = document.createElement('button');
      newBtn.innerHTML = `${Icons.NEW_FOLDER}<span style="font-size: 12px; font-weight: 500;">New Folder</span>`;
      newBtn.style.cssText = `
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(128,128,128,0.08); border: 1px solid rgba(128,128,128,0.25);
        border-radius: 16px; padding: 4px 10px; cursor: pointer; color: inherit;
      `;
      newBtn.onclick = () => {
        const name = prompt('Folder name:');
        if (name) {
          this.store.createFolder(name);
          this.onUpdate();
        }
      };

      const group = document.createElement('div');
      group.style.cssText = 'display: flex; gap: 4px;';

      const expBtn = document.createElement('button');
      expBtn.innerHTML = Icons.EXPORT;
      expBtn.title = 'Export configuration JSON';
      expBtn.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: 1px solid rgba(128,128,128,0.25);
        border-radius: 50%; width: 28px; height: 28px; cursor: pointer; color: inherit; opacity: 0.8;
      `;
      expBtn.onclick = () => this.store.exportJSON();

      const impBtn = document.createElement('button');
      impBtn.innerHTML = Icons.IMPORT;
      impBtn.title = 'Import configuration JSON';
      impBtn.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: 1px solid rgba(128,128,128,0.25);
        border-radius: 50%; width: 28px; height: 28px; cursor: pointer; color: inherit; opacity: 0.8;
      `;
      impBtn.onclick = () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.onchange = (e) => {
          if (e.target.files[0]) this.store.importJSON(e.target.files[0], () => this.onUpdate());
        };
        fileInput.click();
      };

      group.appendChild(expBtn);
      group.appendChild(impBtn);
      actions.appendChild(newBtn);
      actions.appendChild(group);
      return actions;
    }

    renderExplorer() {
      const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]');
      if (!convList) return;

      let root = document.getElementById('g-explorer-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'g-explorer-root';
        convList.parentElement.insertBefore(root, convList);
      }

      if (this.store.state.activeTab === 'recents') {
        root.style.display = 'none';
        convList.style.display = '';
        return;
      }

      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      convList.style.display = 'none';
      root.innerHTML = '';

      const currentFolder = this.store.state.folders.find((f) => f.id === this.store.state.currentFolderId);
      const parentId = currentFolder ? currentFolder.parentId : null;
      const parentFolder = parentId ? this.store.state.folders.find((f) => f.id === parentId) : null;

      root.appendChild(this.renderToolbar());
      root.appendChild(this.renderActionControls());

      const navList = document.createElement('mat-nav-list');
      navList.className = 'mat-mdc-nav-list mat-mdc-list-base mdc-list gds-sidenav-list';
      navList.style.display = 'block';

      if (this.store.state.currentFolderId !== null) {
        navList.appendChild(this.createParentDirectoryRow(parentFolder));
      }

      // Render Folders
      this.store.state.folders
        .filter((f) => f.parentId === this.store.state.currentFolderId)
        .forEach((f) => navList.appendChild(this.createFolderRow(f, parentId)));

      // Render Chats
      const validFolderIds = new Set(this.store.state.folders.map((f) => f.id));
      const targetChats = Object.values(this.store.state.chats).filter((chat) => {
        const assigned = this.store.state.assignments[chat.id];
        if (this.store.state.currentFolderId === null) {
          return !assigned || !validFolderIds.has(assigned);
        }
        return assigned === this.store.state.currentFolderId;
      });

      targetChats.sort((a, b) => {
        if (b.isPinned !== a.isPinned) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

      targetChats.forEach((chat) => navList.appendChild(this.createConversationRow(chat, parentId)));
      root.appendChild(navList);
    }
  }

  // ==========================================
  // 7. APPLICATION COORDINATOR
  // ==========================================
  class GeminiExplorerApp {
    constructor() {
      this.store = new ExplorerStore();
      this.harvester = new Harvester(this.store, () => this.requestRender());
      this.renderer = new Renderer(this.store, this.harvester, () => this.requestRender());
      this.lastHash = '';
    }

    start() {
      if (window.__GEMINI_EXPLORER_LOOP__) clearInterval(window.__GEMINI_EXPLORER_LOOP__);
      this.loop();
      window.__GEMINI_EXPLORER_LOOP__ = setInterval(() => this.loop(), 800);
      console.log('[Gemini Explorer v10.1] Native Material UI loaded.');
    }

    requestRender() {
      this.renderer.renderExplorer();
    }

    loop() {
      this.harvester.harvest();
      this.harvester.checkDeadLinks();

      const expandable = document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
      if (expandable) {
        const headerRow = expandable.querySelector('.expandable-section-header-row');
        if (headerRow) this.renderer.renderTabBar(headerRow);
      }

      const hash = `${this.store.state.activeTab}_${this.store.state.currentFolderId}_${this.store.state.folders.length}_${Object.keys(this.store.state.chats).length}_${Object.keys(this.store.state.assignments).length}_${window.location.pathname}`;
      if (hash !== this.lastHash) {
        this.lastHash = hash;
        this.requestRender();
      }
    }
  }

  const app = new GeminiExplorerApp();
  app.start();
})();
