// ocr.js — Client-side OCR for photos/screenshots (e.g. a WhatsApp
// confirmation screenshot), using Tesseract.js loaded lazily from a CDN.
// This is the "future OCR phase" the finance/documents modules were left
// prepared for: recognized text feeds into the same pt-BR parsers used for
// pasted text, so a screenshot works just like copy-pasting the message.
//
// Runs entirely in the user's browser — no image data is uploaded anywhere.
// iOS/Safari doesn't support the Web Share Target API (no PWA can appear in
// the native share sheet there), so this is the practical alternative for
// iPhone users: screenshot the message, pick the image in Fio.

const TESSERACT_CDN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let loadPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_CDN_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de imagem (sem conexão?).'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Recognizes text (Portuguese) in an image file. Returns the raw recognized
 * text. Throws on failure (network/CDN unreachable, decoding error) — callers
 * should catch and fall back to their existing manual/archive flow so a
 * failed OCR attempt never blocks or loses the user's upload.
 */
export async function recognizeImageText(file, { onProgress } = {}) {
  await loadTesseract();
  const { data } = await window.Tesseract.recognize(file, 'por', {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(m.progress);
      }
    },
  });
  return (data?.text || '').trim();
}
