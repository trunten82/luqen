/*
 * Phase 45 Plan 01 — agent tool-result renderer registry.
 *
 * Companion to agent.js. Registers structured renderers for high-value
 * dashboard tool outputs (scan reports, regulation tables, proposal diffs)
 * so the chat thread shows a tidy card instead of raw JSON. agent.js looks
 * up `window.__luqenAgent.toolRenderers[toolName]` on the `tool_completed`
 * SSE frame; missing entry or thrown renderer falls back to the legacy
 * JSON <pre> render path. AGENT-05 + AGENT-06.
 *
 * Security: createElement + textContent ONLY. NO innerHTML — DOMPurify is
 * not available here and the project security guard rejects it. Strings
 * placed into href/src attributes are stripped to plain http(s)/relative
 * URLs to avoid javascript: scheme abuse.
 *
 * LOC budget: agent.js stays at its 1500 ceiling; renderer logic lives in
 * this file so future renderers can be added without bloating agent.js.
 */
(function () {
  if (!window.__luqenAgent) window.__luqenAgent = {};
  var A = window.__luqenAgent;
  if (!A.toolRenderers) A.toolRenderers = {};

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = String(txt);
    return e;
  }

  // Strip non-http(s) hrefs (javascript:, data:, etc.) to prevent the agent
  // from being able to inject a clickable XSS vector via tool result text.
  function safeHref(raw) {
    if (typeof raw !== 'string') return '';
    var trimmed = raw.trim();
    if (trimmed.length === 0) return '';
    if (trimmed.charAt(0) === '/') return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return '';
  }

  function rawDetails(result) {
    var details = el('details', 'tool-result-card__raw');
    details.appendChild(el('summary', null, 'Show raw JSON'));
    var pre = el('pre', 'prompt-segment-content');
    try { pre.textContent = JSON.stringify(result, null, 2); }
    catch (_e) { pre.textContent = String(result); }
    details.appendChild(pre);
    return details;
  }

  // ── Scan card ────────────────────────────────────────────────────────
  // Matches the dashboard_scan_site response shape (data.ts ~L312-330):
  //   { scanId, status, url, standard, scanMode, regulations, jurisdictions }
  // and the dashboard_get_report shape (top-level { status, report? } where
  // report carries score + issues). Both flow through this renderer.
  function renderScanCard(result, container) {
    if (!result || typeof result !== 'object') throw new Error('scan: bad result');
    var card = el('div', 'tool-result-card tool-result-card--scan');
    var report = result.report || result;
    var siteUrl = result.url || report.url || report.siteUrl || '';
    var status = result.status || report.status || '';
    var score = report.score != null ? report.score : (result.score != null ? result.score : null);
    var issues = report.issues || result.issues || [];
    var scanId = result.scanId || report.scanId || report.id || '';

    var head = el('div', 'tool-result-card__head');
    if (siteUrl) head.appendChild(el('div', 'tool-result-card__site', siteUrl));
    if (status) head.appendChild(el('span', 'badge tool-result-card__status', status));
    card.appendChild(head);

    if (score != null && !isNaN(Number(score))) {
      card.appendChild(el('div', 'tool-result-card__score', String(score) + '/100'));
    }

    if (Array.isArray(issues) && issues.length > 0) {
      var ul = el('ul', 'tool-result-card__issues');
      issues.slice(0, 3).forEach(function (i) {
        var code = (i && (i.code || i.criterion || i.id)) || '';
        var count = (i && (i.count != null ? i.count : i.occurrences)) || '';
        ul.appendChild(el('li', null, count !== '' ? code + ' (' + count + ')' : String(code)));
      });
      card.appendChild(ul);
    }

    var href = safeHref(result.reportUrl || (scanId ? '/reports/' + encodeURIComponent(scanId) : ''));
    if (href) {
      var link = el('a', 'tool-result-card__link', 'View full report');
      link.setAttribute('href', href);
      card.appendChild(link);
    }

    card.appendChild(rawDetails(result));
    container.appendChild(card);
  }

  // ── Regulations table ────────────────────────────────────────────────
  // dashboard_list_regulations returns { data: [{id, name, jurisdictionId, ...}], meta }
  // dashboard_get_regulation returns a single regulation object.
  function renderRegulationsTable(result, container) {
    if (!result) throw new Error('regulations: empty result');
    var rows;
    if (Array.isArray(result)) rows = result;
    else if (Array.isArray(result.data)) rows = result.data;
    else if (Array.isArray(result.regulations)) rows = result.regulations;
    else if (result.id) rows = [result];
    else throw new Error('regulations: no rows');
    if (rows.length === 0) throw new Error('regulations: empty rows');

    var card = el('div', 'tool-result-card tool-result-card--regulations');
    var table = el('table', 'tool-result-table');
    var head = el('thead');
    var headRow = el('tr');
    ['ID', 'Name', 'Jurisdiction'].forEach(function (h) {
      headRow.appendChild(el('th', null, h));
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = el('tbody');
    rows.slice(0, 10).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, (r && r.id) || ''));
      tr.appendChild(el('td', null, (r && (r.name || r.shortName)) || ''));
      tr.appendChild(el('td', null, (r && (r.jurisdictionId || r.jurisdiction)) || ''));
      body.appendChild(tr);
    });
    table.appendChild(body);
    card.appendChild(table);

    if (rows.length > 10) {
      card.appendChild(el('div', 'tool-result-card__more', '+' + (rows.length - 10) + ' more'));
    }
    card.appendChild(rawDetails(result));
    container.appendChild(card);
  }

  // ── Proposals diff ───────────────────────────────────────────────────
  // dashboard_list_proposals (when added) returns proposals with a
  // proposedChanges.after.diff = { added: [], removed: [], modified: [] }
  // structure, each item being a string or { wcagCriterion, ... } object.
  function renderProposalsDiff(result, container) {
    if (!result) throw new Error('proposals: empty result');
    var rows;
    if (Array.isArray(result)) rows = result;
    else if (Array.isArray(result.data)) rows = result.data;
    else if (Array.isArray(result.proposals)) rows = result.proposals;
    else if (result.id || result.summary) rows = [result];
    else throw new Error('proposals: no rows');
    if (rows.length === 0) throw new Error('proposals: empty rows');

    var wrapper = el('div', 'tool-result-card tool-result-card--proposals');
    rows.slice(0, 5).forEach(function (p) {
      var card = el('div', 'tool-result-proposal');
      var headerText = (p.affectedRegulationId || p.regulationId || p.id || '');
      if (p.summary) headerText = headerText ? headerText + ' — ' + p.summary : String(p.summary);
      card.appendChild(el('div', 'tool-result-proposal__header', headerText));

      if (p.detectedAt) {
        card.appendChild(el('div', 'tool-result-proposal__date', String(p.detectedAt)));
      }

      var diff = (p.proposedChanges && p.proposedChanges.after && p.proposedChanges.after.diff)
        || p.diff
        || {};
      ['added', 'removed', 'modified'].forEach(function (kind) {
        var items = diff[kind];
        if (!Array.isArray(items) || items.length === 0) return;
        var col = el('div', 'tool-result-proposal__' + kind);
        col.appendChild(el('strong', null, kind));
        var ul = el('ul');
        items.slice(0, 5).forEach(function (item) {
          var label;
          if (typeof item === 'string') label = item;
          else if (item && typeof item === 'object') label = item.wcagCriterion || item.id || item.label || JSON.stringify(item);
          else label = String(item);
          ul.appendChild(el('li', null, label));
        });
        col.appendChild(ul);
        card.appendChild(col);
      });

      wrapper.appendChild(card);
    });
    wrapper.appendChild(rawDetails(result));
    container.appendChild(wrapper);
  }

  // 5 tool-name → renderer mappings (AGENT-05 + AGENT-06).
  A.toolRenderers.dashboard_scan_site = renderScanCard;
  A.toolRenderers.dashboard_get_scan = renderScanCard;
  A.toolRenderers.dashboard_list_regulations = renderRegulationsTable;
  A.toolRenderers.dashboard_get_regulation = renderRegulationsTable;
  A.toolRenderers.dashboard_list_proposals = renderProposalsDiff;

  // Export for tests / external diagnostics.
  A.toolRendererFns = {
    renderScanCard: renderScanCard,
    renderRegulationsTable: renderRegulationsTable,
    renderProposalsDiff: renderProposalsDiff,
  };
})();
