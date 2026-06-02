/* Phase 84 — agent-tts.js
 * Browser text-to-speech (voice output) for assistant responses, completing the
 * companion's bidirectional speech ("speech+text"). Uses the Web Speech API's
 * window.speechSynthesis — no provider, no cost. Feature-detected on load: if
 * absent the button stays hidden. The enabled/disabled preference persists in
 * localStorage. When enabled, agent.js calls speakIfEnabled(text) on the SSE
 * 'done' frame with the completed assistant text. No inline handlers — the
 * toggle click is delegated from agent.js to window.__luqenAgentTts.toggle(btn).
 */
(function () {
  'use strict';

  var TTS_BTN_ID = 'agent-tts';
  var STATUS_ID = 'agent-aria-status';
  var STORAGE_KEY = 'luqen.agent.tts';

  var enabled = false;

  function byId(id) { return document.getElementById(id); }
  function setStatus(t) { var el = byId(STATUS_ID); if (el) el.textContent = t; }
  function supported() { return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'; }

  function readPref() {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (_e) { return false; }
  }
  function writePref(on) {
    try { window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_e) { /* ignore */ }
  }

  function reflect(btn) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.setAttribute('aria-label', btn.getAttribute(enabled ? 'data-label-disable' : 'data-label-enable') || (enabled ? 'Stop reading responses aloud' : 'Read responses aloud'));
  }

  function cancelSpeaking() {
    try { if (supported()) window.speechSynthesis.cancel(); } catch (_e) { /* ignore */ }
  }

  function speakIfEnabled(text) {
    if (!enabled || !supported()) return;
    var clean = String(text == null ? '' : text).trim();
    if (clean.length === 0) return;
    // Strip obvious markdown noise so the spoken output is not littered with
    // asterisks / backticks / hashes.
    clean = clean.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').slice(0, 4000);
    try {
      cancelSpeaking();
      var u = new window.SpeechSynthesisUtterance(clean);
      u.lang = navigator.language || 'en-US';
      window.speechSynthesis.speak(u);
    } catch (_e) { /* ignore */ }
  }

  function toggle(btn) {
    if (!supported()) return;
    enabled = !enabled;
    writePref(enabled);
    reflect(btn);
    if (!enabled) { cancelSpeaking(); setStatus('Voice output off'); }
    else { setStatus('Voice output on'); }
  }

  function init() {
    var btn = byId(TTS_BTN_ID);
    if (!btn) return;
    if (!supported()) { btn.setAttribute('hidden', ''); return; }
    enabled = readPref();
    btn.removeAttribute('hidden');
    reflect(btn);
  }

  window.__luqenAgentTts = {
    toggle: toggle,
    speakIfEnabled: speakIfEnabled,
    isSupported: supported,
    isEnabled: function () { return enabled; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
