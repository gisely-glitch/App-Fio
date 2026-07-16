// voice.js — Thin wrapper around the Web Speech API (SpeechRecognition) for
// pt-BR dictation. Feeds transcripts into the same NLP parser used for
// shared text, both for appointments and expenses.

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  return !!getRecognitionCtor();
}

/**
 * Starts a single-utterance pt-BR recognition session.
 * Returns a controller with `stop()` and a promise-returning `result` field
 * is not used directly — instead pass callbacks for streaming UI feedback.
 */
export function startListening({ onResult, onError, onEnd } = {}) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    onError?.(new Error('Reconhecimento de voz não é suportado neste navegador.'));
    return { stop: () => {} };
  }

  const recognition = new Ctor();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let finalTranscript = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += transcript;
      else interim += transcript;
    }
    onResult?.({ final: finalTranscript, interim });
  };

  recognition.onerror = (event) => {
    onError?.(new Error(`Erro no reconhecimento de voz: ${event.error}`));
  };

  recognition.onend = () => {
    onEnd?.(finalTranscript.trim());
  };

  try {
    recognition.start();
  } catch (e) {
    onError?.(e);
  }

  return { stop: () => recognition.stop() };
}
