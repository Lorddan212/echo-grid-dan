'use strict';
(() => {
  function create() {
    let pending = null;
    const supported = typeof globalThis.speechSynthesis?.speak === 'function' && typeof globalThis.SpeechSynthesisUtterance === 'function';
    function cancel() {
      if (pending) pending(false);
      try { if (supported) speechSynthesis.cancel(); } catch { /* optional speech engine */ }
    }
    return {
      supported, cancel,
      speak(index) {
        cancel();
        if (!supported) return Promise.resolve(false);
        return new Promise(resolve => {
          let timer;
          const finish = ok => {
            if (pending !== finish) return;
            pending = null;
            clearTimeout(timer);
            resolve(ok);
          };
          pending = finish;
          timer = setTimeout(() => { finish(false); try { speechSynthesis.cancel(); } catch {} }, 4000);
          try {
            const utterance = new SpeechSynthesisUtterance(String(index + 1));
            utterance.lang = 'en';
            utterance.rate = 1;
            utterance.onend = () => finish(true);
            utterance.onerror = () => finish(false);
            speechSynthesis.speak(utterance);
          } catch { finish(false); }
        });
      },
    };
  }
  globalThis.EchoSpeech = { create };
})();
