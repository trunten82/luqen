/* Phase 39.1-02 — agent-org module.
 *
 * Org switcher extracted from agent.js. Owns:
 *   - The drawer header <select> change handler that POSTs /agent/active-org.
 *   - The cross-org auto-switch helper invoked when opening a history card
 *     belonging to a different org.
 *   - The dataset.previousOrgId snapshot bootstrap so the change handler can
 *     distinguish new-vs-previous values.
 *
 * Depends on shared utilities published by agent.js on window.__luqenAgent
 * (csrfToken, byId, announce, getConversationId, formatToolI18n). agent.js
 * MUST be loaded before this file.
 */
(function () {
  'use strict';

  var A = window.__luqenAgent;
  if (!A) {
    // agent.js failed to load or ran in an unexpected order. Bail out so we
    // don't throw on every page load.
    return;
  }

  var csrfToken = A.csrfToken;
  var byId = A.byId;
  var announce = A.announce;
  var formatToolI18n = A.formatToolI18n;

  // Mirror the small set of agent.js IIFE-scoped constants we need. Keeping
  // them as string literals here avoids leaking them onto __luqenAgent just
  // for one consumer. If agent.js ever changes these, update both files.
  var LS_CONV_KEY = 'luqen.agent.conversationId';
  var FORM_ID = 'agent-form';
  var MESSAGES_ID = 'agent-messages';

  var ORG_SELECT_SELECTOR = '.agent-drawer__org-switcher-select';
  var ORG_TOAST_SELECTOR = '[data-role="orgToast"]';

  function showOrgToast(toast, text, opts) {
    if (!toast) return;
    var state = (opts && typeof opts.state === 'string') ? opts.state : '';
    toast.textContent = String(text == null ? '' : text);
    toast.classList.add('is-visible');
    if (state === 'error') {
      toast.classList.add('is-error');
    } else {
      toast.classList.remove('is-error');
    }
  }

  function hideOrgToast(toast) {
    if (!toast) return;
    toast.classList.remove('is-visible');
    toast.classList.remove('is-error');
    toast.textContent = '';
  }

  // Snapshot select.value BEFORE the user can change it, so the change
  // handler can tell new-vs-previous. Without this, dataset.previousOrgId
  // was being set in the change handler AFTER select.value already updated,
  // which made previousOrgId === orgId and short-circuited the POST.
  function initOrgSelectPreviousOrgId() {
    var select = document.querySelector(ORG_SELECT_SELECTOR);
    if (!select) return;
    if (!select.dataset.previousOrgId) {
      select.dataset.previousOrgId = select.value;
    }
  }

  function findOrgSelect(root) {
    return (root || document).querySelector(ORG_SELECT_SELECTOR);
  }

  function postActiveOrg(orgId) {
    return fetch('/agent/active-org', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken(),
        'accept': 'application/json',
      },
      body: JSON.stringify({ orgId: String(orgId) }),
    });
  }

  function handleAgentOrgSwitch(form) {
    if (!form) return;
    var select = form.querySelector(ORG_SELECT_SELECTOR);
    if (!select) return;
    var toast = form.querySelector(ORG_TOAST_SELECTOR);
    var orgId = String(select.value || '');
    var orgName = '';
    var optEl = select.options[select.selectedIndex];
    if (optEl) orgName = String(optEl.textContent || '');
    var previousOrgId = select.dataset.previousOrgId || '';
    if (previousOrgId && previousOrgId === orgId) return; // no-op
    showOrgToast(toast, formatToolI18n('org.switching') || 'Switching…', { state: 'loading' });
    postActiveOrg(orgId).then(function (res) {
      if (!res.ok) {
        var msg = res.status === 403
          ? (formatToolI18n('org.forbidden') || 'Not allowed')
          : (formatToolI18n('org.error') || "Couldn't switch org");
        showOrgToast(toast, msg, { state: 'error' });
        if (previousOrgId) select.value = previousOrgId;
        return;
      }
      return res.json().then(function (body) {
        var resolvedId = body && typeof body.activeOrgId === 'string' ? body.activeOrgId : orgId;
        var resolvedName = body && typeof body.activeOrgName === 'string' ? body.activeOrgName : orgName;
        select.dataset.previousOrgId = resolvedId;
        // Force-new-conversation: drop the active conversationId so the next
        // user message creates a fresh conversation under the new org.
        try { localStorage.removeItem(LS_CONV_KEY); } catch (_e) { /* ignore */ }
        var formEl = byId(FORM_ID);
        if (formEl) { formEl.setAttribute('data-conversation-id', ''); }
        var hiddenEl = byId('agent-conversation-id-field');
        if (hiddenEl) { hiddenEl.value = ''; }
        var msgsEl = byId(MESSAGES_ID);
        if (msgsEl) { while (msgsEl.firstChild) msgsEl.removeChild(msgsEl.firstChild); }
        var switchedText = formatToolI18n('org.switched', { orgName: resolvedName }) || ('Switched to ' + resolvedName);
        showOrgToast(toast, switchedText, { state: 'ok' });
        announce(switchedText);
        setTimeout(function () { hideOrgToast(toast); }, 2000);
      });
    }).catch(function () {
      showOrgToast(toast, formatToolI18n('org.error') || "Couldn't switch org", { state: 'error' });
      if (previousOrgId) select.value = previousOrgId;
    });
  }

  function autoSwitchOrgIfNeeded(targetOrgId, targetOrgName) {
    var select = findOrgSelect();
    if (!select) return Promise.resolve(true); // no switcher → non-admin
    if (!targetOrgId) return Promise.resolve(true);
    if (select.value === String(targetOrgId)) return Promise.resolve(true);
    var toast = document.querySelector(ORG_TOAST_SELECTOR);
    showOrgToast(toast, formatToolI18n('org.switching') || 'Switching…', { state: 'loading' });
    return postActiveOrg(targetOrgId).then(function (res) {
      if (!res.ok) {
        showOrgToast(toast, formatToolI18n('org.error') || "Couldn't switch org", { state: 'error' });
        return false;
      }
      return res.json().then(function (body) {
        var resolvedId = body && typeof body.activeOrgId === 'string' ? body.activeOrgId : String(targetOrgId);
        var resolvedName = body && typeof body.activeOrgName === 'string' ? body.activeOrgName : String(targetOrgName || '');
        select.value = resolvedId;
        select.dataset.previousOrgId = resolvedId;
        var switchedText = formatToolI18n('org.switched', { orgName: resolvedName }) || ('Switched to ' + resolvedName);
        showOrgToast(toast, switchedText, { state: 'ok' });
        announce(switchedText);
        setTimeout(function () { hideOrgToast(toast); }, 2000);
        return true;
      });
    }, function () {
      showOrgToast(toast, formatToolI18n('org.error') || "Couldn't switch org", { state: 'error' });
      return false;
    });
  }

  // Delegated change handler for the drawer header switcher form.
  document.addEventListener('change', function (e) {
    if (!e.target || !e.target.closest) return;
    var form = e.target.closest('form[data-action="agentOrgSwitch"]');
    if (!form) return;
    handleAgentOrgSwitch(form);
  });

  // Expose autoSwitchOrgIfNeeded so the history-panel logic in agent.js can
  // call into the extracted module.
  A.autoSwitchOrgIfNeeded = autoSwitchOrgIfNeeded;

  // Test export: tests opt in by setting window.__agentTestMode = true BEFORE
  // loading agent-org.js. Augments the export bag set up by agent.js so the
  // existing harness keeps working without further changes.
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    var bag = window.__agentTestExports || {};
    bag.handleAgentOrgSwitch = handleAgentOrgSwitch;
    bag.autoSwitchOrgIfNeeded = autoSwitchOrgIfNeeded;
    window.__agentTestExports = bag;
  }

  // Self-bootstrap the previousOrgId snapshot. Mirrors the init() call that
  // used to live in agent.js.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrgSelectPreviousOrgId);
  } else {
    initOrgSelectPreviousOrgId();
  }
})();
