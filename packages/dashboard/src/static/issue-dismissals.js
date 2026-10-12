/*
 * Issue dismissals ("Mark as false positive") — report page client behaviour.
 * Phase 89 Plan 04 (FP-14, FP-16).
 *
 * Loaded from layouts/main.hbs; reached through app.js's click/input delegation, which falls
 * through to window[action]. Every string shown to the user arrives already translated in
 * data-* attributes on #issue-dismiss-dialog (window.luqenI18n is never defined). User-derived
 * text (rule code, selector, finding message, toast text) is written ONLY as text nodes.
 */
(function () {
  'use strict';

  var DIALOG_ID = 'issue-dismiss-dialog';
  var FLASH_KEY = 'luqen.issueDismissals.flash';

  /* Tests replace reload; jsdom does not implement location.reload. */
  var api = window.luqenIssueDismissals = window.luqenIssueDismissals || {};
  api.reload = api.reload || function () { window.location.reload(); };

  var state = { code: '', selector: '', message: '', criterion: '', tab: 'issues', previewOk: false, inFlight: false, seq: 0 };

  function dialogEl() { return document.getElementById(DIALOG_ID); }
  function field(d, name) { return d.querySelector('[data-field="' + name + '"]'); }
  function preview(d, name) { return d.querySelector('[data-preview="' + name + '"]'); }
  function reasonEl(d) { return d.querySelector('#issue-dismiss-reason'); }
  function confirmBtn(d) { return d.querySelector('[data-action="rptDismissConfirm"]'); }
  function msg(d, attr) { return d.getAttribute(attr) || ''; }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function trimmedReason(d) { return (reasonEl(d).value || '').trim(); }

  function updateConfirm(d) {
    var reason = trimmedReason(d);
    var max = reasonEl(d).maxLength > 0 ? reasonEl(d).maxLength : Infinity;
    var valid = reason.length >= 1 && reason.length <= max;
    confirmBtn(d).disabled = !(valid && state.previewOk && !state.inFlight);
  }

  function setText(el, text) { if (el) el.textContent = text; }

  /* ── Preview ─────────────────────────────────────────────────────── */

  function setPreviewBusy(d, busy) {
    var region = d.querySelector('[data-preview-region]');
    if (region) region.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showPreviewHint(d, attr) {
    setText(preview(d, 'status'), msg(d, attr));
  }

  function previewDone(d, attrOrNull) {
    setPreviewBusy(d, false);
    if (attrOrNull) showPreviewHint(d, attrOrNull); else setText(preview(d, 'status'), '');
  }

  function startPreview(d) {
    var seq = state.seq = state.seq + 1;
    state.previewOk = false;
    setText(preview(d, 'occurrences'), '—');
    setText(preview(d, 'pages'), '—');
    setPreviewBusy(d, true);
    showPreviewHint(d, 'data-preview-loading');
    var retry = d.querySelector('[data-action="rptDismissRetryPreview"]');
    if (retry) retry.classList.add('is-hidden');
    updateConfirm(d);

    var url = '/api/v1/scans/' + encodeURIComponent(d.getAttribute('data-scan-id') || '') +
      '/dismissals/preview?code=' + encodeURIComponent(state.code) +
      '&selector=' + encodeURIComponent(state.selector);
    fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('preview ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (seq !== state.seq) return;
        applyPreview(d, data);
      })
      .catch(function () {
        if (seq !== state.seq) return;
        previewDone(d, 'data-preview-error');
        if (retry) retry.classList.remove('is-hidden');
        updateConfirm(d);
      });
  }

  function applyPreview(d, data) {
    var occ = data && typeof data.occurrences === 'number' ? data.occurrences : 0;
    var pages = data && typeof data.pages === 'number' ? data.pages : 0;
    setText(preview(d, 'occurrences'), String(occ));
    setText(preview(d, 'pages'), String(pages));
    if (data && data.refused === true) { previewDone(d, 'data-preview-refused'); }
    else if (data && data.alreadyDismissed === true) { previewDone(d, 'data-preview-already'); }
    else if (occ < 1) { previewDone(d, 'data-preview-none'); }
    else { state.previewOk = true; previewDone(d, null); }
    updateConfirm(d);
  }

  /* ── Open / reset ────────────────────────────────────────────────── */

  function panelTab(el) {
    var panel = el.closest ? el.closest('.rpt-tab-panel') : null;
    if (panel && panel.id && panel.id.indexOf('panel-') === 0) return panel.id.slice(6);
    var hash = (window.location.hash || '').replace('#', '');
    return hash || 'issues';
  }

  window.rptDismissIssue = function (btn) {
    if (btn.getAttribute('aria-disabled') === 'true') return;
    var d = dialogEl();
    if (!d || d.open) return;
    state.code = btn.getAttribute('data-code') || '';
    state.selector = btn.getAttribute('data-selector') || '';
    state.message = btn.getAttribute('data-message') || '';
    state.criterion = btn.getAttribute('data-criterion') || '';
    state.tab = panelTab(btn);
    state.previewOk = false;
    state.inFlight = false;
    reasonEl(d).value = '';
    setText(d.querySelector('[data-reason-count]'), '0');
    setText(d.querySelector('#issue-dismiss-error'), '');
    setText(field(d, 'code'), state.code);
    setText(field(d, 'selector'), state.selector);
    setText(field(d, 'message'), state.message);
    confirmBtn(d).disabled = true;
    try { d.showModal(); } catch (_e) { /* already open or unsupported */ }
    startPreview(d);
  };

  window.rptDismissCancel = function () {
    var d = dialogEl();
    if (d) d.close();
  };

  window.rptDismissRetryPreview = function () {
    var d = dialogEl();
    if (d) startPreview(d);
  };

  window.rptDismissReasonInput = function () {
    var d = dialogEl();
    if (!d) return;
    setText(d.querySelector('[data-reason-count]'), String(reasonEl(d).value.length));
    updateConfirm(d);
  };

  /* ── Confirm ─────────────────────────────────────────────────────── */

  function showError(d, text) {
    setText(d.querySelector('#issue-dismiss-error'), text);
  }

  function storeFlash(flash) {
    try { window.sessionStorage.setItem(FLASH_KEY, JSON.stringify(flash)); } catch (_e) { /* reload anyway */ }
  }

  function flashFor(d, body) {
    var failed = body && typeof body.failed_scans === 'number' ? body.failed_scans : 0;
    var count = body && typeof body.recomputed_scans === 'number' ? body.recomputed_scans : 0;
    var text;
    var kind = 'success';
    if (failed > 0) {
      kind = 'warning';
      text = msg(d, 'data-msg-recompute-failed').split('__FAILED__').join(String(failed));
    } else if (body && body.recompute_complete === false) {
      kind = 'warning';
      text = msg(d, 'data-msg-recompute-incomplete');
    } else {
      text = msg(d, 'data-msg-marked').split('__COUNT__').join(String(count));
    }
    return { kind: kind, message: text, tab: state.tab, criterion: state.criterion };
  }

  window.rptDismissConfirm = function () {
    var d = dialogEl();
    if (!d || confirmBtn(d).disabled) return;
    var reason = trimmedReason(d);
    state.inFlight = true;
    updateConfirm(d);
    fetch('/api/v1/scans/' + encodeURIComponent(d.getAttribute('data-scan-id') || '') + '/dismissals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify({ code: state.code, selector: state.selector, reason: reason })
    })
      .then(function (res) {
        if (res.status !== 201) {
          state.inFlight = false;
          showError(d, msg(d, 'data-err-generic'));
          updateConfirm(d);
          return null;
        }
        return res.json().then(function (body) { return body; }, function () { return {}; });
      })
      .then(function (body) {
        if (body === null) return;
        storeFlash(flashFor(d, body));
        api.reload();
      })
      .catch(function () {
        state.inFlight = false;
        showError(d, msg(d, 'data-err-generic'));
        updateConfirm(d);
      });
  };

  /* ── Result toast after the reload ───────────────────────────────── */

  function readFlash() {
    try {
      var raw = window.sessionStorage.getItem(FLASH_KEY);
      if (raw === null) return null;
      window.sessionStorage.removeItem(FLASH_KEY);
      var flash = JSON.parse(raw);
      return flash && typeof flash.message === 'string' ? flash : null;
    } catch (_e) { return null; }
  }

  function showFlashToast(flash) {
    var tc = document.getElementById('toast-container');
    if (!tc) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast--success';
    toast.setAttribute('role', 'status');
    toast.appendChild(document.createTextNode(flash.message));
    tc.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0'; toast.style.transition = 'opacity 300ms ease';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 5000);
  }

  function onLoad() {
    var flash = readFlash();
    if (flash) showFlashToast(flash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onLoad);
  } else {
    onLoad();
  }
})();
