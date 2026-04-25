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

  // ──────────────────────────────────────────────────────────────────────
  // Phase 37 Plan 04 — per-message action primitives.
  //
  // markdownSourceById captures raw assistant markdown so the copy action
  // can read it without round-tripping the server. The streaming handler
  // populates the entry on the `done` frame; the rehydration path
  // (loadPanel → replaceMessagesFromHtml) leaves the map untouched and
  // copyAssistant falls back to GET /agent/conversations/:cid/messages/:mid
  // when there's no entry.
  //
  // writeToClipboard prefers navigator.clipboard.writeText (secure context)
  // and falls back to a hidden <textarea> + execCommand('copy').
  //
  // announce() routes status text to a single hidden #agent-aria-live
  // region (role="status" aria-live="polite"). The clear-then-set pattern
  // forces SR re-announcement when the same string is announced twice.
  // ──────────────────────────────────────────────────────────────────────

  var ARIA_LIVE_ID = 'agent-aria-live';
  var markdownSourceById = Object.create(null);
  var streamingMessageId = null; // current in-flight assistant message id, if known

  function recordMarkdownSource(messageId, text) {
    if (typeof messageId !== 'string' || messageId.length === 0) return;
    markdownSourceById[messageId] = String(text == null ? '' : text);
  }
  function readMarkdownSource(messageId) {
    if (typeof messageId !== 'string' || messageId.length === 0) return undefined;
    return markdownSourceById[messageId];
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

  function writeToClipboard(text) {
    var s = String(text == null ? '' : text);
    var primary = (function () {
      try {
        if (window.isSecureContext && window.navigator && window.navigator.clipboard
            && typeof window.navigator.clipboard.writeText === 'function') {
          return window.navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; });
        }
      } catch (_e) { /* fall through */ }
      return Promise.resolve(false);
    })();
    return primary.then(function (ok) {
      if (ok) return true;
      // Fallback: hidden textarea + execCommand('copy')
      var ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      try { ta.select(); } catch (_e) { /* ignore */ }
      var ok2 = false;
      try { ok2 = !!document.execCommand('copy'); } catch (_e) { ok2 = false; }
      try { document.body.removeChild(ta); } catch (_e) { /* ignore */ }
      return ok2;
    });
  }

  function ensureAriaLive() {
    var el = document.getElementById(ARIA_LIVE_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ARIA_LIVE_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'sr-only';
    var drawer = document.getElementById(DRAWER_ID) || document.body;
    drawer.appendChild(el);
    return el;
  }

  function announce(message) {
    var msg = String(message == null ? '' : message);
    var el = ensureAriaLive();
    if (el) {
      el.textContent = '';
      setTimeout(function () { el.textContent = msg; }, 10);
    }
  }

  // Visible feedback for copy/share: temporarily replace the icon with a
  // check or cross glyph for ~1.5s, then restore the original SVG. Avoids
  // toasts and innerHTML — clones the original child node and swaps it back.
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

  // i18n lookup for action strings: reuses the agent-tools-i18n JSON-script-block.
  // The block stores nested keys like "actions.copied". Falls back to the key
  // string itself when the dictionary is absent (matches Phase 36-04 pattern).
  function actionT(key) {
    try {
      var dict = readToolI18n();
      if (dict && typeof dict[key] === 'string' && dict[key].length > 0) return dict[key];
    } catch (_e) { /* ignore */ }
    return key;
  }

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

  var mermaidInitialised = false;
  function ensureMermaidInit() {
    if (mermaidInitialised) return;
    if (!window.mermaid || typeof window.mermaid.initialize !== 'function') return;
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      mermaidInitialised = true;
    } catch (_e) { /* leave flag false — retry on next render */ }
  }

  function renderMermaidBlocks(root) {
    if (!window.mermaid || typeof window.mermaid.render !== 'function') return;
    ensureMermaidInit();
    var blocks = root.querySelectorAll('code.language-mermaid, pre > code.language-mermaid');
    for (var i = 0; i < blocks.length; i++) {
      var code = blocks[i];
      var pre = code.parentNode && code.parentNode.tagName === 'PRE' ? code.parentNode : null;
      var host = pre || code;
      var source = code.textContent || '';
      var container = document.createElement('div');
      container.className = 'agent-mermaid';
      host.parentNode.replaceChild(container, host);
      var id = 'mermaid-' + Date.now() + '-' + i;
      (function (c, src, svgId) {
        window.mermaid.render(svgId, src).then(function (out) {
          while (c.firstChild) c.removeChild(c.firstChild);
          // Import mermaid's own-renderer SVG via DOMParser — keeps the
          // no-innerHTML-on-live-node invariant.
          var doc = new DOMParser().parseFromString(out.svg, 'image/svg+xml');
          var svg = doc.documentElement;
          if (svg && svg.tagName && svg.tagName.toLowerCase() === 'svg') {
            c.appendChild(document.importNode(svg, true));
          } else {
            c.textContent = src;
          }
        }).catch(function (err) {
          c.textContent = 'Mermaid render error: ' + (err && err.message ? err.message : 'unknown');
        });
      })(container, source, id);
    }
  }

  /**
   * Primary markdown renderer — uses vendored `marked` for full CommonMark
   * + GFM coverage and DOMPurify to strip any disallowed tags / attrs. Falls
   * back to the hand-rolled subset renderer below if either library is absent.
   *
   * DOMPurify config allows common text + block elements + GFM tables + safe
   * image/link attrs (http/https/mailto). All dangerous protocols (javascript:,
   * data:image/svg+xml+script, file:) are stripped. target="_blank" gets
   * rel="noopener" automatically.
   */
  function renderMarkdownPrimary(target, text) {
    if (typeof window === 'undefined') return false;
    var marked = window.marked;
    var DOMPurify = window.DOMPurify;
    if (!marked || !DOMPurify) return false;
    try {
      if (typeof marked.setOptions === 'function') {
        marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
      }
      var render = typeof marked.parse === 'function' ? marked.parse : marked;
      var rawHtml = render(text);
      var cleanHtml = DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        ADD_TAGS: ['mermaid'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/(?:png|jpeg|gif|webp|svg\+xml)):|[^:]*$)/i,
      });
      // Parse via DOMParser so we don't use innerHTML with untrusted input
      // directly on a live node — even though sanitize already cleaned it,
      // this adds defence-in-depth against CSP / future regressions.
      var doc = new DOMParser().parseFromString('<div>' + cleanHtml + '</div>', 'text/html');
      var src = doc.body.firstChild;
      while (target.firstChild) target.removeChild(target.firstChild);
      if (src) {
        while (src.firstChild) {
          target.appendChild(document.importNode(src.firstChild, true));
          src.removeChild(src.firstChild);
        }
      }
      // Anchors: force safe rel on target=_blank.
      var anchors = target.querySelectorAll('a[target="_blank"]');
      for (var ai = 0; ai < anchors.length; ai++) {
        anchors[ai].setAttribute('rel', 'noopener noreferrer');
      }
      // Mermaid diagrams: render any <code class="language-mermaid"> block.
      renderMermaidBlocks(target);
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Fallback renderer (subset) — used only when marked / DOMPurify fail to
   * load. Supports bold/italic/code/lists/paragraphs.
   */
  function renderInlineMd(target, text) {
    var i = 0; var len = text.length;
    function pushText(s) { if (s.length > 0) target.appendChild(document.createTextNode(s)); }
    while (i < len) {
      var ch = text[i];
      // **bold** / __bold__
      if ((ch === '*' && text[i + 1] === '*') || (ch === '_' && text[i + 1] === '_')) {
        var delim2 = ch + ch;
        var end2 = text.indexOf(delim2, i + 2);
        if (end2 > i + 2) {
          var s = document.createElement('strong');
          renderInlineMd(s, text.slice(i + 2, end2));
          target.appendChild(s);
          i = end2 + 2;
          continue;
        }
      }
      // *italic* / _italic_
      if ((ch === '*' || ch === '_') && text[i + 1] !== ch) {
        var end1 = text.indexOf(ch, i + 1);
        if (end1 > i + 1 && text[end1 - 1] !== ' ') {
          var em = document.createElement('em');
          renderInlineMd(em, text.slice(i + 1, end1));
          target.appendChild(em);
          i = end1 + 1;
          continue;
        }
      }
      // `code`
      if (ch === '`') {
        var endc = text.indexOf('`', i + 1);
        if (endc > i + 1) {
          var c = document.createElement('code');
          c.textContent = text.slice(i + 1, endc);
          target.appendChild(c);
          i = endc + 1;
          continue;
        }
      }
      // literal char: accumulate until next marker
      var next = len;
      for (var j = i; j < len; j++) {
        var cj = text[j];
        if (cj === '*' || cj === '_' || cj === '`') { next = j; break; }
      }
      pushText(text.slice(i, next));
      i = next;
    }
  }

  function splitTableRow(line) {
    var trimmed = line.replace(/^\||\|$/g, '');
    return trimmed.split('|').map(function (c) { return c.trim(); });
  }

  function renderTable(target, lines) {
    // lines = [header, separator, ...rows]
    var table = document.createElement('table');
    table.className = 'agent-md-table';
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var headers = splitTableRow(lines[0]);
    for (var hi = 0; hi < headers.length; hi++) {
      var th = document.createElement('th');
      renderInlineMd(th, headers[hi]);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    for (var ri = 2; ri < lines.length; ri++) {
      var cells = splitTableRow(lines[ri]);
      var tr = document.createElement('tr');
      for (var ci = 0; ci < cells.length; ci++) {
        var td = document.createElement('td');
        renderInlineMd(td, cells[ci]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    target.appendChild(table);
  }

  function renderMarkdownInto(target, text) {
    if (!text || text.length === 0) {
      while (target.firstChild) { target.removeChild(target.firstChild); }
      return;
    }
    if (renderMarkdownPrimary(target, text)) return;
    while (target.firstChild) { target.removeChild(target.firstChild); }
    var blocks = text.split(/\n{2,}/);
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      if (block.length === 0) continue;
      var lines = block.split('\n');
      // Markdown table: header row contains '|', second row is the separator
      // (all dashes/colons/spaces/pipes).
      if (lines.length >= 2 && lines[0].indexOf('|') !== -1 && /^[\s:|-]+$/.test(lines[1]) && lines[1].indexOf('-') !== -1) {
        renderTable(target, lines);
        continue;
      }
      // ATX heading: "# ", "## ", "### "… up to level 6
      var headingMatch = lines[0].match(/^(#{1,6})\s+(.+)$/);
      if (lines.length === 1 && headingMatch) {
        var level = headingMatch[1].length;
        var h = document.createElement('h' + Math.min(level + 2, 6));
        renderInlineMd(h, headingMatch[2]);
        target.appendChild(h);
        continue;
      }
      // Unordered list: every line starts with "- " or "* "
      var isUl = lines.every(function (l) { return /^[-*]\s+/.test(l); });
      var isOl = !isUl && lines.every(function (l) { return /^\d+\.\s+/.test(l); });
      if (isUl || isOl) {
        var list = document.createElement(isUl ? 'ul' : 'ol');
        for (var k = 0; k < lines.length; k++) {
          var item = document.createElement('li');
          var content = lines[k].replace(/^(?:[-*]|\d+\.)\s+/, '');
          renderInlineMd(item, content);
          list.appendChild(item);
        }
        target.appendChild(list);
        continue;
      }
      // Paragraph — preserve single newlines as <br>. Lines inside a single
      // block may individually match a heading marker; render those inline
      // as headings too so mixed blocks (heading + description) don't drop
      // the heading.
      var p = document.createElement('p');
      for (var m = 0; m < lines.length; m++) {
        var hm = lines[m].match(/^(#{1,6})\s+(.+)$/);
        if (hm) {
          if (p.firstChild) { target.appendChild(p); p = document.createElement('p'); }
          var h2 = document.createElement('h' + Math.min(hm[1].length + 2, 6));
          renderInlineMd(h2, hm[2]);
          target.appendChild(h2);
          continue;
        }
        if (p.firstChild) p.appendChild(document.createElement('br'));
        renderInlineMd(p, lines[m]);
      }
      if (p.firstChild) target.appendChild(p);
    }
  }

  function startNewConversation() {
    try { localStorage.removeItem(LS_CONV_KEY); } catch (_e) { /* ignore */ }
    var form = byId(FORM_ID);
    if (form) { form.setAttribute('data-conversation-id', ''); }
    var hidden = byId('agent-conversation-id-field');
    if (hidden) { hidden.value = ''; }
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } activeStream = null; }
    var msgs = byId(MESSAGES_ID);
    if (msgs) { while (msgs.firstChild) { msgs.removeChild(msgs.firstChild); } }
    var input = byId(INPUT_ID); if (input) { input.value = ''; input.focus(); }
    setStatus('');
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
    // Rehydrated assistant bubbles carry raw markdown in textContent (the
    // server partial escapes via {{content}}). Re-run the same sanitize +
    // markdown pass the streaming path uses on 'done' so table / chart /
    // list output looks identical after a page reload.
    var bubbles = msgs.querySelectorAll('.agent-msg--assistant');
    for (var i = 0; i < bubbles.length; i++) {
      var bubble = bubbles[i];
      var body = bubble.querySelector('.agent-msg__body');
      if (!body) continue;
      var rawText = body.textContent || '';
      // Seed the markdown cache BEFORE rendering so copy is synchronous
      // (user-gesture context preserved). Without this, copy must fetch
      // and the async work breaks navigator.clipboard.writeText silently.
      var bid = bubble.getAttribute('data-message-id');
      if (bid && rawText.length > 0) recordMarkdownSource(bid, rawText);
      if (rawText.length > 0) renderMarkdownInto(body, rawText);
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

  // ──────────────────────────────────────────────────────────────────────
  // Phase 36-04 — tool chip strip (ATOOL-01 / ATOOL-03)
  // CSP-strict: no inline handlers, no innerHTML for tool data. Strings
  // come from #agent-tools-i18n JSON-script-block (no in-page t() helper
  // exists in agent.js — see Phase 35-05 SUMMARY).
  // ──────────────────────────────────────────────────────────────────────

  var TOOL_CHIPS_ID = 'agent-tool-chips';
  var TOOL_I18N_ID = 'agent-tools-i18n';
  var toolI18nCache = null;

  function readToolI18n() {
    if (toolI18nCache) return toolI18nCache;
    var node = byId(TOOL_I18N_ID);
    if (!node || !node.textContent) {
      toolI18nCache = {};
      return toolI18nCache;
    }
    try { toolI18nCache = JSON.parse(node.textContent); }
    catch (_e) { toolI18nCache = {}; }
    return toolI18nCache;
  }

  function formatToolI18n(key, params) {
    var dict = readToolI18n();
    var raw = (dict && typeof dict[key] === 'string') ? dict[key] : '';
    if (!raw) return '';
    if (!params) return raw;
    if (typeof params.name === 'string') {
      raw = raw.split('__NAME__').join(params.name);
    }
    if (typeof params.error === 'string') {
      raw = raw.split('__ERROR__').join(params.error);
    }
    return raw;
  }

  function toolChipsEl() { return byId(TOOL_CHIPS_ID); }

  function clearToolChips() {
    var strip = toolChipsEl();
    if (!strip) return;
    while (strip.firstChild) strip.removeChild(strip.firstChild);
  }

  function escapeAttrSelector(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function makeToolChip(toolCallId, toolName) {
    var chip = document.createElement('span');
    chip.className = 'agent-drawer__tool-chip agent-drawer__tool-chip--running';
    chip.setAttribute('data-tool-call-id', toolCallId);
    chip.setAttribute('role', 'status');
    var icon = document.createElement('span');
    icon.className = 'agent-drawer__tool-chip-icon';
    icon.setAttribute('aria-hidden', 'true');
    chip.appendChild(icon);
    var label = document.createElement('span');
    label.className = 'agent-drawer__tool-chip-label';
    label.textContent = toolName;
    chip.appendChild(label);
    return chip;
  }

  function handleToolStarted(data) {
    if (typeof data.toolCallId !== 'string' || typeof data.toolName !== 'string') return;
    var strip = toolChipsEl(); if (!strip) return;
    var existing = strip.querySelector('[data-tool-call-id="' + escapeAttrSelector(data.toolCallId) + '"]');
    if (existing) return; // dedupe race
    var chip = makeToolChip(data.toolCallId, data.toolName);
    chip.setAttribute('aria-label', formatToolI18n('chip.runningAria', { name: data.toolName }));
    strip.appendChild(chip);
  }

  function handleToolCompleted(data) {
    if (typeof data.toolCallId !== 'string' || typeof data.toolName !== 'string') return;
    var strip = toolChipsEl(); if (!strip) return;
    if (data.toolCallId === '__loop__') {
      var capChip = document.createElement('span');
      capChip.className = 'agent-drawer__tool-chip agent-drawer__tool-chip--cap';
      capChip.setAttribute('role', 'status');
      capChip.textContent = formatToolI18n('cap.label');
      capChip.setAttribute('aria-label', formatToolI18n('cap.aria'));
      strip.appendChild(capChip);
      return;
    }
    var chip = strip.querySelector('[data-tool-call-id="' + escapeAttrSelector(data.toolCallId) + '"]');
    if (!chip) return;
    chip.classList.remove('agent-drawer__tool-chip--running');
    if (data.status === 'success') {
      chip.classList.add('agent-drawer__tool-chip--success');
      chip.setAttribute('aria-label', formatToolI18n('chip.successAria', { name: data.toolName }));
    } else {
      chip.classList.add('agent-drawer__tool-chip--error');
      var errMsg = (typeof data.errorMessage === 'string') ? data.errorMessage : '';
      chip.setAttribute('aria-label', formatToolI18n('chip.errorAria', { name: data.toolName, error: errMsg }));
      if (errMsg) {
        var lbl = chip.querySelector('.agent-drawer__tool-chip-label');
        if (lbl) lbl.textContent = data.toolName + ': ' + errMsg;
      }
    }
  }

  function openStream(conversationId) {
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } }
    var url = '/agent/stream/' + encodeURIComponent(conversationId);
    var es = new EventSource(url, { withCredentials: true });
    activeStream = es;
    var statusEl = byId(STREAM_STATUS_ID);
    if (statusEl) statusEl.removeAttribute('hidden');

    es.addEventListener('tool_started', function (ev) {
      try { handleToolStarted(JSON.parse(ev.data)); } catch (_e) { /* ignore malformed */ }
    });
    es.addEventListener('tool_completed', function (ev) {
      try { handleToolCompleted(JSON.parse(ev.data)); } catch (_e) { /* ignore malformed */ }
    });

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
      // Clear tool-progress chips on stream completion. Chips are transient progress
      // indicators — once the assistant turn settles, the assistant text already
      // describes what tools did, so leaving chips on screen is clutter (per UAT
      // feedback 2026-04-25).
      clearToolChips();
      var msgs = byId(MESSAGES_ID);
      if (msgs) {
        var last = msgs.querySelector('.agent-msg--assistant[aria-busy="true"]');
        if (last) {
          last.setAttribute('aria-busy', 'false');
          // Plan 32.1-06: safe markdown render on stream completion. The
          // streaming path appends plain text via createTextNode; on done
          // we re-parse the accumulated text and rebuild the bubble body
          // with strong / em / list / paragraph nodes. No innerHTML — all
          // user-visible text still enters via textContent, so the escape
          // properties of the token path are preserved.
          var body = last.querySelector('.agent-msg__body');
          if (body) {
            var rawText = body.textContent || '';
            // Phase 37-04: capture raw markdown for the copy action BEFORE
            // we rebuild the body with HTML nodes. The bubble may not yet
            // carry data-message-id (the streaming path doesn't have it),
            // so we also stash under a sentinel keyed by streamingMessageId
            // when available.
            var lastMid = last.getAttribute('data-message-id');
            if (lastMid && lastMid.length > 0) recordMarkdownSource(lastMid, rawText);
            else if (streamingMessageId) recordMarkdownSource(streamingMessageId, rawText);
            renderMarkdownInto(body, rawText);
          }
        }
      }
      streamingMessageId = null;
      if (statusEl) statusEl.setAttribute('hidden', '');
      setStatus('Response complete');
      // Phase 37-04 fix: streamed bubbles built by ensureAssistantBubble carry no
      // data-message-id and no action toolbar — copy/share/retry have nothing to
      // click. Refetch the panel from the server which renders every row with a
      // data-message-id and the agent-msg-actions partial. Same text, adds the
      // IDs + buttons.
      loadPanel();
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
  var historyCachedPage = null; // cached un-filtered page 1 rows for clear-search restore
  var historyActiveMenu = null; // { trigger, menuEl }
  var historyActiveRename = null; // { liEl, originalChildren[], id }
  var historyActiveDelete = null; // { liEl, originalChildren[], id }

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

  function renderHistoryItem(item, query) {
    var li = document.createElement('li');
    li.className = 'agent-drawer__history-item';
    li.setAttribute('data-conversation-id', String(item.id || ''));
    // Do NOT set role="button" here: axe's nested-interactive rule (WCAG
    // 4.1.2) flags role=button containers that wrap another focusable
    // element (the kebab menu trigger inside). Instead we keep <li> as a
    // non-interactive list item, rely on tabindex for the roving focus
    // pattern, and expose the accessible name via aria-label so screen
    // readers announce "Resume <title>" when the row receives focus.
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
      list.appendChild(renderHistoryItem(items[i], query));
    }
  }

  function appendItems(items, query) {
    var list = historyListEl(); if (!list) return;
    for (var i = 0; i < items.length; i++) {
      list.appendChild(renderHistoryItem(items[i], query));
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
      // restore cached page 1
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
    // Show/hide clear button
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
    // UI-SPEC §Keyboard & Screen-Reader Contract: when the menu opens,
    // focus must move INTO the menu so screen-reader users can operate
    // the menuitems. First menuitem (Rename) is the safe default.
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
    var titleNode = original[0]; // title div
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
        // Restore original row with updated title
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
        // Remove the row
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

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-action="toggleAgentDrawer"]')) { e.preventDefault(); if (isOpen()) closeDrawer(); else openDrawer(true); return; }
    if (e.target.closest('[data-action="closeAgentDrawer"]')) { e.preventDefault(); closeDrawer(); return; }
    if (e.target.closest('[data-action="newChat"]')) { e.preventDefault(); startNewConversation(); return; }
    if (e.target.closest('[data-action="openAgentHistory"]')) { e.preventDefault(); openHistoryPanel(); return; }
    if (e.target.closest('[data-action="closeAgentHistory"]')) { e.preventDefault(); closeHistoryPanel(); return; }
    if (e.target.closest('[data-action="clearAgentHistorySearch"]')) { e.preventDefault(); clearHistorySearch(); return; }
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
      if (cid) resumeConversation(cid);
      return;
    }
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

    // ── Phase 37 Plan 04 — per-message action delegated handlers ────────
    if (e.target.id === 'agent-stop' || e.target.closest('#agent-stop')) {
      e.preventDefault();
      handleStopClick();
      return;
    }
    var retryAssistantEl = e.target.closest('[data-action="retryAssistant"]');
    if (retryAssistantEl) {
      e.preventDefault();
      handleRetryAssistantClick(retryAssistantEl);
      return;
    }
    var copyAssistantEl = e.target.closest('[data-action="copyAssistant"]');
    if (copyAssistantEl) {
      e.preventDefault();
      handleCopyAssistantClick(copyAssistantEl);
      return;
    }
    var shareAssistantEl = e.target.closest('[data-action="shareAssistant"]');
    if (shareAssistantEl) {
      e.preventDefault();
      handleShareAssistantClick(shareAssistantEl);
      return;
    }
    var editUserEl = e.target.closest('[data-action="editUserMessage"]');
    if (editUserEl) {
      e.preventDefault();
      handleEditUserMessageClick(editUserEl);
      return;
    }
    var cancelEditEl = e.target.closest('[data-action="cancelEditUserMessage"]');
    if (cancelEditEl) {
      e.preventDefault();
      handleCancelEditUserMessageClick(cancelEditEl);
      return;
    }
  });

  // Delegated submit listener for the inline edit form (Phase 37 Plan 04 Task 3).
  document.addEventListener('submit', function (e) {
    if (!e.target || !e.target.closest) return;
    var form = e.target.closest('form[data-action="submitEditUserMessage"]');
    if (!form) return;
    e.preventDefault();
    handleSubmitEditUserMessage(form);
  });

  // ── Phase 37 Plan 04 — handler implementations ────────────────────────

  function handleStopClick() {
    if (activeStream) {
      try { activeStream.close(); } catch (_e) { /* ignore */ }
      activeStream = null;
    }
    var statusEl = byId(STREAM_STATUS_ID);
    if (statusEl) statusEl.setAttribute('hidden', '');
    announce(actionT('actions.stopped'));
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
    var url = '/agent/conversations/' + encodeURIComponent(cid)
      + '/messages/' + encodeURIComponent(mid) + '/share';
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('share_failed')); })
      .then(function (payload) {
        var path = payload && typeof payload.url === 'string' ? payload.url : '';
        var fullUrl = window.location.origin + path;
        // Render the URL inline next to the share button so the user can
        // select+copy or click it. Clipboard automation after async fetch is
        // unreliable across browsers (loses the user-gesture context), so we
        // don't rely on it — the user always has a visible, clickable link.
        renderShareUrlChip(btn, fullUrl);
        flashActionResult(btn, true);
        announce(actionT('actions.shareCreated'));
      })
      .catch(function () {
        flashActionResult(btn, false);
        announce(actionT('actions.shareFailed'));
      })
      .then(function () { btn.disabled = false; });
  }

  // Render a small inline chip with the share URL near the share button.
  // The chip contains an <a> with the URL as both href and visible text;
  // user can click it (opens in new tab) or right-click → "Copy link address".
  function renderShareUrlChip(shareBtn, url) {
    if (!shareBtn || !url) return;
    var actions = shareBtn.parentNode;
    if (!actions) return;
    var existing = actions.querySelector('.agent-msg__share-link');
    if (existing) existing.parentNode.removeChild(existing);
    var link = document.createElement('a');
    link.className = 'agent-msg__share-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = url;
    actions.appendChild(link);
  }

  // Edit/cancel/submit support — captures the original body text so cancel
  // can restore it without a server round-trip.
  var activeEdit = null; // { messageId, originalChildren: Node[] }

  function handleEditUserMessageClick(btn) {
    var mid = btn.getAttribute('data-message-id');
    var cid = getConversationId();
    if (!mid || !cid) return;
    var bubble = btn.closest('.agent-msg');
    if (!bubble) return;
    var body = bubble.querySelector('.agent-msg__body');
    if (!body) return;
    // Snapshot the original body children so cancel can restore them.
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
        // Replace body content with parsed form (DOMParser is CSP-safe;
        // server-rendered partial is escaped via Handlebars {{content}}).
        while (body.firstChild) body.removeChild(body.firstChild);
        var parsed = new DOMParser().parseFromString(
          '<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html');
        var src = parsed.body;
        while (src.firstChild) {
          body.appendChild(document.importNode(src.firstChild, true));
          src.removeChild(src.firstChild);
        }
        // Hide the action row while editing (avoid re-clicking the pencil).
        var actions = bubble.querySelector('.agent-msg__actions');
        if (actions) actions.setAttribute('hidden', '');
        var ta = body.querySelector('textarea');
        if (ta) {
          try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
          catch (_e) { /* ignore */ }
        }
      })
      .catch(function () {
        // Restore body and emit announcement.
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
        // Clear the active-edit snapshot — we don't restore on success.
        activeEdit = null;
        // Re-fetch the panel so the supersede + new user message render
        // is canonical, then open the stream for the new assistant turn.
        loadPanel();
        clearToolChips();
        openStream(cid);
      })
      .catch(function () {
        if (saveBtn) saveBtn.disabled = false;
        announce(actionT('actions.editFailed'));
      });
  }

  document.addEventListener('keydown', function (e) {
    // History-panel keyboard contract (UI-SPEC §Keyboard & Screen-Reader).
    if (historyIsPanelOpen()) {
      // Rename submit via Enter on input.
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
      // Roving focus.
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
            // toggleItemMenu() moves focus into the menu's first menuitem
            // (UI-SPEC keyboard contract) — do not refocus the kebab trigger.
            toggleItemMenu(activeItem);
            return;
          }
        }
      }
    }
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
      // Phase 36-04: clear previous turn's tool chips before opening the new stream.
      clearToolChips();
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
    wireDisplayNameUpdates();
    ensureAriaLive();
    wireInputAutoResize();
    // Repopulate the messages region from the server window so the
    // conversation survives page reloads (not just drawer open/close state).
    if (getConversationId().length > 0) { loadPanel(); }
  }

  // Phase 37 — auto-grow the composer textarea as the user types. Capped by the
  // CSS max-height (160px) so the drawer's message area is preserved.
  function wireInputAutoResize() {
    var input = byId(INPUT_ID);
    if (!input) return;
    function resize() {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    input.addEventListener('input', resize);
    // Also resize after submit (when value clears) and on initial focus.
    var form = byId(FORM_ID);
    if (form) form.addEventListener('htmx:afterRequest', function () { resize(); });
    resize();
  }

  // Phase 37 Plan 04 — test-export shim (dead code in production).
  // Tests opt in by setting window.__agentTestMode = true BEFORE loading
  // agent.js. The shim exposes the helpers the JSDOM test harness needs.
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    window.__agentTestExports = {
      writeToClipboard: writeToClipboard,
      announce: announce,
      getMarkdownSource: getMarkdownSource,
      recordMarkdownSource: recordMarkdownSource,
      readMarkdownSource: readMarkdownSource,
    };
  }

  function wireDisplayNameUpdates() {
    // Phase 32.1-04: org-settings POST responds with HX-Trigger so the
    // drawer header updates in-place when an admin saves a new display
    // name. HTMX dispatches a CustomEvent on the body.
    document.body.addEventListener('agent-display-name-updated', function (e) {
      var detail = (e && e.detail) ? e.detail : {};
      var name = detail && typeof detail.name === 'string' ? detail.name : '';
      if (name.length === 0) return;
      var el = byId('agent-display-name');
      if (el) { el.textContent = name; }
    });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
