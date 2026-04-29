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
  // SECURITY (agent-conversation-leak-cross-user): stamp the user-id under
  // which LS_CONV_KEY was written so that on a subsequent login by a
  // different user on the same browser we can detect the identity boundary
  // and wipe the stale conversationId BEFORE the auto-mount path fetches
  // /agent/panel. Without this, a previous user's open conversation in
  // localStorage is replayed to the new user and — combined with the
  // server's org-scoped (not user-scoped) panel lookup — surfaces the
  // foreign chat. The stamp + eviction is a defence-in-depth complement
  // to the server-side userId guard.
  var LS_USER_KEY = 'luqen.agent.userId';
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

  // getMarkdownSource extracted to agent-actions.js (39.1-02). The cache map
  // (markdownSourceById) lives here because the streaming `done` handler
  // populates it; agent-actions.js reads it via __luqenAgent.readMarkdownSource.

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

  // flashActionResult + actionT extracted to agent-actions.js (39.1-02).
  // agent.js's own announce() routes through __luqenAgent for tests.

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

  function getCurrentUserId() {
    var form = byId(FORM_ID);
    if (!form) return '';
    var uid = form.getAttribute('data-user-id');
    return typeof uid === 'string' ? uid : '';
  }

  function setConversationId(cid) {
    if (!cid || cid.length === 0) return;
    var form = byId(FORM_ID); if (form) form.setAttribute('data-conversation-id', cid);
    var hidden = byId('agent-conversation-id-field'); if (hidden) hidden.value = cid;
    try {
      localStorage.setItem(LS_CONV_KEY, cid);
      // Bind the stored cid to the current user-id so a later login as a
      // different user can detect and wipe (see evictForeignAgentState).
      var uid = getCurrentUserId();
      if (uid.length > 0) localStorage.setItem(LS_USER_KEY, uid);
    } catch (_e) { /* ignore */ }
  }

  // SECURITY (agent-conversation-leak-cross-user): if the localStorage user
  // stamp does not match the currently-rendered user, drop ALL agent-*
  // localStorage entries before any restore/auto-mount runs. The previous
  // user's conversationId must never be offered to the server as if it were
  // ours. Called once at init, before restoreConversationId.
  function evictForeignAgentState() {
    try {
      var current = getCurrentUserId();
      if (current.length === 0) return; // unauthenticated render — nothing to do
      var stamped = localStorage.getItem(LS_USER_KEY);
      if (stamped !== null && stamped.length > 0 && stamped !== current) {
        localStorage.removeItem(LS_CONV_KEY);
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_USER_KEY);
      }
      // Also handle the legacy case where LS_CONV_KEY exists without a
      // stamp (versions before this fix). Treat as foreign — drop it.
      if ((stamped === null || stamped.length === 0) && localStorage.getItem(LS_CONV_KEY) !== null) {
        localStorage.removeItem(LS_CONV_KEY);
        localStorage.removeItem(LS_KEY);
      }
      // Refresh the stamp to the current user so subsequent setConversationId
      // calls can rely on it.
      localStorage.setItem(LS_USER_KEY, current);
    } catch (_e) { /* ignore */ }
  }

  function restoreConversationId() {
    try {
      var cid = localStorage.getItem(LS_CONV_KEY);
      if (cid && cid.length > 0) { setConversationId(cid); }
    } catch (_e) { /* ignore */ }
  }

  var mermaidInitialisedTheme = '';
  function currentMermaidTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' ? 'dark' : 'default';
  }
  function ensureMermaidInit() {
    if (!window.mermaid || typeof window.mermaid.initialize !== 'function') return;
    var theme = currentMermaidTheme();
    if (mermaidInitialisedTheme === theme) return;
    try {
      // Mermaid renders pie, flowchart, sequence, gantt, class, state, ER,
      // xychart, etc. — each consults a different subset of theme variables.
      // We pin a single semantic palette across all of them so the agent's
      // diagrams read consistently and match the dashboard's design tokens
      // (luqen accent = green; severity colours = red/amber/blue).
      // ONE consistent series palette used in both themes — only bg, text,
      // and border tokens swap based on data-theme. Tailwind 500-level
      // mid-tones give acceptable contrast on both white and dark navy.
      var SERIES = {
        series1: '#ef4444',  // red — Errors
        series2: '#f59e0b',  // amber — Warnings
        series3: '#3b82f6',  // blue — Notices
        series4: '#8b5cf6',  // purple
        series5: '#10b981',  // teal
        series6: '#ec4899',  // pink
      };
      var isDark = theme === 'dark';
      var p = isDark
        ? {
            // Dashboard dark tokens (style.css [data-theme="dark"])
            bg: '#1f2937',
            bg2: '#111827',
            bg3: '#374151',
            text: '#f3f4f6',
            textMuted: '#94a3b8',
            border: '#4b5563',
            accent: '#4ade80',          // luqen green (dark)
            accentText: '#0b1220',
          }
        : {
            // Dashboard light tokens
            bg: '#ffffff',
            bg2: '#fafafa',
            bg3: '#f8f9fa',
            text: '#111827',
            textMuted: '#64748b',
            border: '#e5e7eb',
            accent: '#15803d',          // luqen green (light)
            accentText: '#ffffff',
          };
      // Slice/series colours are mid-tones, so white text reads well inside
      // them in either theme.
      var slotText = '#ffffff';
      var themeVariables = {
        // Core (cascades through flowchart, sequence, class, state, ER,
        // mindmap, etc. as the "primary" colour family)
        primaryColor: p.accent,
        primaryTextColor: p.accentText,
        primaryBorderColor: p.border,
        secondaryColor: p.bg3,
        secondaryTextColor: p.text,
        secondaryBorderColor: p.border,
        tertiaryColor: p.bg2,
        tertiaryTextColor: p.text,
        tertiaryBorderColor: p.border,
        lineColor: p.textMuted,
        textColor: p.text,
        background: p.bg,
        mainBkg: p.accent,
        secondBkg: p.bg3,
        tertiaryBkg: p.bg2,
        // Notes (sequence + flow comments)
        noteBkgColor: p.bg3,
        noteTextColor: p.text,
        noteBorderColor: p.border,
        // Sequence diagrams
        actorBkg: p.accent,
        actorBorder: p.border,
        actorTextColor: p.accentText,
        actorLineColor: p.textMuted,
        signalColor: p.text,
        signalTextColor: p.text,
        labelBoxBkgColor: p.bg3,
        labelBoxBorderColor: p.border,
        labelTextColor: p.text,
        loopTextColor: p.text,
        activationBkgColor: p.bg3,
        activationBorderColor: p.border,
        // Flowchart node defaults
        nodeBkg: p.accent,
        nodeBorder: p.border,
        nodeTextColor: p.accentText,
        clusterBkg: p.bg3,
        clusterBorder: p.border,
        edgeLabelBackground: p.bg2,
        // Pie — ordered to match the agent's typical severity layout
        pie1: SERIES.series1,
        pie2: SERIES.series2,
        pie3: SERIES.series3,
        pie4: SERIES.series4,
        pie5: SERIES.series5,
        pie6: SERIES.series6,
        pieTitleTextColor: p.text,
        pieSectionTextColor: slotText,
        pieLegendTextColor: p.text,
        pieStrokeColor: p.bg,
        pieOuterStrokeColor: p.textMuted,
        // xychart-beta (bar/line)
        xyChart: {
          backgroundColor: p.bg,
          titleColor: p.text,
          xAxisLabelColor: p.text,
          xAxisTitleColor: p.text,
          xAxisTickColor: p.textMuted,
          xAxisLineColor: p.textMuted,
          yAxisLabelColor: p.text,
          yAxisTitleColor: p.text,
          yAxisTickColor: p.textMuted,
          yAxisLineColor: p.textMuted,
          plotColorPalette: [SERIES.series1, SERIES.series2, SERIES.series3, SERIES.series4, SERIES.series5, SERIES.series6].join(','),
        },
        // Gantt
        sectionBkgColor: p.bg3,
        altSectionBkgColor: p.bg2,
        gridColor: p.border,
        sectionBkgColor2: p.bg3,
        taskBkgColor: p.accent,
        taskTextColor: p.accentText,
        taskTextLightColor: p.text,
        taskTextOutsideColor: p.text,
        taskBorderColor: p.border,
        activeTaskBkgColor: SERIES.series2,
        activeTaskBorderColor: p.border,
        doneTaskBkgColor: p.textMuted,
        doneTaskBorderColor: p.border,
        critBkgColor: SERIES.series1,
        critBorderColor: p.border,
      };
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme,
        themeVariables: themeVariables,
      });
      mermaidInitialisedTheme = theme;
    } catch (_e) { /* leave flag empty — retry on next render */ }
  }

  // Salvage common LLM-generated mermaid mistakes before render so a small
  // syntax slip doesn't surface as a 'No diagram type detected' error.
  // The system prompt tells the model the valid types, but small models
  // hallucinate close-but-wrong tokens (bar, barchart, histogram, etc.).
  // We rewrite to the closest valid type whose SYNTAX matches what the
  // model produced, so the chart at least renders.
  function sanitiseMermaidSource(src) {
    if (typeof src !== 'string' || src.length === 0) return src;
    var lines = src.split(/\r?\n/);
    var firstIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].replace(/^\s+/, '');
      if (trimmed.length === 0) continue;
      if (trimmed.charAt(0) === '%') continue; // mermaid comment
      firstIdx = i;
      break;
    }
    if (firstIdx === -1) return src;
    var first = lines[firstIdx];
    // Aliases the agent commonly invents — all use pie-style "label" : value
    // syntax in practice, so rewriting the type token to `pie` salvages them.
    // (xychart-beta has different syntax; we don't auto-rewrite to it.)
    var pieAliases = /^(\s*)(?:bar|bar\s*chart|barchart|barChart|histogram|chart|column|columnchart|columnChart|donut|doughnut)(\s+title|\s*$|\s+showData)/i;
    lines[firstIdx] = first.replace(pieAliases, '$1pie$2');
    // Common flowchart slips
    lines[firstIdx] = lines[firstIdx]
      .replace(/^(\s*)flow(\s+|$)/i, '$1flowchart$2')
      .replace(/^(\s*)sequence(\s+|$)/i, '$1sequenceDiagram$2')
      .replace(/^(\s*)class(\s+diagram|$)/i, '$1classDiagram$2')
      .replace(/^(\s*)state(\s+diagram|$)/i, '$1stateDiagram-v2$2')
      .replace(/^(\s*)er(\s+diagram|$)/i, '$1erDiagram$2');

    // xychart-beta requires quoted titles; LLMs often emit unquoted ones
    // with parens, which mermaid lexes as "unrecognized text" on line 2.
    // Auto-quote the first title line under an xychart-beta block.
    var head = lines[firstIdx].replace(/^\s+/, '');
    if (/^xychart-beta\b/i.test(head)) {
      for (var j = firstIdx + 1; j < lines.length; j++) {
        var match = /^(\s*)title\s+(.+?)\s*$/i.exec(lines[j]);
        if (!match) continue;
        var titleText = match[2];
        if (/^["'].*["']\s*$/.test(titleText)) break;
        var safe = titleText.replace(/"/g, '\\"');
        lines[j] = match[1] + 'title "' + safe + '"';
        break;
      }
    }
    return lines.join('\n');
  }

  function renderMermaidBlocks(root) {
    if (!window.mermaid || typeof window.mermaid.render !== 'function') return;
    ensureMermaidInit();
    var blocks = root.querySelectorAll('code.language-mermaid, pre > code.language-mermaid');
    for (var i = 0; i < blocks.length; i++) {
      var code = blocks[i];
      var pre = code.parentNode && code.parentNode.tagName === 'PRE' ? code.parentNode : null;
      var host = pre || code;
      var source = sanitiseMermaidSource(code.textContent || '');
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
    var resetConv = false;
    fetch(url, { credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken() } })
      .then(function (r) {
        if (!r.ok) return '';
        // Bug #3 (agent-chat-ui-cluster): server signals an out-of-band conv
        // reset (deleted in another tab/session) via empty x-conversation-id.
        try {
          var hdr = r.headers.get && r.headers.get('x-conversation-id');
          if (hdr === '') resetConv = true;
        } catch (_e) { /* header read unsupported, ignore */ }
        return r.text();
      })
      .then(function (html) {
        if (resetConv) { startNewConversation(); return; }
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
    if (typeof params.orgName === 'string') {
      raw = raw.split('__ORG_NAME__').join(params.orgName);
    }
    return raw;
  }

  // Phase 39.1-02: chip-strip rendering + tool_started/tool_completed SSE
  // listener wiring lives in agent-tools.js. agent.js dispatches the
  // `agent:stream-opened` CustomEvent below so that module can attach its
  // listeners; chip-clearing at turn boundaries goes through
  // `window.__luqenAgent.clearToolChips`.
  function clearToolChips() {
    var fn = (window.__luqenAgent && window.__luqenAgent.clearToolChips);
    if (typeof fn === 'function') fn();
  }

  // Phase 43 Plan 03 — plan bubble + step indicator + cancel. SSE `plan`
  // renders inline <ol>; tool_started/tool_completed advance step (ordinal).
  function planEl(tag, cls, txt) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (txt != null) e.textContent = String(txt); return e;
  }
  function renderPlanBubble(plan) {
    var msgs = byId(MESSAGES_ID); if (!msgs || !plan || !plan.steps) return null;
    var wrap = planEl('div', 'agent-msg agent-msg--assistant message--plan');
    wrap.setAttribute('data-plan-id', String(plan.id || ''));
    wrap.appendChild(planEl('span', 'agent-msg__role', 'Plan'));
    var ol = planEl('ol', 'agent-plan');
    plan.steps.forEach(function (s) {
      var li = planEl('li', 'agent-plan__step agent-plan__step--pending');
      li.setAttribute('data-step-n', String(s.n));
      var ind = planEl('span', 'agent-plan__indicator'); ind.setAttribute('aria-hidden', 'true');
      li.appendChild(ind);
      li.appendChild(planEl('span', 'agent-plan__label', s.label || ''));
      li.appendChild(planEl('span', 'agent-plan__rationale', s.rationale || ''));
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    var btn = planEl('button', 'btn btn--ghost btn--sm agent-plan__cancel', 'Cancel');
    btn.type = 'button'; btn.setAttribute('data-action', 'agentCancelTurn');
    wrap.appendChild(btn); msgs.appendChild(wrap); return wrap;
  }
  function advancePlanStep(toClass) {
    var ap = window.__luqenAgent && window.__luqenAgent.activePlan; if (!ap || !ap.bubble) return;
    var li = ap.bubble.querySelector('[data-step-n="' + (ap.callIndex + 1) + '"]'); if (!li) return;
    li.classList.remove('agent-plan__step--pending', 'agent-plan__step--active', 'agent-plan__step--done'); li.classList.add(toClass);
  }
  function cancelActiveTurn() {
    var convId = getConversationId(); if (!convId) return;
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } activeStream = null; }
    fetch('/agent/cancel/' + encodeURIComponent(convId), { method: 'POST', credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken(), 'accept': 'application/json' } }).catch(function () { /* ignore */ });
    var ap = window.__luqenAgent && window.__luqenAgent.activePlan, b;
    if (ap && ap.bubble) {
      b = ap.bubble.querySelector('.agent-plan__cancel'); if (b) b.remove();
      ap.bubble.classList.add('message--plan--cancelled');
    }
    var st = byId(STREAM_STATUS_ID); if (st) st.setAttribute('hidden', '');
  }

  function openStream(conversationId) {
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } }
    var url = '/agent/stream/' + encodeURIComponent(conversationId);
    var es = new EventSource(url, { withCredentials: true });
    activeStream = es;
    window.__luqenAgent.activeStream = es;
    var statusEl = byId(STREAM_STATUS_ID);
    if (statusEl) statusEl.removeAttribute('hidden');

    // Phase 39.1-02: notify agent-tools.js so it can attach the chip-strip
    // listeners (tool_started / tool_completed) on this EventSource. Keeping
    // wiring in the receiving module avoids leaking chip-DOM concerns into
    // the stream-open code path here.
    try {
      document.dispatchEvent(new CustomEvent('agent:stream-opened', { detail: { stream: es } }));
    } catch (_e) { /* ignore */ }

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
    es.addEventListener('plan', function (ev) {
      try {
        var d = JSON.parse(ev.data), bubble = renderPlanBubble(d);
        if (bubble) window.__luqenAgent.activePlan = { id: d.id, steps: d.steps, callIndex: 0, bubble: bubble };
      } catch (_e) { /* ignore */ }
    });
    es.addEventListener('tool_started', function () { advancePlanStep('agent-plan__step--active'); });
    es.addEventListener('tool_completed', function () {
      advancePlanStep('agent-plan__step--done');
      var ap = window.__luqenAgent.activePlan; if (ap) ap.callIndex += 1; });
    es.addEventListener('pending_confirmation', function (ev) {
      try {
        var data = JSON.parse(ev.data);
        window.__agentPendingConfirmation = data;
        document.dispatchEvent(new CustomEvent('agent:pending-confirmation', { detail: data }));
      } catch (_e) { /* ignore */ }
    });
    es.addEventListener('done', function (ev) {
      var dd = null; try { if (ev && ev.data) dd = JSON.parse(ev.data); } catch (_e) { /* ignore */ }
      var ap = window.__luqenAgent.activePlan, cb;
      if (ap && ap.bubble) {
        cb = ap.bubble.querySelector('.agent-plan__cancel'); if (cb) cb.remove();
        if (dd && dd.aborted === true) ap.bubble.classList.add('message--plan--aborted');
      }
      window.__luqenAgent.activePlan = null;
      es.close(); activeStream = null; window.__luqenAgent.activeStream = null;
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
  // Phase 38 Plan 04 — Org switcher (AORG-01, AORG-02, AORG-03).
  //
  // Delegated `change` handler on the drawer header's <select> POSTs the
  // chosen orgId to /agent/active-org. On success, conversationId is
  // reset (force-new-conversation) and the panel is reloaded so the next
  // user message lands under the new org. On failure (403, 500), the
  // toast surfaces an error and the select rolls back to the previous
  // value. All toast text is set via textContent (T-38-12). The
  // dataset.previousOrgId attribute on the select tracks the last
  // confirmed value across rerenders.
  // ──────────────────────────────────────────────────────────────────────

  // Org switcher (constants, helpers, delegated change handler, and the
  // dataset.previousOrgId bootstrap) lives in agent-org.js since 39.1-02.
  // autoSwitchOrgIfNeeded is published on window.__luqenAgent so the
  // history-panel logic below can call into the extracted module.
  function autoSwitchOrgIfNeeded(targetOrgId, targetOrgName) {
    var fn = (window.__luqenAgent && window.__luqenAgent.autoSwitchOrgIfNeeded);
    if (typeof fn === 'function') return fn(targetOrgId, targetOrgName);
    // agent-org.js failed to load: degrade to "no switcher" semantics so
    // history cards still open, just without the cross-org switch.
    return Promise.resolve(true);
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-action="toggleAgentDrawer"]')) { e.preventDefault(); if (isOpen()) closeDrawer(); else openDrawer(true); return; }
    if (e.target.closest('[data-action="closeAgentDrawer"]')) { e.preventDefault(); closeDrawer(); return; }
    if (e.target.closest('[data-action="newChat"]')) { e.preventDefault(); startNewConversation(); return; }
    // History panel click handlers (open/close/clear/retry/menu/rename/
    // delete/resume + cross-org auto-switch) live in agent-history.js since
    // 39.1-02. The module wires its own delegated click+keydown listeners.
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

    // ── Phase 37 Plan 04 — agent-stop click stays here (activeStream is
    // module-private to agent.js). retry/copy/share/edit handlers + their
    // submit listener moved to agent-actions.js in 39.1-02.
    if (e.target.id === 'agent-stop' || e.target.closest('#agent-stop')) {
      e.preventDefault(); handleStopClick(); return;
    }
    if (e.target.closest('[data-action="agentCancelTurn"]')) {
      e.preventDefault(); cancelActiveTurn(); return;
    }
  });

  // ── Phase 37 Plan 04 — handler implementations ────────────────────────

  function handleStopClick() {
    if (activeStream) { try { activeStream.close(); } catch (_e) { /* ignore */ } activeStream = null; }
    var statusEl = byId(STREAM_STATUS_ID); if (statusEl) statusEl.setAttribute('hidden', '');
    // actionT moved to agent-actions.js; inline minimal lookup here.
    var sd = readToolI18n();
    var msg = (sd && typeof sd['actions.stopped'] === 'string' && sd['actions.stopped'].length > 0)
      ? sd['actions.stopped'] : 'actions.stopped';
    announce(msg);
  }

  // removeMessageFromDom + handleRetry/Copy/Share/Edit/Cancel/Submit + their
  // helpers (showShareToast, renderShareUrlChip, restoreEditBody, getMarkdownSource)
  // extracted to agent-actions.js (39.1-02). agent.js retains handleStopClick
  // because activeStream is module-private here.


  document.addEventListener('keydown', function (e) {
    // History-panel keyboard contract is owned by agent-history.js (39.1-02);
    // it consumes the event before this listener runs (registration order is
    // history-first, agent-second). Drawer-level Esc-to-close stays here.
    var historyOpen = (window.__luqenAgent && typeof window.__luqenAgent.historyIsPanelOpen === 'function')
      ? window.__luqenAgent.historyIsPanelOpen()
      : false;
    if (historyOpen) return;
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
    // SECURITY: must run BEFORE restoreConversationId / applyInitialPanelState
    // so that a stale cid from a previous user on this browser is dropped
    // and the panel does not auto-mount it (see evictForeignAgentState).
    evictForeignAgentState();
    restoreConversationId();
    applyInitialPanelState();
    wireDialogCloseTrap();
    wireDisplayNameUpdates();
    ensureAriaLive();
    wireInputAutoResize();
    wireComposerKeyAndGuards();
    // initOrgSelectPreviousOrgId moved to agent-org.js (self-bootstraps on DOMContentLoaded).
    // Share view (read-only): render markdown on assistant bodies that were
    // server-rendered as raw text. No SSE, no loadPanel.
    if (document.querySelector('.agent-share')) {
      var bodies = document.querySelectorAll('.agent-msg--assistant .agent-msg__body');
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i]; var raw = b.textContent || '';
        if (raw.length > 0) renderMarkdownInto(b, raw);
      }
      return;
    }
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

  // Bug #5 (agent-chat-ui-cluster): submit on Enter (without Shift) from the
  // composer textarea. By default Enter inserts a newline in a textarea —
  // users expect it to submit the chat message. Shift+Enter still inserts a
  // newline. Uses HTMX's trigger so all htmx-attached behaviour (csrf header,
  // afterRequest hook) runs identically to a click on the Send button.
  // Also addresses Bug #1: while a submit is in-flight, the Send button + the
  // textarea are disabled to prevent double-submits that produce duplicate
  // user bubbles. They are re-enabled on htmx:afterRequest.
  function wireComposerKeyAndGuards() {
    var input = byId(INPUT_ID);
    var form = byId(FORM_ID);
    if (!input || !form) return;
    var sendBtn = byId('agent-send');
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      // IME composition (CJK/Korean): Enter confirms the candidate, do not
      // submit. event.isComposing is the standard signal; some older
      // browsers expose keyCode 229.
      if (e.isComposing || e.keyCode === 229) return;
      var value = String(input.value || '').trim();
      if (value.length === 0) return;
      e.preventDefault();
      // Defer to HTMX's request pipeline so csrf/headers/afterRequest hooks
      // fire identically to a click on the Send button. window.htmx is the
      // public API; if it isn't loaded yet (defer race), fall back to the
      // form's native requestSubmit which HTMX intercepts via its global
      // submit listener.
      if (window.htmx && typeof window.htmx.trigger === 'function') {
        window.htmx.trigger(form, 'submit');
      } else if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    });
    // In-flight guard: disable composer the instant a submit fires; re-enable
    // when the request returns (success OR error). htmx:beforeRequest fires
    // on every htmx request — filter to this form's path so non-agent
    // submissions don't get caught by the disable hook.
    function isAgentMessageRequest(evt) {
      var cfg = evt && evt.detail && evt.detail.requestConfig;
      return !!(cfg && typeof cfg.path === 'string' && cfg.path.indexOf('/agent/message') === 0);
    }
    document.body.addEventListener('htmx:beforeRequest', function (e) {
      if (!isAgentMessageRequest(e)) return;
      input.setAttribute('aria-busy', 'true');
      input.setAttribute('disabled', '');
      if (sendBtn) sendBtn.setAttribute('disabled', '');
    });
    document.body.addEventListener('htmx:afterRequest', function (e) {
      if (!isAgentMessageRequest(e)) return;
      input.removeAttribute('aria-busy');
      input.removeAttribute('disabled');
      if (sendBtn) sendBtn.removeAttribute('disabled');
      try { input.focus(); } catch (_e) { /* ignore */ }
    });
  }

  // Phase 37 Plan 04 — test-export shim (dead code in production). Tests opt in
  // via window.__agentTestMode = true BEFORE loading agent.js. agent-actions.js
  // / agent-org.js / agent-history.js augment this object post-load with their
  // own helpers (getMarkdownSource, handleAgentOrgSwitch, renderHistoryItem…).
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    window.__agentTestExports = {
      writeToClipboard: writeToClipboard, announce: announce,
      recordMarkdownSource: recordMarkdownSource, readMarkdownSource: readMarkdownSource,
      autoSwitchOrgIfNeeded: autoSwitchOrgIfNeeded, getConversationId: getConversationId,
    };
  }

  function wireDisplayNameUpdates() {
    // Phase 32.1-04: org-settings POST responds with HX-Trigger so the drawer
    // header updates in-place when an admin saves a new display name.
    document.body.addEventListener('agent-display-name-updated', function (e) {
      var detail = (e && e.detail) ? e.detail : {};
      var name = detail && typeof detail.name === 'string' ? detail.name : '';
      if (name.length === 0) return;
      var el = byId('agent-display-name'); if (el) el.textContent = name;
    });
  }

  // Phase 39.1-02 — shared utility namespace for split modules.
  var ns = window.__luqenAgent = window.__luqenAgent || {};
  ns.csrfToken = csrfToken; ns.byId = byId; ns.announce = announce;
  ns.getConversationId = getConversationId; ns.setConversationId = setConversationId;
  ns.formatToolI18n = formatToolI18n; ns.readToolI18n = readToolI18n;
  ns.renderMarkdownInto = renderMarkdownInto;
  ns.recordMarkdownSource = recordMarkdownSource; ns.readMarkdownSource = readMarkdownSource;
  ns.writeToClipboard = writeToClipboard; ns.openStream = openStream; ns.loadPanel = loadPanel;
  ns.cancelActiveTurn = cancelActiveTurn; ns.activePlan = null;

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
