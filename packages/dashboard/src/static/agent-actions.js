/* Phase 39.1-02 — agent-actions module.
 *
 * Per-message action handlers extracted from agent.js. Owns:
 *   - retry / copy / share / edit-resend / edit-form click+submit handlers
 *   - flashActionResult, actionT, removeMessageFromDom helpers
 *   - showShareToast helper
 *   - getMarkdownSource fallback (cache miss → fetch /agent/conversations/.../messages/...)
 *   - ClipboardItem(Promise) share path for user-gesture-preserving clipboard write
 *
 * Reads shared utilities from window.__luqenAgent (csrfToken, byId, announce,
 * getConversationId, readToolI18n, recordMarkdownSource, readMarkdownSource,
 * writeToClipboard, clearToolChips, openStream, loadPanel). agent.js MUST be
 * loaded before this file.
 *
 * Wires its own delegated click + submit listeners on document so handlers
 * stay self-contained. agent.js's click delegator continues to handle
 * non-action affordances (drawer toggle, history panel, speech, agent-stop,
 * confirm-dialog).
 */
(function () {
  'use strict';

  var A = window.__luqenAgent;
  if (!A) return; // agent.js failed to load

  var csrfToken = A.csrfToken;
  var byId = A.byId;
  var announce = A.announce;
  var getConversationId = A.getConversationId;
  var readToolI18n = A.readToolI18n;
  var recordMarkdownSource = A.recordMarkdownSource;
  var readMarkdownSource = A.readMarkdownSource;
  var writeToClipboard = A.writeToClipboard;

  // ── helpers ────────────────────────────────────────────────────────────

  function clearToolChips() {
    var fn = A.clearToolChips;
    if (typeof fn === 'function') fn();
  }

  function openStream(cid) {
    var fn = A.openStream;
    if (typeof fn === 'function') return fn(cid);
  }

  function loadPanel() {
    var fn = A.loadPanel;
    if (typeof fn === 'function') return fn();
  }

  function actionT(key) {
    try {
      var dict = readToolI18n();
      if (dict && typeof dict[key] === 'string' && dict[key].length > 0) return dict[key];
    } catch (_e) { /* ignore */ }
    return key;
  }

  function flashActionResult(btn, ok) {
    if (!btn) return;
    var children = [];
    for (var i = 0; i < btn.childNodes.length; i++) {
      children.push(btn.childNodes[i].cloneNode(true));
    }
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    btn.appendChild(document.createTextNode(ok ? '\u2713' : '\u2715'));
    btn.classList.add(ok ? 'agent-msg__action--ok' : 'agent-msg__action--err');
    setTimeout(function () {
      btn.classList.remove('agent-msg__action--ok');
      btn.classList.remove('agent-msg__action--err');
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      for (var j = 0; j < children.length; j++) btn.appendChild(children[j]);
    }, 1500);
  }

  function removeMessageFromDom(messageId) {
    if (!messageId) return;
    var sel;
    if (window.CSS && typeof window.CSS.escape === 'function') {
      sel = '[data-message-id="' + window.CSS.escape(messageId) + '"]';
    } else {
      sel = '[data-message-id="' + String(messageId).replace(/"/g, '\\"') + '"]';
    }
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      if (els[i].parentNode) els[i].parentNode.removeChild(els[i]);
    }
  }

  function getMarkdownSource(messageId, conversationId) {
    var cached = readMarkdownSource(messageId);
    if (typeof cached === 'string') return Promise.resolve(cached);
    if (!conversationId || conversationId.length === 0) return Promise.resolve('');
    var url = '/agent/conversations/' + encodeURIComponent(conversationId)
      + '/messages/' + encodeURIComponent(messageId);
    return fetch(url, {
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'application/json' },
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('msg_load_failed')); })
      .then(function (payload) {
        var content = payload && typeof payload.content === 'string' ? payload.content : '';
        recordMarkdownSource(messageId, content);
        return content;
      });
  }

  // Lightweight toast specifically for share feedback. Renders inside the
  // drawer for ~2.5s. Requested by UAT 2026-04-25 to make share outcome
  // visible without relying on aria-live (which is silent for sighted users).
  function showShareToast(message) {
    if (!message) return;
    var drawer = byId('agent-drawer') || document.body;
    var existing = drawer.querySelector('.agent-drawer__toast');
    if (existing) existing.parentNode.removeChild(existing);
    var toast = document.createElement('div');
    toast.className = 'agent-drawer__toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    drawer.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2500);
  }

  // ── handlers ───────────────────────────────────────────────────────────

  function handleRetryAssistantClick(btn) {
    var mid = btn.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid || !cid) return;
    btn.disabled = true;
    var url = '/agent/conversations/' + encodeURIComponent(cid)
      + '/messages/' + encodeURIComponent(mid) + '/retry';
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('retry_failed')); })
      .then(function () {
        removeMessageFromDom(mid);
        clearToolChips();
        openStream(cid);
      })
      .catch(function () {
        btn.disabled = false;
        announce(actionT('actions.retryFailed'));
      });
  }

  function handleCopyAssistantClick(btn) {
    var mid = btn.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid) return;
    // Prefer the synchronous cache path so the user-gesture context is preserved
    // for navigator.clipboard.writeText. Async fetch breaks the gesture and the
    // Clipboard API silently rejects. Cache is seeded by replaceMessagesFromHtml.
    var cached = readMarkdownSource(mid);
    if (typeof cached === 'string') {
      writeToClipboard(cached).then(function (ok) {
        flashActionResult(btn, ok);
        announce(ok ? actionT('actions.copied') : actionT('actions.copyFailed'));
      });
      return;
    }
    getMarkdownSource(mid, cid)
      .then(function (text) { return writeToClipboard(text); })
      .then(function (ok) {
        flashActionResult(btn, ok);
        announce(ok ? actionT('actions.copied') : actionT('actions.copyFailed'));
      })
      .catch(function () {
        flashActionResult(btn, false);
        announce(actionT('actions.copyFailed'));
      });
  }

  function handleShareAssistantClick(btn) {
    var mid = btn.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid || !cid) return;
    btn.disabled = true;
    var endpoint = '/agent/conversations/' + encodeURIComponent(cid)
      + '/messages/' + encodeURIComponent(mid) + '/share';

    var sharePromise = fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('share_failed')); })
      .then(function (payload) {
        var path = payload && typeof payload.url === 'string' ? payload.url : '';
        return window.location.origin + path;
      });

    // Fire the Clipboard API SYNCHRONOUSLY inside the click handler. Modern
    // browsers (Chrome 76+, Safari 13.1+, Firefox 87+) support a ClipboardItem
    // whose value is a Promise — the write() call itself happens during the
    // user-gesture window, and the browser awaits the Promise to resolve the
    // bytes. This is the only reliable way to copy fetched data on click.
    var clipboardWrite = null;
    try {
      if (window.isSecureContext && window.navigator && window.navigator.clipboard
          && typeof window.ClipboardItem === 'function'
          && typeof window.navigator.clipboard.write === 'function') {
        var item = new ClipboardItem({
          'text/plain': sharePromise.then(function (u) {
            return new Blob([u], { type: 'text/plain' });
          }),
        });
        clipboardWrite = window.navigator.clipboard.write([item]);
      }
    } catch (_e) { /* unsupported — fall through to writeText fallback */ }

    if (clipboardWrite === null) {
      clipboardWrite = sharePromise.then(function (u) {
        return writeToClipboard(u);
      });
    }
    if (clipboardWrite && typeof clipboardWrite.catch === 'function') {
      clipboardWrite.catch(function () {});
    }

    sharePromise
      .then(function (_fullUrl) {
        flashActionResult(btn, true);
        var clipboardOutcome = clipboardWrite
          ? clipboardWrite.then(function () { return true; }, function () { return false; })
          : Promise.resolve(false);
        clipboardOutcome.then(function (ok) {
          var msg = ok ? 'Share link copied to clipboard' : 'Share link ready — click to open';
          showShareToast(msg);
          announce(msg);
        });
      })
      .catch(function () {
        flashActionResult(btn, false);
        showShareToast('Share failed');
        announce(actionT('actions.shareFailed'));
      })
      .then(function () { btn.disabled = false; });
  }

  // Edit/cancel/submit support — captures the original body text so cancel
  // can restore it without a server round-trip.
  var activeEdit = null; // { messageId, originalChildren: Node[], bubble }

  function handleEditUserMessageClick(btn) {
    var mid = btn.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid || !cid) return;
    var bubble = btn.closest('.agent-msg');
    if (!bubble) return;
    var body = bubble.querySelector('.agent-msg__body');
    if (!body) return;
    var originalChildren = [];
    for (var i = 0; i < body.childNodes.length; i++) {
      originalChildren.push(body.childNodes[i].cloneNode(true));
    }
    activeEdit = { messageId: mid, originalChildren: originalChildren, bubble: bubble };
    var url = '/agent/conversations/' + encodeURIComponent(cid)
      + '/messages/' + encodeURIComponent(mid) + '/edit-form';
    fetch(url, {
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'text/html' },
    })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('edit_form_failed')); })
      .then(function (html) {
        while (body.firstChild) body.removeChild(body.firstChild);
        var parsed = new DOMParser().parseFromString(
          '<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html');
        var src = parsed.body;
        while (src.firstChild) {
          body.appendChild(document.importNode(src.firstChild, true));
          src.removeChild(src.firstChild);
        }
        var actions = bubble.querySelector('.agent-msg__actions');
        if (actions) actions.setAttribute('hidden', '');
        var ta = body.querySelector('textarea');
        if (ta) {
          try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
          catch (_e) { /* ignore */ }
        }
      })
      .catch(function () {
        restoreEditBody();
        announce(actionT('actions.editFailed'));
      });
  }

  function restoreEditBody() {
    if (!activeEdit) return;
    var bubble = activeEdit.bubble;
    if (!bubble) { activeEdit = null; return; }
    var body = bubble.querySelector('.agent-msg__body');
    if (body) {
      while (body.firstChild) body.removeChild(body.firstChild);
      for (var i = 0; i < activeEdit.originalChildren.length; i++) {
        body.appendChild(activeEdit.originalChildren[i]);
      }
    }
    var actions = bubble.querySelector('.agent-msg__actions');
    if (actions) actions.removeAttribute('hidden');
    activeEdit = null;
  }

  function handleCancelEditUserMessageClick(_btn) {
    restoreEditBody();
  }

  function handleSubmitEditUserMessage(form) {
    var mid = form.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid || !cid) return;
    var ta = form.querySelector('textarea[name="content"]');
    var raw = ta ? String(ta.value || '') : '';
    var content = raw.trim();
    if (content.length === 0) {
      announce(actionT('actions.editEmpty'));
      return;
    }
    var saveBtn = form.querySelector('button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;
    var url = '/agent/conversations/' + encodeURIComponent(cid)
      + '/messages/' + encodeURIComponent(mid) + '/edit-resend';
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('edit_resend_failed')); })
      .then(function () {
        activeEdit = null;
        loadPanel();
        clearToolChips();
        openStream(cid);
      })
      .catch(function () {
        if (saveBtn) saveBtn.disabled = false;
        announce(actionT('actions.editFailed'));
      });
  }

  // ── delegated listeners ───────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var retryEl = e.target.closest('[data-action="retryAssistant"]');
    if (retryEl) {
      e.preventDefault();
      handleRetryAssistantClick(retryEl);
      return;
    }
    var copyEl = e.target.closest('[data-action="copyAssistant"]');
    if (copyEl) {
      e.preventDefault();
      handleCopyAssistantClick(copyEl);
      return;
    }
    var shareEl = e.target.closest('[data-action="shareAssistant"]');
    if (shareEl) {
      e.preventDefault();
      handleShareAssistantClick(shareEl);
      return;
    }
    var editEl = e.target.closest('[data-action="editUserMessage"]');
    if (editEl) {
      e.preventDefault();
      handleEditUserMessageClick(editEl);
      return;
    }
    var cancelEditEl = e.target.closest('[data-action="cancelEditUserMessage"]');
    if (cancelEditEl) {
      e.preventDefault();
      handleCancelEditUserMessageClick(cancelEditEl);
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    if (!e.target || !e.target.closest) return;
    var form = e.target.closest('form[data-action="submitEditUserMessage"]');
    if (!form) return;
    e.preventDefault();
    handleSubmitEditUserMessage(form);
  });

  // Test export augmentation — extends the bag agent.js already populates.
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    var bag = window.__agentTestExports || {};
    bag.handleRetryAssistantClick = handleRetryAssistantClick;
    bag.handleCopyAssistantClick = handleCopyAssistantClick;
    bag.handleShareAssistantClick = handleShareAssistantClick;
    bag.handleEditUserMessageClick = handleEditUserMessageClick;
    bag.handleSubmitEditUserMessage = handleSubmitEditUserMessage;
    bag.getMarkdownSource = getMarkdownSource;
    window.__agentTestExports = bag;
  }
})();
