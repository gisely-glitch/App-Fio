// pdfText.js — Client-side PDF text extraction using PDF.js, loaded lazily
// from a CDN (same pattern as ocr.js). Completes the "future OCR phase" for
// PDF documents — a fatura/extrato PDF now gets its text read directly
// (PDFs almost always have a real text layer, unlike a photo), which is
// fed into the same pt-BR expense parser used everywhere else.
//
// Runs entirely in the user's browser — the PDF is never uploaded anywhere.
// Note: a PDF that's just a scanned photo with no text layer will return
// empty/near-empty text; callers should treat that the same as "couldn't
// find a value" rather than a hard error.

const PDFJS_VERSION = '3.11.174';
const PDFJS_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

let loadPromise = null;

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve();
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de PDF (sem conexão?).'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

const MAX_PAGES = 5; // faturas/recibos raramente passam disso; evita travar em PDFs enormes
const MAX_OCR_PAGES = 8; // OCR fallback is much slower per page — a bit more headroom, still capped

/** Extracts and concatenates text from the first pages of a PDF file. */
export async function extractPdfText(file) {
  await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pageTexts = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(' '));
  }
  return pageTexts.join('\n').trim();
}

/**
 * Renders one PDF page to a PNG Blob (image), for when the PDF's embedded
 * text layer can't be trusted.
 *
 * Some PDF generators embed a font with a broken/non-standard character
 * encoding — the text is there, but extracting it yields garbage like "$4
 * 2J102,)%" instead of "R$ 2.102,79" (real example: a Mercado Pago invoice).
 * No amount of parsing logic recovers correct data from already-corrupted
 * characters — the only way to actually read a PDF like that is to render
 * the page as a picture and OCR it, the same as a photo.
 */
async function renderPdfPageToBlob(pdf, pageNumber, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * OCR fallback for a PDF: renders each page (up to MAX_OCR_PAGES) as an
 * image and runs it through the same Tesseract pipeline used for photos
 * (see ocr.js), concatenating the recognized text. Slow (each page is a
 * full OCR pass) — callers should only reach for this when direct text
 * extraction didn't produce anything usable, and should surface progress
 * to the user since a multi-page invoice can take a while.
 */
export async function ocrPdfPages(file, { onProgress } = {}) {
  const { recognizeImageText } = await import('./ocr.js');
  await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_OCR_PAGES);

  const pageTexts = [];
  for (let i = 1; i <= pageCount; i++) {
    onProgress?.({ page: i, totalPages: pageCount });
    const blob = await renderPdfPageToBlob(pdf, i);
    const text = await recognizeImageText(blob);
    pageTexts.push(text);
  }
  return pageTexts.join('\n').trim();
}
