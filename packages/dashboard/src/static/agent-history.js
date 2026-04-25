/* Phase 39.1-02 — agent-history module.
 *
 * History panel hydration (Phase 35-05 + Phase 38 admin org chip + Phase 38
 * cross-org auto-switch). Owns:
 *   - panel open/close
 *   - debounced search + clear
 *   - card render + roving focus + IO sentinel pagination
 *   - rename + delete (soft) + resume (with cross-org auto-switch)
 *   - delegated click + keydown listeners scoped to the panel
 *
 * Reads shared utilities from window.__luqenAgent (csrfToken, byId, announce,
 * setConversationId, autoSwitchOrgIfNeeded, loadPanel). agent.js + agent-org.js
 * MUST be loaded before this file.
 *
 * Exposes on __luqenAgent for cross-module use:
 *   historyIsPanelOpen()  — agent.js Esc handler may need it (kept here too)
 */
(function () {
  'use strict';

  var A = window.__luqenAgent;
  if (!A) return;

  var csrfToken = A.csrfToken;
  var byId = A.byId;
  var setConversationId = A.setConversationId;

  function loadPanel() {
    var fn = A.loadPanel;
    if (typeof fn === 'function') return fn();
  }

  function autoSwitchOrgIfNeeded(targetOrgId, targetOrgName) {
    var fn = A.autoSwitchOrgIfNeeded;
    if (typeof fn === 'function') return fn(targetOrgId, targetOrgName);
    return Promise.resolve(true);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Phase 35 Plan 05 — History panel hydration (AHIST-01..05)
  // CSP-strict: no inline handlers. All DOM mutation via createElement /
  // textContent. <mark> highlighting built in JS, never via innerHTML.
  // ──────────────────────────────────────────────────────────────────────

  var HISTORY_PAGE_LIMIT = 20;
  var HISTORY_PANEL_ID = 'agent-history-panel';
  var HISTORY_LIST_ID = 'agent-history-list';
  var HISTORY_SEARCH_ID = 'agent-history-search-input';
  var HISTORY_LIVE_ID = 'agent-history-live';
  var historyNextOffset = 0;
  var historyIsFetchingMore = false;
  var historySearchTimer = null;
  var historyIO = null;
  var historySearchWired = false;
  var historyCachedPage = null;
  var historyActiveMenu = null;
  var historyActiveRename = null;
  var historyActiveDelete = null;
  var historyShowOrgChip = false;

  function historyPanelEl() { return byId(HISTORY_PANEL_ID); }
  function historyListEl() { return byId(HISTORY_LIST_ID); }
  function historyOpenTriggerEl() {
    return document.querySelector('[data-action="openAgentHistory"]');
  }

  function historyIsPanelOpen() {
    var p = historyPanelEl();
    return !!p && p.getAttribute('aria-hidden') === 'false';
  }

  function openHistoryPanel() {
    var panel = historyPanelEl(); if (!panel) return;
    panel.removeAttribute('hidden');
    panel.setAttribute('aria-hidden', 'false');
    var trigger = historyOpenTriggerEl();
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    historyNextOffset = 0;
    historyIsFetchingMore = false;
    historyCachedPage = null;
    fetchHistoryPage(0, true);
    var back = panel.querySelector('.agent-drawer__history-back');
    if (back) { try { back.focus(); } catch (_e) { /* ignore */ } }
    wireHistorySearch();
    armHistorySentinel();
  }

  function closeHistoryPanel() {
    var panel = historyPanelEl(); if (!panel) return;
    panel.setAttribute('hidden', '');
    panel.setAttribute('aria-hidden', 'true');
    var trigger = historyOpenTriggerEl();
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      try { trigger.focus(); } catch (_e) { /* ignore */ }
    }
    closeHistoryMenu();
    if (historyIO && typeof historyIO.disconnect === 'function') {
      try { historyIO.disconnect(); } catch (_e) { /* ignore */ }
    }
    historyIO = null;
  }

  function clearHistoryList() {
    var list = historyListEl(); if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
  }

  function renderEmptyState() {
    var list = historyListEl(); if (!list) return;
    clearHistoryList();
    var li = document.createElement('li');
    li.className = 'agent-drawer__history-empty';
    var h = document.createElement('h4'); h.textContent = 'No conversations yet';
    var p = document.createElement('p'); p.className = 'form-hint';
    p.textContent = 'Ask a question in chat — your conversation will appear here.';
    li.appendChild(h); li.appendChild(p);
    list.appendChild(li);
  }

  function renderNoMatches(query) {
    var list = historyListEl(); if (!list) return;
    clearHistoryList();
    var li = document.createElement('li');
    li.className = 'agent-drawer__history-empty';
    var h = document.createElement('h4'); h.textContent = 'No matches';
    var p = document.createElement('p'); p.className = 'form-hint';
    p.textContent = 'No conversations match "' + query + '". Try a different search term.';
    li.appendChild(h); li.appendChild(p);
    list.appendChild(li);
  }

  function renderHistoryItem(item, query, opts) {
    var li = document.createElement('li');
    li.className = 'agent-drawer__history-item';
    li.setAttribute('data-conversation-id', String(item.id || ''));
    if (item && typeof item.orgId === 'string' && item.orgId.length > 0) {
      li.setAttribute('data-org-id', String(item.orgId));
    }
    if (item && typeof item.orgName === 'string' && item.orgName.length > 0) {
      li.setAttribute('data-org-name', String(item.orgName));
    }
    li.setAttribute('tabindex', '-1');
    li.setAttribute('data-action', 'resumeConversation');
    if (item.title) {
      li.setAttribute('title', String(item.title));
      li.setAttribute('aria-label', 'Resume ' + String(item.title));
    } else {
      li.setAttribute('aria-label', 'Resume conversation');
    }

    var titleDiv = document.createElement('div');
    titleDiv.className = 'agent-drawer__history-item-title';
    titleDiv.textContent = item.title ? String(item.title) : 'Untitled conversation';
    li.appendChild(titleDiv);

    if (item.snippet) {
      var snippetDiv = document.createElement('div');
      snippetDiv.className = 'agent-drawer__history-item-snippet';
      snippetDiv.appendChild(renderSnippetWithMark(String(item.snippet), query || ''));
      li.appendChild(snippetDiv);
    } else {
      var metaDiv = document.createElement('div');
      metaDiv.className = 'agent-drawer__history-item-meta';
      var ts = item.lastMessageAt ? String(item.lastMessageAt) : '';
      var cnt = typeof item.messageCount === 'number' ? item.messageCount : 0;
      metaDiv.textContent = ts + ' · ' + cnt + ' message' + (cnt === 1 ? '' : 's');
      li.appendChild(metaDiv);
    }

    var showOrgChip = !!(opts && opts.showOrgChip);
    if (showOrgChip && item && typeof item.orgName === 'string' && item.orgName.length > 0) {
      var chip = document.createElement('span');
      chip.className = 'agent-drawer__history-item-org-chip';
      chip.textContent = String(item.orgName);
      chip.setAttribute('aria-label', 'Org: ' + String(item.orgName));
      li.appendChild(chip);
    }

    var menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'agent-drawer__history-item-menu btn btn--ghost';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Actions for ' + (item.title || 'conversation'));
    menuBtn.setAttribute('data-action', 'openHistoryItemMenu');
    menuBtn.textContent = '⋮';
    li.appendChild(menuBtn);

    return li;
  }

  function renderSnippetWithMark(snippet, query) {
    var frag = document.createDocumentFragment();
    if (!query || query.length === 0) {
      frag.appendChild(document.createTextNode(snippet));
      return frag;
    }
    var idx = snippet.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) {
      frag.appendChild(document.createTextNode(snippet));
      return frag;
    }
    var prefix = snippet.slice(0, idx);
    var match = snippet.slice(idx, idx + query.length);
    var suffix = snippet.slice(idx + query.length);
    if (prefix.length > 0) frag.appendChild(document.createTextNode(prefix));
    var mark = document.createElement('mark');
    mark.textContent = match;
    frag.appendChild(mark);
    if (suffix.length > 0) frag.appendChild(document.createTextNode(suffix));
    return frag;
  }

  function replaceListWithItems(items, query) {
    var list = historyListEl(); if (!list) return;
    clearHistoryList();
    if (!items || items.length === 0) {
      if (query && query.length > 0) { renderNoMatches(query); }
      else { renderEmptyState(); }
      return;
    }
    for (var i = 0; i < items.length; i++) {
      list.appendChild(renderHistoryItem(items[i], query, { showOrgChip: historyShowOrgChip }));
    }
  }

  function appendItems(items, query) {
    var list = historyListEl(); if (!list) return;
    for (var i = 0; i < items.length; i++) {
      list.appendChild(renderHistoryItem(items[i], query, { showOrgChip: historyShowOrgChip }));
    }
  }

  function fetchHistoryPage(offset, replace) {
    var url = '/agent/conversations?limit=' + HISTORY_PAGE_LIMIT + '&offset=' + offset;
    historyIsFetchingMore = true;
    return fetch(url, {
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'application/json' },
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('load_failed')); })
      .then(function (payload) {
        var items = (payload && payload.items) || [];
        if (payload && typeof payload.showOrgChip === 'boolean') {
          historyShowOrgChip = payload.showOrgChip;
        }
        if (replace) {
          replaceListWithItems(items, '');
          historyCachedPage = items.slice();
        } else {
          appendItems(items, '');
          if (historyCachedPage) { historyCachedPage = historyCachedPage.concat(items); }
        }
        historyNextOffset = payload && (payload.nextOffset === null || typeof payload.nextOffset === 'number')
          ? payload.nextOffset : null;
        historyIsFetchingMore = false;
        if (historyNextOffset === null && historyIO) {
          try { historyIO.disconnect(); } catch (_e) { /* ignore */ }
        }
      })
      .catch(function () {
        historyIsFetchingMore = false;
        var errBox = document.querySelector('.agent-drawer__history-error');
        if (errBox) { errBox.removeAttribute('hidden'); }
      });
  }

  function fetchNextHistoryPage() {
    if (historyIsFetchingMore) return;
    if (historyNextOffset === null || historyNextOffset === undefined) return;
    fetchHistoryPage(historyNextOffset, false);
  }

  function fetchHistorySearch(query) {
    var trimmed = (query || '').trim();
    if (trimmed.length === 0) {
      if (historyCachedPage) { replaceListWithItems(historyCachedPage, ''); }
      setHistoryLive('');
      return Promise.resolve();
    }
    var url = '/agent/conversations/search?q=' + encodeURIComponent(trimmed) + '&limit=' + HISTORY_PAGE_LIMIT;
    return fetch(url, {
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'application/json' },
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('search_failed')); })
      .then(function (payload) {
        var items = (payload && payload.items) || [];
        if (payload && typeof payload.showOrgChip === 'boolean') {
          historyShowOrgChip = payload.showOrgChip;
        }
        replaceListWithItems(items, trimmed);
        var n = items.length;
        setHistoryLive(n + ' conversation' + (n === 1 ? '' : 's') + ' match');
      })
      .catch(function () { /* keep existing list */ });
  }

  function setHistoryLive(text) {
    var el = byId(HISTORY_LIVE_ID);
    if (el) el.textContent = text;
  }

  function onHistorySearchInput(value) {
    var clearBtn = document.querySelector('[data-action="clearAgentHistorySearch"]');
    if (clearBtn) {
      if (value && value.length > 0) clearBtn.removeAttribute('hidden');
      else clearBtn.setAttribute('hidden', '');
    }
    if (historySearchTimer) { clearTimeout(historySearchTimer); historySearchTimer = null; }
    historySearchTimer = setTimeout(function () {
      fetchHistorySearch(value);
    }, 250);
  }

  function wireHistorySearch() {
    if (historySearchWired) return;
    var input = byId(HISTORY_SEARCH_ID); if (!input) return;
    input.addEventListener('input', function (e) {
      var t = e.target && e.target.value != null ? e.target.value : '';
      onHistorySearchInput(t);
    });
    historySearchWired = true;
  }

  function clearHistorySearch() {
    var input = byId(HISTORY_SEARCH_ID); if (!input) return;
    input.value = '';
    var clearBtn = document.querySelector('[data-action="clearAgentHistorySearch"]');
    if (clearBtn) clearBtn.setAttribute('hidden', '');
    if (historySearchTimer) { clearTimeout(historySearchTimer); historySearchTimer = null; }
    if (historyCachedPage) { replaceListWithItems(historyCachedPage, ''); }
    setHistoryLive('');
  }

  function armHistorySentinel() {
    var sentinel = document.querySelector('.agent-drawer__history-sentinel');
    if (!sentinel) return;
    if (typeof IntersectionObserver !== 'function') return;
    if (historyIO) { try { historyIO.disconnect(); } catch (_e) { /* ignore */ } }
    historyIO = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting && !historyIsFetchingMore && historyNextOffset !== null && historyNextOffset !== undefined) {
          fetchNextHistoryPage();
        }
      }
    });
    historyIO.observe(sentinel);
  }

  function closeHistoryMenu(restoreFocus) {
    if (!historyActiveMenu) return;
    var trigger = historyActiveMenu.trigger;
    var menuEl = historyActiveMenu.menuEl;
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) { try { trigger.focus(); } catch (_e) { /* ignore */ } }
    }
    historyActiveMenu = null;
  }

  function toggleItemMenu(itemEl) {
    if (!itemEl) return;
    var trigger = itemEl.querySelector('.agent-drawer__history-item-menu');
    if (!trigger) return;
    if (historyActiveMenu && historyActiveMenu.trigger === trigger) {
      closeHistoryMenu();
      return;
    }
    closeHistoryMenu();
    var menu = document.createElement('div');
    menu.className = 'agent-drawer__history-menu';
    menu.setAttribute('role', 'menu');
    var rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'agent-drawer__history-menu-item';
    rename.setAttribute('role', 'menuitem');
    rename.setAttribute('data-action', 'renameConversation');
    rename.textContent = 'Rename';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'agent-drawer__history-menu-item agent-drawer__history-menu-item--danger';
    del.setAttribute('role', 'menuitem');
    del.setAttribute('data-action', 'deleteConversation');
    del.textContent = 'Delete';
    menu.appendChild(rename); menu.appendChild(del);
    itemEl.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');
    try { rename.focus(); } catch (_e) { /* ignore */ }
    historyActiveMenu = { trigger: trigger, menuEl: menu };
  }

  function findItemEl(el) {
    return el && el.closest ? el.closest('.agent-drawer__history-item') : null;
  }

  function snapshotChildren(el) {
    var nodes = []; var c = el.firstChild;
    while (c) { nodes.push(c); c = c.nextSibling; }
    return nodes;
  }

  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function enterRenameMode(itemEl) {
    if (!itemEl) return;
    closeHistoryMenu();
    var id = itemEl.getAttribute('data-conversation-id') || '';
    var original = snapshotChildren(itemEl);
    historyActiveRename = { liEl: itemEl, originalChildren: original, id: id };
    clearChildren(itemEl);
    var wrap = document.createElement('div');
    wrap.className = 'agent-drawer__history-rename';
    var input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Conversation name');
    var titleNode = original[0];
    input.value = titleNode && titleNode.textContent ? titleNode.textContent : '';
    wrap.appendChild(input);
    var save = document.createElement('button');
    save.type = 'button'; save.className = 'btn btn--primary btn--sm';
    save.setAttribute('data-action', 'confirmRename');
    save.textContent = 'Save';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn--ghost btn--sm';
    cancel.setAttribute('data-action', 'cancelRename');
    cancel.textContent = 'Cancel';
    wrap.appendChild(save); wrap.appendChild(cancel);
    itemEl.appendChild(wrap);
    try { input.focus(); input.select(); } catch (_e) { /* ignore */ }
  }

  function cancelRename() {
    if (!historyActiveRename) return;
    var li = historyActiveRename.liEl;
    clearChildren(li);
    var kids = historyActiveRename.originalChildren;
    for (var i = 0; i < kids.length; i++) { li.appendChild(kids[i]); }
    historyActiveRename = null;
  }

  function submitRename() {
    if (!historyActiveRename) return;
    var li = historyActiveRename.liEl;
    var id = historyActiveRename.id;
    var input = li.querySelector('.agent-drawer__history-rename input');
    if (!input) return;
    var title = String(input.value || '').trim();
    if (title.length === 0) {
      renderRenameError(li, 'Name cannot be empty.');
      try { input.focus(); } catch (_e) { /* ignore */ }
      return;
    }
    fetch('/agent/conversations/' + encodeURIComponent(id) + '/rename', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'x-csrf-token': csrfToken(),
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({ title: title }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('rename_failed');
        return r.json();
      })
      .then(function (_payload) {
        if (!historyActiveRename) return;
        var newTitle = title;
        var kids = historyActiveRename.originalChildren;
        if (kids[0] && kids[0].textContent !== undefined) { kids[0].textContent = newTitle; }
        li.setAttribute('title', newTitle);
        clearChildren(li);
        for (var i = 0; i < kids.length; i++) { li.appendChild(kids[i]); }
        historyActiveRename = null;
      })
      .catch(function () {
        renderRenameError(li, "Couldn't rename this conversation. Try again.");
        var input2 = li.querySelector('.agent-drawer__history-rename input');
        if (input2) { try { input2.focus(); } catch (_e) { /* ignore */ } }
      });
  }

  function renderRenameError(li, text) {
    var wrap = li.querySelector('.agent-drawer__history-rename'); if (!wrap) return;
    var existing = wrap.querySelector('.form-hint--error');
    if (existing) { existing.textContent = text; return; }
    var hint = document.createElement('div');
    hint.className = 'form-hint form-hint--error';
    hint.setAttribute('role', 'alert');
    hint.textContent = text;
    wrap.appendChild(hint);
  }

  function enterDeleteConfirm(itemEl) {
    if (!itemEl) return;
    closeHistoryMenu();
    var id = itemEl.getAttribute('data-conversation-id') || '';
    var original = snapshotChildren(itemEl);
    historyActiveDelete = { liEl: itemEl, originalChildren: original, id: id };
    clearChildren(itemEl);
    var wrap = document.createElement('div');
    wrap.className = 'agent-drawer__history-confirm';
    wrap.setAttribute('role', 'alertdialog');
    var q = document.createElement('p');
    q.textContent = 'Delete this conversation?';
    wrap.appendChild(q);
    var delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'btn btn--danger btn--sm';
    delBtn.setAttribute('data-action', 'confirmDelete');
    delBtn.textContent = 'Delete';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn--ghost btn--sm';
    cancel.setAttribute('data-action', 'cancelDelete');
    cancel.textContent = 'Cancel';
    wrap.appendChild(delBtn); wrap.appendChild(cancel);
    itemEl.appendChild(wrap);
    try { cancel.focus(); } catch (_e) { /* ignore */ }
  }

  function cancelDelete() {
    if (!historyActiveDelete) return;
    var li = historyActiveDelete.liEl;
    clearChildren(li);
    var kids = historyActiveDelete.originalChildren;
    for (var i = 0; i < kids.length; i++) { li.appendChild(kids[i]); }
    historyActiveDelete = null;
  }

  function submitDelete() {
    if (!historyActiveDelete) return;
    var li = historyActiveDelete.liEl;
    var id = historyActiveDelete.id;
    fetch('/agent/conversations/' + encodeURIComponent(id) + '/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'x-csrf-token': csrfToken(),
        'accept': 'application/json',
      },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('delete_failed');
        if (li && li.parentNode) li.parentNode.removeChild(li);
        historyActiveDelete = null;
      })
      .catch(function () {
        var wrap = li.querySelector('.agent-drawer__history-confirm');
        if (!wrap) return;
        var existing = wrap.querySelector('.form-hint');
        if (existing) return;
        var hint = document.createElement('div');
        hint.className = 'form-hint form-hint--error';
        hint.setAttribute('role', 'alert');
        hint.textContent = "Couldn't delete this conversation. Try again.";
        wrap.appendChild(hint);
      });
  }

  function resumeConversation(conversationId) {
    if (!conversationId || conversationId.length === 0) return;
    fetch('/agent/conversations/' + encodeURIComponent(conversationId), {
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'application/json' },
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('resume_failed')); })
      .then(function (_payload) {
        setConversationId(conversationId);
        loadPanel();
        closeHistoryPanel();
      })
      .catch(function () { /* leave panel open; user can retry */ });
  }

  function moveRovingFocus(delta) {
    var list = historyListEl(); if (!list) return;
    var rows = list.querySelectorAll('li.agent-drawer__history-item');
    if (rows.length === 0) return;
    var currentIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === document.activeElement) { currentIdx = i; break; }
    }
    if (currentIdx < 0) currentIdx = 0;
    var nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= rows.length) nextIdx = rows.length - 1;
    if (nextIdx === currentIdx) return;
    rows[currentIdx].setAttribute('tabindex', '-1');
    rows[nextIdx].setAttribute('tabindex', '0');
    try { rows[nextIdx].focus(); } catch (_e) { /* ignore */ }
  }

  // ── delegated listeners ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-action="openAgentHistory"]')) {
      e.preventDefault(); openHistoryPanel(); return;
    }
    if (e.target.closest('[data-action="closeAgentHistory"]')) {
      e.preventDefault(); closeHistoryPanel(); return;
    }
    if (e.target.closest('[data-action="clearAgentHistorySearch"]')) {
      e.preventDefault(); clearHistorySearch(); return;
    }
    if (e.target.closest('[data-action="retryHistory"]')) {
      e.preventDefault();
      var errBox = document.querySelector('.agent-drawer__history-error');
      if (errBox) errBox.setAttribute('hidden', '');
      fetchHistoryPage(0, true);
      return;
    }
    var menuTriggerEl = e.target.closest('[data-action="openHistoryItemMenu"]');
    if (menuTriggerEl) { e.preventDefault(); e.stopPropagation(); toggleItemMenu(findItemEl(menuTriggerEl)); return; }
    var renameMenuEl = e.target.closest('[data-action="renameConversation"]');
    if (renameMenuEl) { e.preventDefault(); enterRenameMode(findItemEl(renameMenuEl)); return; }
    var deleteMenuEl = e.target.closest('[data-action="deleteConversation"]');
    if (deleteMenuEl) { e.preventDefault(); enterDeleteConfirm(findItemEl(deleteMenuEl)); return; }
    if (e.target.closest('[data-action="confirmRename"]')) { e.preventDefault(); submitRename(); return; }
    if (e.target.closest('[data-action="cancelRename"]')) { e.preventDefault(); cancelRename(); return; }
    if (e.target.closest('[data-action="confirmDelete"]')) { e.preventDefault(); submitDelete(); return; }
    if (e.target.closest('[data-action="cancelDelete"]')) { e.preventDefault(); cancelDelete(); return; }
    var resumeEl = e.target.closest('[data-action="resumeConversation"]');
    if (resumeEl && !e.target.closest('[data-action="openHistoryItemMenu"]')) {
      e.preventDefault();
      var cid = resumeEl.getAttribute('data-conversation-id');
      if (!cid) return;
      var targetOrgId = resumeEl.getAttribute('data-org-id') || '';
      var targetOrgName = resumeEl.getAttribute('data-org-name') || '';
      autoSwitchOrgIfNeeded(targetOrgId, targetOrgName).then(function (ok) {
        if (ok) resumeConversation(cid);
      });
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!historyIsPanelOpen()) return;
    if (e.key === 'Enter' && historyActiveRename) {
      var ri = historyActiveRename.liEl.querySelector('.agent-drawer__history-rename input');
      if (ri && document.activeElement === ri) {
        e.preventDefault();
        submitRename();
        return;
      }
    }
    if (e.key === 'Escape' && historyActiveRename) {
      var ri2 = historyActiveRename.liEl.querySelector('.agent-drawer__history-rename input');
      if (ri2 && document.activeElement === ri2) {
        e.preventDefault();
        cancelRename();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (historyActiveMenu) { e.preventDefault(); closeHistoryMenu(true); return; }
      var searchInput = byId(HISTORY_SEARCH_ID);
      if (searchInput && document.activeElement === searchInput && searchInput.value.length > 0) {
        e.preventDefault(); clearHistorySearch(); return;
      }
      e.preventDefault(); closeHistoryPanel(); return;
    }
    var list = historyListEl();
    if (list) {
      var activeItem = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('li.agent-drawer__history-item')
        : null;
      if (activeItem) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveRovingFocus(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveRovingFocus(-1); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          var cid = activeItem.getAttribute('data-conversation-id');
          if (cid) resumeConversation(cid);
          return;
        }
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          toggleItemMenu(activeItem);
          return;
        }
      }
    }
  });

  // Expose the panel-open predicate so agent.js's drawer Esc handler can
  // defer to it (Esc on history panel close vs Esc on drawer close).
  A.historyIsPanelOpen = historyIsPanelOpen;

  // Test export augmentation — extends the bag agent.js populates.
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    var bag = window.__agentTestExports || {};
    bag.renderHistoryItem = renderHistoryItem;
    bag.setHistoryShowOrgChip = function (v) { historyShowOrgChip = !!v; };
    bag.openHistoryPanel = openHistoryPanel;
    bag.closeHistoryPanel = closeHistoryPanel;
    bag.fetchHistoryPage = fetchHistoryPage;
    bag.fetchHistorySearch = fetchHistorySearch;
    window.__agentTestExports = bag;
  }
})();
