/* Phase 32 Plan 06 — agent.js
 * EventSource streaming client + localStorage drawer state + event delegation.
 * NEVER hx-sse (D-21). Plain EventSource (D-20). close() on done prevents
 * auto-reconnect (AI-SPEC §3 Pitfall 3). CSP-safe: no inline handlers, no eval.
 * XSS: tokens/tool_calls via createTextNode/textContent. loadPanel uses
 * DOMParser + importNode (not innerHTML) to adopt trusted same-origin HTML.
 */
(function () {
  'use strict';

  var LS_KEY = 'luqen.agent.panel';
  var DRAWER_ID = 'agent-drawer', BACKDROP_ID = 'agent-backdrop', LAUNCH_ID = 'agent-launch';
  var INPUT_ID = 'agent-input', FORM_ID = 'agent-form', MESSAGES_ID = 'agent-messages';
  var STATUS_ID = 'agent-aria-status', STREAM_STATUS_ID = 'agent-stream-status';
  var activeStream = null;

  function byId(id) { return document.getElementById(id); }
  function setStatus(t) { var el = byId(STATUS_ID); if (el) el.textContent = t; }
  function csrfToken() { var m = document.querySelector('meta[name="csrf-token"]'); return m ? m.getAttribute('content') : ''; }
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
    if (cid && cid.length > 0) return cid;
    var gen = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID() : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    form.setAttribute('data-conversation-id', gen);
    var hidden = byId('agent-conversation-id-field'); if (hidden) hidden.value = gen;
    return gen;
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
    var url = '/agent/panel?conversationId=' + encodeURIComponent(cid);
    fetch(url, { credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken() } })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (html.length > 0) { replaceMessagesFromHtml(html); }
        var msgs = byId(MESSAGES_ID);
        var pending = msgs ? msgs.querySelector('.agent-msg--tool[data-pending="true"]') : null;
        if (pending) {
          document.dispatchEvent(new CustomEvent('agent:pending-confirmation-dom-recovery', {
            detail: { messageId: pending.getAttribute('data-message-id') }
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
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { closeDrawer(); }
  });

  document.body.addEventListener('htmx:afterRequest', function (e) {
    var cfg = e.detail && e.detail.requestConfig;
    if (!cfg || typeof cfg.path !== 'string') return;
    if (cfg.path.indexOf('/agent/message') !== 0) return;
    var xhr = e.detail.xhr; if (!xhr) return;
    if (xhr.status === 202) { openStream(getConversationId()); }
    else if (xhr.status === 429) {
      var retryMs = 60000;
      try { var body = JSON.parse(xhr.responseText); if (body && typeof body.retry_after_ms === 'number') retryMs = body.retry_after_ms; }
      catch (_e) { /* default */ }
      renderRateLimitCard(retryMs);
    }
  });

  function initSpeech() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = byId('agent-speech'); if (!btn) return;
    if (!SR) { btn.setAttribute('hidden', ''); return; }
    btn.removeAttribute('hidden');
  }

  function init() { applyInitialPanelState(); initSpeech(); }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
