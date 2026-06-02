/* Phase 83 — agent-images.js
 * Multimodal image attachments for the agent companion composer. Images are
 * base64-encoded client-side (the data: prefix is stripped) and held in a
 * staging tray until the next /agent/message submit. agent.js reads them via
 * window.__luqenAgentImages on htmx:configRequest and serialises them into the
 * `imagesJson` form field (urlencoded-safe). Caps mirror the server
 * (routes/agent.ts): ≤4 images, ≤~5 MB each, png/jpeg/webp/gif. Validation here
 * is UX-only — the server re-validates. No inline handlers (CSP-strict).
 */
(function () {
  'use strict';

  var IMAGE_INPUT_ID = 'agent-image-input';
  var ATTACH_BTN_ID = 'agent-attach';
  var ATTACHMENTS_ID = 'agent-attachments';
  var INPUT_ID = 'agent-input';
  var ARIA_LIVE_ID = 'agent-aria-live';
  var MAX_IMAGES = 4;
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var ALLOWED_IMAGE_TYPES = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };

  var stagedImages = []; // { id, mediaType, data, name }
  var imagesI18n = null;

  function byId(id) { return document.getElementById(id); }

  // Minimal aria-live announce (clear-then-set forces SR re-announcement),
  // matching agent.js's #agent-aria-live region.
  function announce(message) {
    var el = byId(ARIA_LIVE_ID);
    if (!el) return;
    el.textContent = '';
    window.setTimeout(function () { el.textContent = message; }, 30);
  }

  function imageStr(key, vars) {
    if (imagesI18n === null) {
      imagesI18n = {};
      var el = byId('agent-images-i18n');
      if (el) { try { imagesI18n = JSON.parse(el.textContent || '{}'); } catch (_e) { imagesI18n = {}; } }
    }
    var s = imagesI18n[key] || key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.replace('__' + k.toUpperCase() + '__', String(vars[k]));
      }
    }
    return s;
  }

  function renderAttachments() {
    var box = byId(ATTACHMENTS_ID);
    if (!box) return;
    box.textContent = '';
    if (stagedImages.length === 0) { box.setAttribute('hidden', ''); return; }
    box.removeAttribute('hidden');
    for (var i = 0; i < stagedImages.length; i++) {
      var img = stagedImages[i];
      var item = document.createElement('span');
      item.className = 'agent-attachment';
      item.setAttribute('role', 'listitem');
      var thumb = document.createElement('img');
      thumb.className = 'agent-attachment__thumb';
      thumb.src = 'data:' + img.mediaType + ';base64,' + img.data;
      thumb.alt = img.name || '';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'agent-attachment__remove';
      rm.setAttribute('aria-label', imageStr('remove'));
      rm.setAttribute('data-image-id', img.id);
      rm.textContent = '×';
      item.appendChild(thumb);
      item.appendChild(rm);
      box.appendChild(item);
    }
  }

  function stageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var errored = null;
    function next() {
      if (files.length === 0) {
        renderAttachments();
        if (errored) announce(errored);
        return;
      }
      var file = files.shift();
      if (!ALLOWED_IMAGE_TYPES[file.type]) { errored = imageStr('badType'); next(); return; }
      if (file.size > MAX_IMAGE_BYTES) { errored = imageStr('tooLarge'); next(); return; }
      if (stagedImages.length >= MAX_IMAGES) { errored = imageStr('capExceeded', { max: MAX_IMAGES }); next(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        var comma = result.indexOf(',');
        var data = comma >= 0 ? result.slice(comma + 1) : '';
        if (data.length > 0) {
          stagedImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            mediaType: file.type,
            data: data,
            name: file.name,
          });
        }
        next();
      };
      reader.onerror = function () { errored = imageStr('badType'); next(); };
      reader.readAsDataURL(file);
    }
    next();
  }

  function wire() {
    var btn = byId(ATTACH_BTN_ID);
    var fileInput = byId(IMAGE_INPUT_ID);
    var box = byId(ATTACHMENTS_ID);
    var composer = byId(INPUT_ID);
    if (!btn || !fileInput || btn.getAttribute('data-images-wired') === '1') return;
    btn.setAttribute('data-images-wired', '1');
    btn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { stageFiles(fileInput.files); fileInput.value = ''; });
    if (box) {
      box.addEventListener('click', function (e) {
        var rm = e.target && e.target.closest ? e.target.closest('.agent-attachment__remove') : null;
        if (!rm) return;
        var id = rm.getAttribute('data-image-id');
        stagedImages = stagedImages.filter(function (img) { return img.id !== id; });
        renderAttachments();
      });
    }
    if (composer) {
      composer.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        var imgs = [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && String(items[i].type).indexOf('image/') === 0) {
            var f = items[i].getAsFile();
            if (f) imgs.push(f);
          }
        }
        if (imgs.length > 0) { e.preventDefault(); stageFiles(imgs); }
      });
    }
  }

  window.__luqenAgentImages = {
    // Returns the staged images in the @luqen/llm ImageInput shape.
    getStaged: function () {
      return stagedImages.map(function (img) { return { mediaType: img.mediaType, data: img.data }; });
    },
    hasStaged: function () { return stagedImages.length > 0; },
    clear: function () { stagedImages = []; renderAttachments(); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
