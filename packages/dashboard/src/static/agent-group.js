/* Phase 62.4 — agent-group module.
 *
 * Group switcher mirrors agent-org.js but persists via cookie. Owns:
 *   - The drawer header <select> change handler that POSTs /agent/group.
 *   - A toast announcing the switch / clear / error outcome.
 *
 * The selection itself is persisted server-side via the `luqen_agent_group`
 * cookie (set by /agent/group). Subsequent page renders read it back via
 * buildDrawerGroupContext so the <select> stays in sync across reloads.
 *
 * Depends on shared utilities published by agent.js on window.__luqenAgent
 * (csrfToken, byId, announce, formatToolI18n). agent.js MUST be loaded
 * before this file.
 */
(function () {
  'use strict';

  var A = window.__luqenAgent;
  if (!A) return;

  var csrfToken = A.csrfToken;
  var announce = A.announce;
  var formatToolI18n = A.formatToolI18n;

  var GROUP_SELECT_SELECTOR = '.agent-drawer__org-switcher-select#agent-group-select';
  var GROUP_TOAST_SELECTOR = '[data-role="groupToast"]';

  function showGroupToast(toast, text, opts) {
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

  function hideGroupToast(toast) {
    if (!toast) return;
    toast.classList.remove('is-visible');
    toast.classList.remove('is-error');
    toast.textContent = '';
  }

  function initGroupSelectPrevious() {
    var select = document.querySelector(GROUP_SELECT_SELECTOR);
    if (!select) return;
    if (!select.dataset.previousGroupId) {
      select.dataset.previousGroupId = select.value || '';
    }
  }

  function postAgentGroup(groupId) {
    return fetch('/agent/group', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken(),
        'accept': 'application/json',
      },
      body: JSON.stringify({ groupId: String(groupId) }),
    });
  }

  function handleAgentGroupSwitch(form) {
    if (!form) return;
    var select = form.querySelector(GROUP_SELECT_SELECTOR);
    if (!select) return;
    var toast = form.querySelector(GROUP_TOAST_SELECTOR);
    var groupId = String(select.value || '');
    var groupName = '';
    var optEl = select.options[select.selectedIndex];
    if (optEl) groupName = String(optEl.textContent || '');
    var previousGroupId = select.dataset.previousGroupId || '';
    if (previousGroupId === groupId) return; // no-op

    showGroupToast(
      toast,
      formatToolI18n('group.switching') || 'Switching group…',
      { state: 'loading' },
    );

    postAgentGroup(groupId).then(function (res) {
      if (!res.ok) {
        showGroupToast(
          toast,
          formatToolI18n('group.error') || 'Could not switch group',
          { state: 'error' },
        );
        select.value = previousGroupId;
        return;
      }
      return res.json().then(function (body) {
        var resolvedId = body && typeof body.groupId === 'string' ? body.groupId : groupId;
        var resolvedName = body && typeof body.groupName === 'string' ? body.groupName : groupName;
        select.dataset.previousGroupId = resolvedId;
        var msg;
        if (resolvedId === '') {
          msg = formatToolI18n('group.cleared') || 'Group filter cleared';
        } else {
          msg = formatToolI18n('group.switched', { groupName: resolvedName })
            || ('Switched to group ' + resolvedName);
        }
        showGroupToast(toast, msg, { state: 'ok' });
        announce(msg);
        setTimeout(function () { hideGroupToast(toast); }, 2000);
      });
    }).catch(function () {
      showGroupToast(
        toast,
        formatToolI18n('group.error') || 'Could not switch group',
        { state: 'error' },
      );
      select.value = previousGroupId;
    });
  }

  // Delegated change handler for the drawer header switcher form.
  document.addEventListener('change', function (e) {
    if (!e.target || !e.target.closest) return;
    var form = e.target.closest('form[data-action="agentGroupSwitch"]');
    if (!form) return;
    handleAgentGroupSwitch(form);
  });

  // Test export.
  if (typeof window !== 'undefined' && window.__agentTestMode === true) {
    var bag = window.__agentTestExports || {};
    bag.handleAgentGroupSwitch = handleAgentGroupSwitch;
    window.__agentTestExports = bag;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGroupSelectPrevious);
  } else {
    initGroupSelectPrevious();
  }
})();
