(function () {
  'use strict';

  /* ── CSRF: send token on every HTMX request ─────────────────────── */
  document.addEventListener('htmx:configRequest', function (e) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) e.detail.headers['x-csrf-token'] = meta.getAttribute('content');
  });

  /* ── Sidebar (mobile) ─────────────────────────────────────────────── */
  function toggleSidebar() {
    var s = document.getElementById('sidebar');
    if (s && s.classList.contains('is-open')) { closeSidebar(); } else { openSidebar(); }
  }
  function openSidebar() {
    var s = document.getElementById('sidebar');
    var b = document.getElementById('sidebar-backdrop');
    var btn = document.getElementById('mobile-menu-btn');
    if (s) s.classList.add('is-open');
    if (b) b.classList.add('is-visible');
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-label', 'Close navigation menu'); }
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    var s = document.getElementById('sidebar');
    var b = document.getElementById('sidebar-backdrop');
    var btn = document.getElementById('mobile-menu-btn');
    if (s) s.classList.remove('is-open');
    if (b) b.classList.remove('is-visible');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'Open navigation menu'); }
    document.body.style.overflow = '';
  }

  /* ── Modal ─────────────────────────────────────────────────────────── */
  function closeModal() {
    var c = document.getElementById('modal-container');
    if (c) { c.replaceChildren(); }
    /* Ensure body scroll is restored (sidebar may have locked it) */
    var sidebar = document.getElementById('sidebar');
    if (!sidebar || !sidebar.classList.contains('is-open')) {
      document.body.style.overflow = '';
    }
  }

  /* Close modal on overlay/cancel/close click — use event delegation
     on the modal container so dynamically loaded HTMX content is covered. */
  document.addEventListener('click', function (e) {
    var mc = document.getElementById('modal-container');
    if (!mc || !mc.hasChildNodes()) return;
    /* Click on overlay background (not the modal box itself) */
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      closeModal();
      return;
    }
    /* Click on cancel / close buttons */
    if (e.target.closest && e.target.closest('.close-modal-btn, .modal__close')) {
      closeModal();
      return;
    }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* ── HTMX after-request: close modal / reset form / remove load-more ── */
  /* Replaces all hx-on::after-request inline attributes (blocked by CSP) */
  document.addEventListener('htmx:afterRequest', function (e) {
    if (!e.detail.successful) return;
    var el = e.detail.elt;
    if (!el) return;
    /* Modal close is handled by OOB swap from server (modal-container cleared) */
    /* Inline forms with data-reset-on-success: reset after submit */
    if (el.hasAttribute && el.hasAttribute('data-reset-on-success')) {
      el.reset();
    }
    /* Load-more buttons: remove after loading */
    if (el.closest && el.closest('.load-more')) {
      el.closest('.load-more').remove();
    }
  });

  /* ── Toast auto-dismiss ───────────────────────────────────────────── */
  document.addEventListener('htmx:afterSwap', function () {
    var tc = document.getElementById('toast-container');
    if (!tc) return;
    tc.querySelectorAll('.toast').forEach(function (t) {
      setTimeout(function () {
        t.style.opacity = '0'; t.style.transition = 'opacity 300ms ease';
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
      }, 5000);
    });
  });

  /* ── Picker (searchable multi-select for jurisdictions/regulations) ── */
  var _pickerTab = 'jurisdictions';
  function pickerTab(tab, btn) {
    _pickerTab = tab;
    btn.parentElement.querySelectorAll('.picker__tab').forEach(function (t) { t.classList.remove('picker__tab--active'); });
    btn.classList.add('picker__tab--active');
    var search = btn.closest('.picker').querySelector('.picker__search');
    if (search) { search.value = ''; }
    pickerSearch('');
  }
  function pickerSearch(q) {
    var lq = q.toLowerCase();
    document.querySelectorAll('.picker__item').forEach(function (el) {
      var tab = el.getAttribute('data-tab');
      var name = (el.getAttribute('data-name') || '').toLowerCase();
      el.style.display = (tab === _pickerTab && (!lq || name.indexOf(lq) !== -1)) ? '' : 'none';
    });
  }
  document.addEventListener('change', function (e) {
    if (!e.target.closest('.picker__item')) return;
    var picker = e.target.closest('.picker');
    if (!picker) return;
    var sel = picker.querySelector('.picker__selected');
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    picker.querySelectorAll('.picker__item input:checked').forEach(function (cb) {
      var labelText = cb.closest('.picker__item').querySelector('span').textContent;
      var tag = document.createElement('span');
      tag.className = 'picker__tag';
      tag.textContent = labelText + ' ';
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\u00d7';
      removeBtn.setAttribute('aria-label', 'Remove ' + labelText);
      removeBtn.addEventListener('click', function () { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
      tag.appendChild(removeBtn);
      sel.appendChild(tag);
    });
  });

  /* ── Mobile: tap card row → open view ──────────────────────────────── */
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 767) return;
    if (e.target.closest('button, a, input, select, textarea, .btn, [data-action]')) return;
    var row = e.target.closest('tbody tr');
    if (!row) return;
    var v = row.querySelector('[hx-get*="/view"], [hx-get*="/edit"], .btn--secondary');
    if (v) v.click();
  });

  /* ── Event Delegation ─────────────────────────────────────────────── */
  /* Click delegation for data-action attributes */
  document.addEventListener('click', function (e) {
    /* Handle data-stop-propagation */
    var stopEl = e.target.closest('[data-stop-propagation]');
    if (stopEl) {
      e.stopPropagation();
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;

    var action = el.getAttribute('data-action');
    var handler = handlers[action];
    if (handler) {
      handler(el, e);
    } else if (typeof window[action] === 'function') {
      /* Fall through to page-level functions exposed on window */
      window[action](el, e);
    }
  });

  /* Input delegation for data-action-input attributes */
  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-action-input]');
    if (!el) return;

    var action = el.getAttribute('data-action-input');
    var handler = handlers[action];
    if (handler) {
      handler(el, e);
    } else if (typeof window[action] === 'function') {
      window[action](el, e);
    }
  });

  /* Change delegation for data-action-change attributes */
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-action-change]');
    if (!el) return;

    var action = el.getAttribute('data-action-change');
    var handler = handlers[action];
    if (handler) {
      handler(el, e);
    } else if (typeof window[action] === 'function') {
      window[action](el, e);
    }
  });

  /* ── Handlers ─────────────────────────────────────────────────────── */
  var handlers = {
    toggleSidebar: function () { toggleSidebar(); },
    closeSidebar: function () { closeSidebar(); },
    closeModal: function () { closeModal(); },

    /* Close modal with delay (for HTMX actions that need time to complete) */
    closeModalDelayed: function () {
      setTimeout(function () { closeModal(); }, 600);
    },

    /* Picker tabs */
    pickerTab: function (el) {
      var tab = el.getAttribute('data-tab');
      pickerTab(tab, el);
    },

    /* Picker search */
    pickerSearch: function (el) {
      pickerSearch(el.value);
    },

    /* Concurrency slider */
    concurrencySlider: function (el) {
      var output = document.getElementById('concurrency-value');
      if (output) output.textContent = el.value;
    },

    /* Sidebar form auto-submit */
    formAutoSubmit: function (el) {
      var form = el.closest('form');
      if (form) form.submit();
    },

    /* Compare checkbox update */
    cmpUpdateBtn: function () {
      if (typeof window.cmpUpdateBtn === 'function') window.cmpUpdateBtn();
    },

    /* Bookmarklet drag alert */
    bookmarkletAlert: function (el, e) {
      e.preventDefault();
      var msg = el.getAttribute('data-alert-msg');
      alert(msg);
    },

    /* Print page */
    printPage: function () { window.print(); },

    /* Close window */
    closeWindow: function () { window.close(); },

    /* ── Report Detail actions ─────────────────────────────────────── */
    rptSwitchTab: function (el) {
      var tab = el.getAttribute('data-tab');
      if (typeof window.rptSwitchTab === 'function') window.rptSwitchTab(tab);
    },

    rptToggleGroup: function (el) {
      /* el is the header div itself (or a child). Find .rpt-group__header */
      var header = el.closest('.rpt-group__header') || el;
      if (typeof window.rptToggleGroup === 'function') window.rptToggleGroup(header);
    },

    rptTogglePage: function (el) {
      var header = el.closest('.rpt-page__header') || el;
      if (typeof window.rptTogglePage === 'function') window.rptTogglePage(header);
    },

    rptToggleBulkMode: function () {
      if (typeof window.rptToggleBulkMode === 'function') window.rptToggleBulkMode();
    },

    rptBulkAssign: function () {
      if (typeof window.rptBulkAssign === 'function') window.rptBulkAssign();
    },

    rptBulkUpdate: function (el, e) {
      e.stopPropagation();
      if (typeof window.rptBulkUpdate === 'function') window.rptBulkUpdate();
    },

    rptBulkToggleAll: function (el) {
      if (typeof window.rptBulkToggleAll === 'function') window.rptBulkToggleAll(el.checked);
    },

    rptSearchIssues: function (el) {
      if (typeof window.rptSearchIssues === 'function') window.rptSearchIssues(el.value);
    },

    rptSearchPages: function (el) {
      if (typeof window.rptSearchPages === 'function') window.rptSearchPages(el.value);
    },

    rptAssignIssue: function (el) {
      if (typeof window.rptAssignIssue !== 'function') return;
      var code = el.getAttribute('data-code') || '';
      var selector = el.getAttribute('data-selector') || '';
      var message = el.getAttribute('data-message') || '';
      var severity = el.getAttribute('data-severity') || '';
      var wcagCriterion = el.getAttribute('data-wcag-criterion') || '';
      var wcagTitle = el.getAttribute('data-wcag-title') || '';
      window.rptAssignIssue(el, code, selector, message, severity, wcagCriterion, wcagTitle);
    },

    /* ── Compare tab switching ─────────────────────────────────────── */
    cmpSwitchTab: function (el) {
      var tab = el.getAttribute('data-tab');
      if (typeof window.cmpSwitchTab === 'function') window.cmpSwitchTab(tab, el);
    },

    /* ── Compare navigate ──────────────────────────────────────────── */
    cmpNavigate: function () {
      if (typeof window.cmpNavigate === 'function') window.cmpNavigate();
    },

    /* ── Manual test actions ───────────────────────────────────────── */
    mtFilter: function (el) {
      var status = el.getAttribute('data-status');
      if (typeof window.mtFilter === 'function') window.mtFilter(status, el);
    },

    mtToggle: function (el) {
      if (typeof window.mtToggle === 'function') window.mtToggle(el);
    },

    mtSave: function (el) {
      var scanId = el.getAttribute('data-scan-id');
      var testId = el.getAttribute('data-test-id');
      var status = el.getAttribute('data-status');
      if (typeof window.mtSave === 'function') window.mtSave(scanId, testId, status, el);
    },

    /* ── Assignment actions ────────────────────────────────────────── */
    asgnFilter: function (el) {
      var status = el.getAttribute('data-status');
      if (typeof window.asgnFilter === 'function') window.asgnFilter(status, el);
    },

    asgnToggleBulkMode: function () {
      if (typeof window.asgnToggleBulkMode === 'function') window.asgnToggleBulkMode();
    },

    asgnBulkReassign: function () {
      if (typeof window.asgnBulkReassign === 'function') window.asgnBulkReassign();
    },

    asgnBulkRemove: function () {
      if (typeof window.asgnBulkRemove === 'function') window.asgnBulkRemove();
    },

    asgnBulkUpdate: function (el, e) {
      if (e) e.stopPropagation();
      if (typeof window.asgnBulkUpdate === 'function') window.asgnBulkUpdate();
    },

    asgnBulkToggleAll: function (el) {
      if (typeof window.asgnBulkToggleAll === 'function') window.asgnBulkToggleAll(el.checked);
    },

    asgnSave: function (el) {
      var id = el.getAttribute('data-id');
      if (typeof window.asgnSave === 'function') window.asgnSave(id, el);
    },

    asgnDelete: function (el) {
      var id = el.getAttribute('data-id');
      if (typeof window.asgnDelete === 'function') window.asgnDelete(id, el);
    },

    /* ── Fixes ─────────────────────────────────────────────────────── */
    copyFixCode: function (el) {
      var index = el.getAttribute('data-index');
      if (typeof window.copyFixCode === 'function') window.copyFixCode(parseInt(index, 10));
    }
  };

  /* ── Dark mode toggle — cycles: auto → light → dark → auto ────────── */
  function getThemePreference() {
    return localStorage.getItem('luqen-theme') || 'auto';
  }

  function applyTheme(pref) {
    var isDark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      var label = pref === 'auto' ? 'Auto' : pref === 'dark' ? 'Dark' : 'Light';
      btn.setAttribute('aria-label', 'Theme: ' + label + '. Click to change.');
      btn.setAttribute('title', 'Theme: ' + label);
      btn.textContent = pref === 'auto' ? '\u25D0' : isDark ? '\u263E' : '\u2600';
    }
  }

  function toggleTheme() {
    var current = getThemePreference();
    var next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
    localStorage.setItem('luqen-theme', next);
    applyTheme(next);
  }

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
    if (getThemePreference() === 'auto') applyTheme('auto');
  });

  document.addEventListener('DOMContentLoaded', function() {
    applyTheme(getThemePreference());
  });

  /* ── Sidebar collapse (desktop) — persists to localStorage ────────── */
  // Sidebar is always an overlay — no desktop collapse state needed

  /* ── Expose layout functions globally ─────────────────────────────── */
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.openSidebar = openSidebar;
  window.closeModal = closeModal;
  window.pickerTab = pickerTab;
  window.pickerSearch = pickerSearch;
  window.toggleTheme = toggleTheme;
  // toggleCollapse removed — sidebar is always overlay
})();
