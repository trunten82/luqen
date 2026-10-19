/*
 * Issue dismissals ("Mark as false positive" and revoke) — report page client behaviour.
 * Phase 89 Plan 04 (FP-14, FP-16) and Plan 05 (FP-15 revoke).
 *
 * Loaded from layouts/main.hbs; reached through app.js's click/input delegation, which falls
 * through to window[action]. Every string shown to the user arrives already translated in
 * data-* attributes on #issue-dismiss-dialog / #issue-revoke-dialog (window.luqenI18n is never
 * defined). User-derived text (rule code, selector, finding message, toast text) is written ONLY
 * as text nodes.
 *
 * Mark and revoke share ONE status map (ERR_ATTR), ONE request path (submit), ONE in-flight lock
 * (setInFlight) and ONE flash/toast (storeFlash, showFlashToast); each dialog supplies its own
 * strings under the same data-* attribute names.
 */
(function () {
  'use strict';

  var DIALOG_ID = 'issue-dismiss-dialog';
  var REVOKE_ID = 'issue-revoke-dialog';
  var FLASH_KEY = 'luqen.issueDismissals.flash';

  /* Tests replace reload; jsdom does not implement location.reload. */
  var api = window.luqenIssueDismissals = window.luqenIssueDismissals || {};
  api.reload = api.reload || function () { window.location.reload(); };

  var state = { code: '', selector: '', message: '', criterion: '', tab: 'issues', previewOk: false, inFlight: false, seq: 0, revokeId: '' };

  function dialogEl() { return document.getElementById(DIALOG_ID); }
  function revokeEl() { return document.getElementById(REVOKE_ID); }
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

  /* 89-11 (D-02): the footer is sticky. Autofocus does not scroll a field that is already partly
     visible, and the preview hint can push the field down, so a FOCUSED field is brought into view
     (nearest, which honours the dialog's scroll-padding above the footer). An unfocused one is left. */
  function keepFieldInView(d) {
    var f = d.querySelector('textarea');
    if (f && document.activeElement === f && typeof f.scrollIntoView === 'function') f.scrollIntoView({ block: 'nearest' });
  }

  function previewDone(d, attrOrNull) {
    setPreviewBusy(d, false);
    if (attrOrNull) showPreviewHint(d, attrOrNull); else setText(preview(d, 'status'), '');
    keepFieldInView(d);
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
        /* HARD-01: a request the server refuses (4xx) is refused the same way every time, so it
           shows the refused state, not Try again. 408 and 429 mean "not now" and stay retryable,
           as do 5xx answers and network failures (the catch below). */
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          return { refused: true };
        }
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
    /* 89-11 (D-04, UD-05): more than one counted occurrence (twin page issues, a template item)
       is ONE dismissal; say so before Confirm. The key and the count are unchanged. */
    else { state.previewOk = true; previewDone(d, occ > 1 ? 'data-preview-together' : null); }
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
    setInFlight(d, false);
    reasonEl(d).value = '';
    setText(d.querySelector('[data-reason-count]'), '0');
    setText(d.querySelector('#issue-dismiss-error'), '');
    setText(field(d, 'code'), state.code);
    setText(field(d, 'selector'), state.selector);
    setText(field(d, 'message'), state.message);
    confirmBtn(d).disabled = true;
    try { d.showModal(); } catch (_e) { /* already open or unsupported */ }
    keepFieldInView(d);
    startPreview(d);
  };

  window.rptDismissCancel = function () {
    var d = dialogEl();
    if (d && !state.inFlight) d.close();
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

  /* HTTP status -> data attribute holding the translated text (UD-11). The server's own
     English error string is never displayed. */
  var ERR_ATTR = {
    400: 'data-err-invalid',
    401: 'data-err-session',
    403: 'data-err-forbidden',
    404: 'data-err-not-found',
    409: 'data-err-conflict',
    422: 'data-err-no-match',
    429: 'data-err-rate-limited',
    503: 'data-err-unavailable'
  };

  /* The two dialogs share one frame, so the shared code finds its parts structurally. */
  function errorEl(d) { return d.querySelector('.form-error'); }
  function footerConfirm(d) { return d.querySelector('.modal__footer .btn--primary'); }
  function footerCancel(d) { return d.querySelector('.modal__footer .btn--ghost'); }
  function textareaEl(d) { return d.querySelector('textarea'); }

  /* 89-11 (D-02): the footer is sticky, so a shown error is brought into view (nearest) rather
     than left under the footer or below the dialog's visible area. Clearing scrolls nothing. */
  function showError(d, text) {
    var el = errorEl(d);
    setText(el, text);
    if (el && text && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }

  /* Mark gates Confirm on reason + preview; revoke has no gate (the comment is optional). */
  function refreshConfirm(d) {
    if (d.id === DIALOG_ID) updateConfirm(d);
    else footerConfirm(d).disabled = state.inFlight;
  }

  /* UD-12: while the request is in flight Confirm shows the saving label and both buttons
     are disabled; the cancel (Escape) handler below refuses to close the dialog. */
  function setInFlight(d, on) {
    state.inFlight = on;
    setText(footerConfirm(d), msg(d, on ? 'data-msg-saving' : 'data-msg-confirm'));
    footerCancel(d).disabled = on;
    refreshConfirm(d);
  }

  /* Failure: translated message, dialog stays open, typed text kept, focus back to it. */
  function failWith(d, httpStatus) {
    setInFlight(d, false);
    textareaEl(d).focus({ preventScroll: true });
    showError(d, msg(d, ERR_ATTR[httpStatus] || 'data-err-generic'));
  }

  function storeFlash(flash) {
    try { window.sessionStorage.setItem(FLASH_KEY, JSON.stringify(flash)); } catch (_e) { /* reload anyway */ }
  }

  function flashFor(d, body, okAttr) {
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
      text = msg(d, okAttr).split('__COUNT__').join(String(count));
    }
    return { kind: kind, message: text, tab: state.tab, criterion: state.criterion };
  }

  /* The ONE mutating request (mark and revoke): JSON, cookie session, CSRF header, in-flight lock.
     Only the exact success status counts as success; the dialog's own data-msg-* strings and the
     shared status map do the rest. */
  function submit(d, url, payload, okStatus, okAttr) {
    showError(d, '');
    setInFlight(d, true);
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (res.status !== okStatus) { failWith(d, res.status); return null; }
        return res.json().then(function (body) { return body; }, function () { return {}; });
      })
      .then(function (body) {
        if (body === null) return;
        storeFlash(flashFor(d, body, okAttr));
        api.reload();
      })
      .catch(function () { failWith(d, 0); });
  }

  window.rptDismissConfirm = function () {
    var d = dialogEl();
    if (!d || state.inFlight || confirmBtn(d).disabled) return;
    submit(
      d,
      '/api/v1/scans/' + encodeURIComponent(d.getAttribute('data-scan-id') || '') + '/dismissals',
      { code: state.code, selector: state.selector, reason: trimmedReason(d) },
      201,
      'data-msg-marked'
    );
  };

  /* ── Revoke (Plan 05, D-08) ──────────────────────────────────────── */

  function trimmedComment(d) { return (textareaEl(d).value || '').trim(); }

  window.rptRevokeIssue = function (btn) {
    var d = revokeEl();
    if (!d || d.open) return;
    state.revokeId = btn.getAttribute('data-id') || '';
    state.code = btn.getAttribute('data-code') || '';
    state.tab = panelTab(btn);
    state.criterion = '';
    setInFlight(d, false);
    textareaEl(d).value = '';
    setText(d.querySelector('[data-comment-count]'), '0');
    showError(d, '');
    setText(field(d, 'code'), state.code);
    try { d.showModal(); } catch (_e) { /* already open or unsupported */ }
    keepFieldInView(d);
  };

  window.rptRevokeCancel = function () {
    var d = revokeEl();
    if (d && !state.inFlight) d.close();
  };

  window.rptRevokeCommentInput = function () {
    var d = revokeEl();
    if (d) setText(d.querySelector('[data-comment-count]'), String(textareaEl(d).value.length));
  };

  /* The comment is optional: an empty (or whitespace-only) one sends {} - never an empty body
     (Phase 87 IN-01) and never an empty comment key. */
  window.rptRevokeConfirm = function () {
    var d = revokeEl();
    if (!d || state.inFlight || !state.revokeId) return;
    var comment = trimmedComment(d);
    submit(
      d,
      '/api/v1/dismissals/' + encodeURIComponent(state.revokeId) + '/revoke',
      comment === '' ? {} : { comment: comment },
      200,
      'data-msg-revoked'
    );
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

  function removeToast(toast) {
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
  }

  function showFlashToast(flash, closeLabel) {
    var tc = document.getElementById('toast-container');
    if (!tc) return;
    var warning = flash.kind === 'warning';
    var toast = document.createElement('div');
    toast.className = warning ? 'toast toast--warning' : 'toast toast--success';
    toast.setAttribute('role', warning ? 'alert' : 'status');
    toast.appendChild(document.createTextNode(flash.message));
    if (warning) {
      /* Persistent: app.js's toast sweeps skip data-toast-persist; the user closes it. */
      toast.setAttribute('data-toast-persist', '');
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast__close';
      close.setAttribute('data-action', 'rptToastClose');
      close.setAttribute('aria-label', closeLabel);
      close.appendChild(document.createTextNode('\u00d7'));
      toast.appendChild(close);
    }
    tc.appendChild(toast);
    if (!warning) {
      setTimeout(function () {
        toast.style.opacity = '0'; toast.style.transition = 'opacity 300ms ease';
        setTimeout(function () { removeToast(toast); }, 300);
      }, 5000);
    }
  }

  window.rptToastClose = function (btn) {
    removeToast(btn && btn.closest ? btn.closest('.toast') : null);
  };

  /* UD-10: back to the saved tab (Issues when its panel no longer exists) and, on the Issues
     tab, open the criterion group the user was working in. */
  function restorePlace(flash) {
    var wanted = typeof flash.tab === 'string' && flash.tab !== '' ? flash.tab : 'issues';
    var tab = document.getElementById('panel-' + wanted) ? wanted : 'issues';
    if (typeof window.rptSwitchTab === 'function') window.rptSwitchTab(tab);
    if (tab !== 'issues' || typeof flash.criterion !== 'string' || flash.criterion === '') return;
    var groups = document.querySelectorAll('[data-issue-group]');
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].getAttribute('data-criterion') !== flash.criterion) continue;
      groups[i].classList.remove('rpt-group--collapsed');
      var header = groups[i].querySelector('.rpt-group__header');
      if (header) header.setAttribute('aria-expanded', 'true');
      if (typeof groups[i].scrollIntoView === 'function') groups[i].scrollIntoView();
      return;
    }
  }

  function onLoad() {
    var d = dialogEl();
    /* The cancel event (Escape) does not bubble, so it is attached to each dialog itself. */
    [d, revokeEl()].forEach(function (dlg) {
      if (dlg) dlg.addEventListener('cancel', function (e) { if (state.inFlight) e.preventDefault(); });
    });
    var flash = readFlash();
    if (!flash) return;
    showFlashToast(flash, d ? msg(d, 'data-label-close') : '');
    restorePlace(flash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onLoad);
  } else {
    onLoad();
  }
})();
