/**
 * Phase 36 Plan 05 — /admin/audit rationale expand/collapse handler.
 *
 * CSP-strict: no inline scripts, DOM mutation via attributes only. A single document-level
 * delegated click listener targets [data-action="toggleRationale"] buttons
 * and toggles the panel referenced by aria-controls.
 *
 * Buttons MUST carry:
 *   - aria-controls="<panel id>"
 *   - aria-expanded="false" (initial)
 *   - data-label-expand / data-label-collapse for aria-label swap
 */
(function () {
  'use strict';

  function togglePanel(button) {
    var targetId = button.getAttribute('aria-controls');
    if (!targetId) return;
    var panel = document.getElementById(targetId);
    if (!panel) return;

    var willShow = panel.hasAttribute('hidden');
    if (willShow) {
      panel.removeAttribute('hidden');
      button.setAttribute('aria-expanded', 'true');
      var collapseLabel = button.getAttribute('data-label-collapse');
      if (collapseLabel) button.setAttribute('aria-label', collapseLabel);
    } else {
      panel.setAttribute('hidden', '');
      button.setAttribute('aria-expanded', 'false');
      var expandLabel = button.getAttribute('data-label-expand');
      if (expandLabel) button.setAttribute('aria-label', expandLabel);
    }
  }

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!(target instanceof Element)) return;
    var btn = target.closest('[data-action="toggleRationale"]');
    if (!btn) return;
    ev.preventDefault();
    togglePanel(btn);
  });
})();
