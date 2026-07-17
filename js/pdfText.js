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
