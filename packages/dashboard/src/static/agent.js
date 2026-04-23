/* Phase 32 Plan 06 + 07 — agent.js
 * EventSource streaming client + localStorage drawer state + event delegation.
 * Plan 07 extends with: native <dialog> confirmation (APER-02), DB-recovery
 * on drawer mount (SC#4), Web Speech API wiring (AGENT-03 — feature-detect
 * + tap-to-start + no auto-submit).
 * NEVER hx-sse (D-21). Plain EventSource (D-20). close() on done prevents
 * auto-reconnect (AI-SPEC §3 Pitfall 3). CSP-safe: no inline handlers, no eval.
 * XSS: tokens/tool_calls/dialog body via createTextNode/textContent. loadPanel
 * uses DOMParser + importNode (not innerHTML) to adopt trusted same-origin HTML.
 */
(function () {
  'use strict';

  var LS_KEY = 'luqen.agent.panel';
  var LS_CONV_KEY = 'luqen.agent.conversationId';
  var DRAWER_ID = 'agent-drawer', BACKDROP_ID = 'agent-backdrop', LAUNCH_ID = 'agent-launch';
  var INPUT_ID = 'agent-input', FORM_ID = 'agent-form', MESSAGES_ID = 'agent-messages';
  var STATUS_ID = 'agent-aria-status', STREAM_STATUS_ID = 'agent-stream-status';
  var DIALOG_ID = 'agent-confirm-dialog';
  var CONFIRM_SUMMARY_ID = 'agent-confirm-summary';
  var CONFIRM_JSON_ID = 'agent-confirm-json';
  var SPEECH_BTN_ID = 'agent-speech';
  var activeStream = null;

  function byId(id) { return document.getElementById(id); }
  function setStatus(t) { var el = byId(STATUS_ID); if (el) el.textContent = t; }
  function csrfToken() { var m = document.querySelector('meta[name="csrf-token"]'); return m ? m.getAttribute('content') : ''; }
  function getCsrfToken() { return csrfToken(); }
  function isOpen() { var d = byId(DRAWER_ID); return !!d && !d.hasAttribute('hidden'); }

  function applyInitialPanelState() {
    if (localStorage.getItem(LS_KEY) === 'open') { openDrawer(false); }
  }

  function openDrawer(loadPanelContent) {
    var d = byId(DRAWER_ID), l = byId(LAUNCH_ID), bd = byId(BACKDROP_ID);
    if (!d) return;
    d.removeAttribute('hidden'); d.classList.add('agent-drawer--open');
    if (bd) bd.removeAttribute('hidden');
    if (l) l.setAttribute('aria-expanded', 'true');
    try { localStorage.setItem(LS_KEY, 'open'); } catch (_e) { /* ignore */ }
    if (loadPanelContent !== false) { loadPanel(); }
    var input = byId(INPUT_ID); if (input) input.focus();
  }

  function closeDrawer() {
    var d = byId(DRAWER_ID), l = byId(LAUNCH_ID), bd = byId(BACKDROP_ID);
    if (!d) return;
    d.setAttribute('hidden', ''); d.classList.remove('agent-drawer--open');
    if (bd) bd.setAttribute('hidden', '');
    if (l) { l.setAttribute('aria-expanded', 'false'); l.focus(); }
    try { localStorage.setItem(LS_KEY, 'closed'); } catch (_e) { /* ignore */ }
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } activeStream = null; }
  }

  function getConversationId() {
    var form = byId(FORM_ID); if (!form) return '';
    var cid = form.getAttribute('data-conversation-id');
    return cid && cid.length > 0 ? cid : '';
  }

  function setConversationId(cid) {
    if (!cid || cid.length === 0) return;
    var form = byId(FORM_ID); if (form) form.setAttribute('data-conversation-id', cid);
    var hidden = byId('agent-conversation-id-field'); if (hidden) hidden.value = cid;
    try { localStorage.setItem(LS_CONV_KEY, cid); } catch (_e) { /* ignore */ }
  }

  function restoreConversationId() {
    try {
      var cid = localStorage.getItem(LS_CONV_KEY);
      if (cid && cid.length > 0) { setConversationId(cid); }
    } catch (_e) { /* ignore */ }
  }

  function replaceMessagesFromHtml(html) {
    var msgs = byId(MESSAGES_ID); if (!msgs) return;
    while (msgs.firstChild) { msgs.removeChild(msgs.firstChild); }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var src = doc.body;
    while (src && src.firstChild) {
      msgs.appendChild(document.importNode(src.firstChild, true));
      src.removeChild(src.firstChild);
    }
  }

  function loadPanel() {
    var cid = getConversationId();
    if (!cid || cid.length === 0) { return; }
    var url = '/agent/panel?conversationId=' + encodeURIComponent(cid);
    fetch(url, { credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken() } })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (html.length > 0) { replaceMessagesFromHtml(html); }
        var msgs = byId(MESSAGES_ID);
        var pending = msgs ? msgs.querySelector('.agent-msg--tool[data-pending="true"]') : null;
        if (pending) {
          // Reconstruct a pending_confirmation payload from the DOM. The tool
          // bubble renders tool_call_json inside a <pre aria-label="Tool call details">
          // — parse it back to {id,name,args} so the dialog renders identically
          // to the SSE-driven path. No network round-trip needed (SC#4).
          var pre = pending.querySelector('pre[aria-label="Tool call details"]');
          var parsedCall = null;
          if (pre && pre.textContent) {
            try { parsedCall = JSON.parse(pre.textContent); } catch (_e) { parsedCall = null; }
          }
          var data = {
            messageId: pending.getAttribute('data-message-id') || '',
            toolName: parsedCall && parsedCall.name ? parsedCall.name : '',
            args: parsedCall && parsedCall.args ? parsedCall.args : {},
            confirmationText: null
          };
          document.dispatchEvent(new CustomEvent('agent:pending-confirmation-dom-recovery', {
            detail: data
          }));
        }
      })
      .catch(function () { /* user can re-open */ });
  }

  function ensureAssistantBubble() {
    var msgs = byId(MESSAGES_ID); if (!msgs) return null;
    var existing = msgs.querySelector('.agent-msg--assistant[aria-busy="true"]');
    if (existing) return existing.querySelector('.agent-msg__body');
    var wrap = document.createElement('div');
    wrap.className = 'agent-msg agent-msg--assistant';
    wrap.setAttribute('aria-busy', 'true');
    var role = document.createElement('span'); role.className = 'agent-msg__role'; role.textContent = 'Assistant';
    var body = document.createElement('div'); body.className = 'agent-msg__body';
    wrap.appendChild(role); wrap.appendChild(body);
    msgs.appendChild(wrap);
    return body;
  }

  function appendToolBubble(calls) {
    var msgs = byId(MESSAGES_ID); if (!msgs) return;
    var wrap = document.createElement('div');
    wrap.className = 'agent-msg agent-msg--tool card card--muted';
    var role = document.createElement('span'); role.className = 'agent-msg__role'; role.textContent = 'Tool call';
    var details = document.createElement('details');
    var summary = document.createElement('summary'); summary.textContent = 'Show tool details';
    var pre = document.createElement('pre'); pre.className = 'prompt-segment-content';
    pre.textContent = JSON.stringify(calls, null, 2);
    details.appendChild(summary); details.appendChild(pre);
    wrap.appendChild(role); wrap.appendChild(details);
    msgs.appendChild(wrap);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Pending-confirmation dialog (Plan 07 Surface 2 — APER-02)
  // ──────────────────────────────────────────────────────────────────────

  function renderPendingConfirmation(data) {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    if (dialog.open) return; // idempotent — DOM-recovery after SSE already opened
    var summary = byId(CONFIRM_SUMMARY_ID);
    var jsonPre = byId(CONFIRM_JSON_ID);
    var approveBtn = dialog.querySelector('[data-action="agentConfirmApprove"]');
    if (summary) {
      // textContent guard against XSS from server-rendered confirmationText /
      // tool args (T-32-07-02). Fallback: "<name> wants to run <toolName>."
      var text;
      if (data && typeof data.confirmationText === 'string' && data.confirmationText.length > 0) {
        text = data.confirmationText;
      } else {
        var who = (window.__luqenAgentName && typeof window.__luqenAgentName === 'string')
          ? window.__luqenAgentName : 'The assistant';
        var tool = data && data.toolName ? data.toolName : 'a tool';
        text = who + ' wants to run ' + tool + '.';
      }
      summary.textContent = text;
    }
    if (jsonPre) {
      try { jsonPre.textContent = JSON.stringify(data && data.args ? data.args : {}, null, 2); }
      catch (_e) { jsonPre.textContent = ''; }
    }
    if (approveBtn) { approveBtn.removeAttribute('disabled'); }
    if (data && data.messageId) {
      dialog.setAttribute('data-pending-message-id', String(data.messageId));
    } else {
      dialog.removeAttribute('data-pending-message-id');
    }
    dialog.removeAttribute('data-dialog-resolution');
    try { dialog.showModal(); } catch (_e) { /* already open or unsupported */ }
    setStatus('Confirmation needed. ' + (data && data.toolName ? data.toolName : 'a tool') + ' requires approval.');
  }

  function closeConfirmDialog(resolution) {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    // Mark resolution BEFORE calling close() so the 'close' handler can read it
    // and skip the auto-deny path when the user actually clicked a button.
    dialog.setAttribute('data-dialog-resolution', resolution);
    dialog.removeAttribute('data-pending-message-id');
    try { dialog.close(resolution); } catch (_e) { /* ignore */ }
  }

  function postConfirmDecision(path, messageId) {
    return fetch(path + encodeURIComponent(messageId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': getCsrfToken(), 'content-type': 'application/json' },
      body: '{}'
    });
  }

  function handleApproveClick(approveBtn) {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    var messageId = dialog.getAttribute('data-pending-message-id'); if (!messageId) return;
    // Double-fire guard (T-32-07-01): disable on first click. If the server
    // returns an error we re-enable so the user can retry.
    if (approveBtn && approveBtn.hasAttribute('disabled')) return;
    if (approveBtn) approveBtn.setAttribute('disabled', '');
    closeConfirmDialog('approved');
    postConfirmDecision('/agent/confirm/', messageId)
      .then(function (r) {
        if (r.ok || r.status === 202) {
          setStatus('Tool approved — running now.');
          // Reopen the stream so the agent loop can resume.
          openStream(getConversationId());
        } else {
          // Re-open dialog with a retry affordance.
          if (approveBtn) approveBtn.removeAttribute('disabled');
          renderApprovalError(messageId);
        }
      })
      .catch(function () {
        if (approveBtn) approveBtn.removeAttribute('disabled');
        renderApprovalError(messageId);
      });
  }

  function handleCancelClick() {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    var messageId = dialog.getAttribute('data-pending-message-id'); if (!messageId) { closeConfirmDialog('cancelled'); return; }
    closeConfirmDialog('cancelled');
    postConfirmDecision('/agent/deny/', messageId)
      .then(function () { setStatus('Tool cancelled — no changes made.'); })
      .catch(function () { setStatus('Tool cancelled — no changes made.'); });
  }

  function renderApprovalError(messageId) {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    var body = dialog.querySelector('.modal__body'); if (!body) return;
    var existing = body.querySelector('.alert--error'); if (existing) existing.parentNode.removeChild(existing);
    var alert = document.createElement('div'); alert.className = 'alert alert--error'; alert.setAttribute('role', 'alert');
    var p = document.createElement('p'); p.textContent = 'Approval failed. Please retry.'; alert.appendChild(p);
    var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn--ghost btn--sm';
    retry.setAttribute('data-action', 'agentConfirmRetry');
    retry.setAttribute('data-retry-message-id', messageId);
    retry.textContent = 'Retry';
    alert.appendChild(retry);
    body.appendChild(alert);
    // Re-open the dialog if it closed.
    if (!dialog.open) { try { dialog.showModal(); } catch (_e) { /* ignore */ } }
    dialog.setAttribute('data-pending-message-id', messageId);
  }

  // Listen for both SSE-driven and DOM-recovery-driven confirmation events.
  document.addEventListener('agent:pending-confirmation', function (e) {
    renderPendingConfirmation(e.detail || {});
  });
  document.addEventListener('agent:pending-confirmation-dom-recovery', function (e) {
    renderPendingConfirmation(e.detail || {});
  });

  // Dialog close trap — if the dialog closes without an explicit approve/cancel
  // resolution (native Esc is the main path here), treat it as deny so the
  // server-side pending row never leaks (T-32-07-07).
  function wireDialogCloseTrap() {
    var dialog = byId(DIALOG_ID); if (!dialog) return;
    if (dialog.__luqenCloseWired) return;
    dialog.__luqenCloseWired = true;
    dialog.addEventListener('close', function () {
      var resolution = dialog.getAttribute('data-dialog-resolution');
      var messageId = dialog.getAttribute('data-pending-message-id');
      if (resolution === 'approved' || resolution === 'cancelled') {
        dialog.removeAttribute('data-dialog-resolution');
        return;
      }
      // Esc path — fire the deny POST so server resolves the pending row.
      if (messageId && messageId.length > 0) {
        dialog.removeAttribute('data-pending-message-id');
        postConfirmDecision('/agent/deny/', messageId).catch(function () { /* ignore */ });
        setStatus('Tool cancelled — no changes made.');
      }
    });
  }

  function openStream(conversationId) {
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } }
    var url = '/agent/stream/' + encodeURIComponent(conversationId);
    var es = new EventSource(url, { withCredentials: true });
    activeStream = es;
    var statusEl = byId(STREAM_STATUS_ID);
    if (statusEl) statusEl.removeAttribute('hidden');

    es.addEventListener('token', function (ev) {
      try {
        var data = JSON.parse(ev.data);
        var body = ensureAssistantBubble();
        if (body && typeof data.text === 'string') body.appendChild(document.createTextNode(data.text));
      } catch (_e) { /* drop bad frame */ }
    });
    es.addEventListener('tool_calls', function (ev) {
      try { var data = JSON.parse(ev.data); appendToolBubble(data.calls || data); } catch (_e) { /* ignore */ }
    });
    es.addEventListener('pending_confirmation', function (ev) {
      try {
        var data = JSON.parse(ev.data);
        window.__agentPendingConfirmation = data;
        document.dispatchEvent(new CustomEvent('agent:pending-confirmation', { detail: data }));
      } catch (_e) { /* ignore */ }
    });
    es.addEventListener('done', function () {
      es.close(); activeStream = null;
      var msgs = byId(MESSAGES_ID);
      if (msgs) { var last = msgs.querySelector('.agent-msg--assistant[aria-busy="true"]'); if (last) last.setAttribute('aria-busy', 'false'); }
      if (statusEl) statusEl.setAttribute('hidden', '');
      setStatus('Response complete');
    });
    es.addEventListener('error', function (ev) {
      es.close(); activeStream = null;
      if (statusEl) statusEl.setAttribute('hidden', '');
      var data = null; try { if (ev && ev.data) data = JSON.parse(ev.data); } catch (_e) { data = null; }
      renderErrorCard(data && data.message ? data.message : 'Response interrupted');
    });
  }

  function renderErrorCard(message) {
    var msgs = byId(MESSAGES_ID); if (!msgs) return;
    var wrap = document.createElement('div'); wrap.className = 'alert alert--error'; wrap.setAttribute('role', 'alert');
    var p = document.createElement('p'); p.textContent = message; wrap.appendChild(p);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn--ghost btn--sm';
    btn.setAttribute('data-action', 'agentRetry'); btn.textContent = 'Retry';
    wrap.appendChild(btn); msgs.appendChild(wrap);
  }

  function renderRateLimitCard(retryMs) {
    var msgs = byId(MESSAGES_ID); if (!msgs) return;
    var wrap = document.createElement('div'); wrap.className = 'alert alert--warning'; wrap.setAttribute('role', 'alert');
    var p = document.createElement('p');
    var seconds = Math.max(1, Math.ceil(retryMs / 1000));
    p.textContent = 'Too many requests. Try again in ' + seconds + ' seconds.';
    wrap.appendChild(p); msgs.appendChild(wrap);
    var remaining = seconds;
    var timer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) { clearInterval(timer); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
      else { p.textContent = 'Too many requests. Try again in ' + remaining + ' seconds.'; }
    }, 1000);
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-action="toggleAgentDrawer"]')) { e.preventDefault(); if (isOpen()) closeDrawer(); else openDrawer(true); return; }
    if (e.target.closest('[data-action="closeAgentDrawer"]')) { e.preventDefault(); closeDrawer(); return; }
    var approveEl = e.target.closest('[data-action="agentConfirmApprove"]');
    if (approveEl) {
      e.preventDefault(); e.stopPropagation();
      handleApproveClick(approveEl);
      return;
    }
    var cancelEl = e.target.closest('[data-action="agentConfirmCancel"]');
    if (cancelEl) {
      e.preventDefault(); e.stopPropagation();
      handleCancelClick();
      return;
    }
    var retryEl = e.target.closest('[data-action="agentConfirmRetry"]');
    if (retryEl) {
      e.preventDefault(); e.stopPropagation();
      var rid = retryEl.getAttribute('data-retry-message-id');
      if (rid) {
        var dialog = byId(DIALOG_ID);
        if (dialog) dialog.setAttribute('data-pending-message-id', rid);
        var approveBtn = dialog ? dialog.querySelector('[data-action="agentConfirmApprove"]') : null;
        handleApproveClick(approveBtn);
      }
      return;
    }
    var speechEl = e.target.closest('#' + SPEECH_BTN_ID);
    if (speechEl) {
      e.preventDefault();
      if (window.__luqenAgentSpeech && typeof window.__luqenAgentSpeech.toggle === 'function') {
        window.__luqenAgentSpeech.toggle(speechEl);
      }
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      // If the confirm dialog is open, let the native <dialog> handle Esc
      // (close event trap fires deny). Otherwise close the drawer.
      var dialog = byId(DIALOG_ID);
      if (dialog && dialog.open) return;
      closeDrawer();
    }
  });

  document.body.addEventListener('htmx:afterRequest', function (e) {
    var cfg = e.detail && e.detail.requestConfig;
    if (!cfg || typeof cfg.path !== 'string') return;
    if (cfg.path.indexOf('/agent/message') !== 0) return;
    var xhr = e.detail.xhr; if (!xhr) return;
    if (xhr.status === 202) {
      var headerCid = xhr.getResponseHeader('x-conversation-id');
      if (headerCid && headerCid.length > 0) { setConversationId(headerCid); }
      var input = byId(INPUT_ID); if (input) { input.value = ''; }
      openStream(getConversationId());
    }
    else if (xhr.status === 429) {
      var retryMs = 60000;
      try { var body = JSON.parse(xhr.responseText); if (body && typeof body.retry_after_ms === 'number') retryMs = body.retry_after_ms; }
      catch (_e) { /* default */ }
      renderRateLimitCard(retryMs);
    }
  });

  // Speech wiring lives in agent-speech.js (loaded separately in main.hbs).
  // agent.js references window.__luqenAgentSpeech.toggle for the click handler;
  // navigator.language + SpeechRecognition feature-detect live in that file.
  // See also agent-speech.js for the form-hint + onresult/onerror behaviour.

  function init() {
    restoreConversationId();
    applyInitialPanelState();
    wireDialogCloseTrap();
    // Repopulate the messages region from the server window so the
    // conversation survives page reloads (not just drawer open/close state).
    if (getConversationId().length > 0) { loadPanel(); }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
