/* Phase 32 Plan 07 — agent-speech.js
 * Web Speech API wiring (AGENT-03) split out of agent.js to keep each file
 * under the 450-LOC ceiling noted in UI-SPEC. Feature-detects
 * SpeechRecognition on DOMContentLoaded: if absent (e.g. Firefox) the speech
 * button stays hidden and a form-hint surfaces the reason. If present the
 * button is revealed and wired for tap-to-start / tap-to-stop (D-34) —
 * transcription populates the textarea but NEVER auto-submits (UI-SPEC
 * Surface 1 Acceptance #6). navigator.language drives recognition.lang with
 * an 'en-US' fallback (D-32). No inline handlers — click is handled via
 * agent.js delegation that calls window.__luqenAgentSpeech.toggle(btn).
 */
(function () {
  'use strict';

  var SPEECH_BTN_ID = 'agent-speech';
  var INPUT_ID = 'agent-input';
  var FORM_ID = 'agent-form';
  var STATUS_ID = 'agent-aria-status';

  var recognition = null;
  var listening = false;

  function byId(id) { return document.getElementById(id); }
  function setStatus(t) { var el = byId(STATUS_ID); if (el) el.textContent = t; }

  function showSpeechHint(message) {
    var form = byId(FORM_ID); if (!form || !form.parentNode) return null;
    var existing = form.parentNode.querySelector('.agent-speech-hint');
    if (existing) { existing.textContent = message; return existing; }
    var hint = document.createElement('p');
    hint.className = 'form-hint agent-speech-hint';
    hint.textContent = message;
    form.parentNode.insertBefore(hint, form);
    return hint;
  }

  function transientSpeechHint(message, ms) {
    var hint = showSpeechHint(message);
    if (!hint) return;
    setTimeout(function () { if (hint && hint.parentNode) hint.parentNode.removeChild(hint); }, ms || 5000);
  }

  function detect() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

  function initSpeech() {
    var SR = detect();
    var btn = byId(SPEECH_BTN_ID); if (!btn) return;
    if (!SR) {
      btn.setAttribute('hidden', '');
      showSpeechHint('Voice input is not supported in this browser. Type your message below.');
      return;
    }
    btn.removeAttribute('hidden');
  }

  function startSpeech(btn, SR) {
    try {
      recognition = new SR();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = function (event) {
        var input = byId(INPUT_ID); if (!input) return;
        var combined = '';
        for (var i = 0; i < event.results.length; i++) {
          combined += event.results[i][0].transcript;
        }
        // Populate — NEVER auto-submit.
        input.value = combined;
      };
      recognition.onend = function () {
        listening = false;
        if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Start voice input'); }
        recognition = null;
      };
      recognition.onerror = function () {
        listening = false;
        if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Start voice input'); }
        transientSpeechHint('Could not capture audio. Try again or type your message.', 5000);
      };
      recognition.start();
      listening = true;
      if (btn) { btn.setAttribute('aria-pressed', 'true'); btn.setAttribute('aria-label', 'Stop voice input'); }
      setStatus('Listening…');
    } catch (_e) {
      listening = false;
      transientSpeechHint('Could not start voice input.', 5000);
    }
  }

  function stopSpeech(btn) {
    try { if (recognition) recognition.stop(); } catch (_e) { /* ignore */ }
    listening = false;
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Start voice input'); }
  }

  function toggleSpeech(btn) {
    var SR = detect();
    if (!SR) return;
    if (listening) { stopSpeech(btn); return; }
    startSpeech(btn, SR);
  }

  // Expose toggle for agent.js click-delegation (both scripts load with `defer`
  // so definition order matches script-tag order: agent-speech.js must appear
  // BEFORE agent.js in main.hbs).
  window.__luqenAgentSpeech = { toggle: toggleSpeech, isSupported: function () { return !!detect(); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSpeech);
  } else {
    initSpeech();
  }
})();
