/* Phase 39.1-02 — agent-tools module.
 *
 * Owns the tool-progress chip strip rendered above the agent drawer's message
 * list. Listens to the SSE stream's `tool_started` / `tool_completed` frames
 * and updates the chip strip accordingly. Exposes `clearToolChips` on
 * `window.__luqenAgent` so agent.js can wipe the strip between turns.
 *
 * Coupling notes:
 * - Reads i18n via window.__luqenAgent.formatToolI18n / readToolI18n (already
 *   exposed by agent.js — this module never reads the JSON-script-block
 *   directly).
 * - Receives the active EventSource via the `agent:stream-opened` CustomEvent
 *   that agent.js dispatches on `document` after constructing the stream.
 * - Pure DOM/UI module: no fetch, no auth, no conversation-id awareness.
 *
 * Loaded after agent.js in views/layouts/main.hbs (defer order preserves
 * execution order, so window.__luqenAgent is populated before this IIFE
 * runs).
 */
(function () {
  'use strict';

  var A = window.__luqenAgent || {};
  var byId = A.byId || function (id) { return document.getElementById(id); };
  var formatToolI18n = A.formatToolI18n || function () { return ''; };

  var TOOL_CHIPS_ID = 'agent-tool-chips';

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

  function attachStreamListeners(es) {
    if (!es || typeof es.addEventListener !== 'function') return;
    es.addEventListener('tool_started', function (ev) {
      try { handleToolStarted(JSON.parse(ev.data)); } catch (_e) { /* ignore malformed */ }
    });
    es.addEventListener('tool_completed', function (ev) {
      try { handleToolCompleted(JSON.parse(ev.data)); } catch (_e) { /* ignore malformed */ }
    });
  }

  // agent.js dispatches this CustomEvent on `document` after constructing the
  // EventSource for a new assistant turn. We attach the chip listeners here
  // so chip-strip code stays self-contained in this module.
  document.addEventListener('agent:stream-opened', function (ev) {
    var detail = (ev && ev.detail) ? ev.detail : {};
    attachStreamListeners(detail.stream);
  });

  // Expose for agent.js so it can clear chips at turn boundaries (done frame,
  // retry, edit-resubmit, send-success).
  window.__luqenAgent = window.__luqenAgent || {};
  window.__luqenAgent.clearToolChips = clearToolChips;
  window.__luqenAgent.handleToolStarted = handleToolStarted;
  window.__luqenAgent.handleToolCompleted = handleToolCompleted;
})();
