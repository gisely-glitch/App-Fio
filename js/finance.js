// finance.js — Fixed/variable expenses, cards, monthly provisioning, credit
// card invoice projection, and CSV/XML/PDF/image document import.

import { db, uid } from './db.js';
import { parseCSV, parseXML, parseExpenseText, parseStatementText, looksLikeStatement } from './parsers.js';
import { recognizeImageText } from './ocr.js';
import { extractPdfText } from './pdfText.js';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function listCards() {
  return db.getAll('cards');
}

export async function createCard({ name, closingDay, dueDay, lastFourDigits }) {
  const card = {
    id: uid(),
    name,
    closingDay: closingDay || null,
    dueDay: dueDay || null,
    lastFourDigits: lastFourDigits ? String(lastFourDigits).replace(/\D/g, '').slice(0, 4) || null : null,
  };
  await db.put('cards', card);
  return card;
}

export async function updateCard(card) {
  await db.put('cards', card);
  return card;
}

export async function deleteCard(id) {
  return db.delete('cards', id);
}

/**
 * Looks for a card reference in imported text ("final 1234", "•••• 1234",
 * "cartão 1234", a bare 4-digit group near the word "cartão", etc.) and
 * matches it against registered cards' last-4-digits — so a statement/
 * invoice import can auto-route to the right card instead of always
 * landing unassigned. Returns the matching card's id, or null.
 */
export async function matchCardByDigits(text) {
  if (!text) return null;
  const cards = await listCards();
  const withDigits = cards.filter((c) => c.lastFourDigits);
  if (withDigits.length === 0) return null;

  // Prefer digit groups that appear near obvious card-reference language,
  // but fall back to any standalone 4-digit group masked by bullets/asterisks
  // (a very common way card numbers are partially shown: "•••• 1234").
  const contextRe = /(?:final|terminad[ao] em|cart[ãa]o)\D{0,12}(\d{4})\b/gi;
  const maskedRe = /[•*x]{2,}\s*(\d{4})\b/gi;

  const candidates = [
    ...[...text.matchAll(contextRe)].map((m) => m[1]),
    ...[...text.matchAll(maskedRe)].map((m) => m[1]),
  ];

  for (const digits of candidates) {
    const match = withDigits.find((c) => c.lastFourDigits === digits);
    if (match) return match.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixed expenses (recurring provisions)
// ---------------------------------------------------------------------------

export async function listFixedExpenses() {
  return db.getAll('fixedExpenses');
}

export async function createFixedExpense({ label, value, dueDay, isCreditCard, cardId, active = true }) {
  const expense = { id: uid(), label, value: Number(value), dueDay: Number(dueDay), isCreditCard: !!isCreditCard, cardId: cardId || null, active };
  await db.put('fixedExpenses', expense);
  return expense;
}

export async function updateFixedExpense(expense) {
  await db.put('fixedExpenses', expense);
  return expense;
}

export async function deleteFixedExpense(id) {
  return db.delete('fixedExpenses', id);
}

/** Sum of all active fixed expenses — the provisioned total for any month, before anything is actually paid. */
export async function monthlyProvision() {
  const fixed = await listFixedExpenses();
  return fixed.filter((f) => f.active !== false).reduce((sum, f) => sum + f.value, 0);
}

/** Fixed expenses whose due day is within `withinDays` of today — used for reminder alerts. */
export async function getFixedExpensesDueSoon(withinDays = 3) {
  const fixed = await listFixedExpenses();
  const today = new Date().getDate();
  return fixed.filter((f) => {
    if (f.active === false) return false;
    const diff = f.dueDay - today;
    return diff >= 0 && diff <= withinDays;
  });
}

// ---------------------------------------------------------------------------
// Variable expenses (day-to-day spend)
// ---------------------------------------------------------------------------

export async function listVariableExpenses({ month = null, category = null } = {}) {
  let all = await db.getAll('variableExpenses');
  if (month) all = all.filter((e) => e.date.startsWith(month)); // month = 'YYYY-MM'
  if (category) all = all.filter((e) => e.category === category);
  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function createVariableExpense({ desc, value, category, paymentMethod, cardId, date, source }) {
  const expense = {
    id: uid(),
    desc: desc || 'Gasto',
    value: Number(value) || 0,
    category: category || 'outros',
    paymentMethod: paymentMethod || 'dinheiro',
    cardId: paymentMethod === 'cartao' ? (cardId || null) : null,
    date: date || isoDate(new Date()),
    source: source || 'manual',
  };
  await db.put('variableExpenses', expense);
  return expense;
}

export async function updateVariableExpense(expense) {
  await db.put('variableExpenses', expense);
  return expense;
}

export async function deleteVariableExpense(id) {
  return db.delete('variableExpenses', id);
}

// ---------------------------------------------------------------------------
// Credit card invoice projection
// ---------------------------------------------------------------------------

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Projects the current invoice for a given card: all variable expenses paid
 * on that card during the current calendar cycle (month, as a simple
 * approximation — no bank/open-finance integration in this version) plus any
 * fixed expenses flagged isCreditCard and assigned to that card.
 */
export async function projectCardInvoice(cardId, monthISO = null) {
  const month = monthISO || isoDate(new Date()).slice(0, 7);
  const variable = await listVariableExpenses({ month });
  const cardVariable = variable.filter((e) => e.paymentMethod === 'cartao' && e.cardId === cardId);
  const fixed = await listFixedExpenses();
  const cardFixed = fixed.filter((f) => f.active !== false && f.isCreditCard && f.cardId === cardId);

  const variableTotal = cardVariable.reduce((s, e) => s + e.value, 0);
  const fixedTotal = cardFixed.reduce((s, f) => s + f.value, 0);

  return {
    cardId,
    month,
    variableItems: cardVariable,
    fixedItems: cardFixed,
    variableTotal,
    fixedTotal,
    total: variableTotal + fixedTotal,
  };
}

export async function projectAllCardInvoices(monthISO = null) {
  const cards = await listCards();
  return Promise.all(cards.map((c) => projectCardInvoice(c.id, monthISO)));
}

// ---------------------------------------------------------------------------
// Consolidated monthly view
// ---------------------------------------------------------------------------

export async function consolidatedMonth(monthISO = null) {
  const month = monthISO || isoDate(new Date()).slice(0, 7);
  const fixedTotal = await monthlyProvision();
  const variable = await listVariableExpenses({ month });
  const nonCardVariableTotal = variable.filter((e) => e.paymentMethod !== 'cartao').reduce((s, e) => s + e.value, 0);
  const cardProjections = await projectAllCardInvoices(month);
  const cardsTotal = cardProjections.reduce((s, p) => s + p.total, 0);
  const variableTotal = variable.reduce((s, e) => s + e.value, 0);

  // grandTotal = every active fixed expense + every variable expense, each
  // counted exactly once. cardProjections/cardsTotal is a *breakdown* of the
  // card-tagged slice of those same totals (by card), not an addition on top
  // of them — a fixed expense flagged isCreditCard is already inside
  // fixedTotal, and a 'cartao' variable expense is already inside
  // variableTotal, whether or not it ended up assigned to a specific
  // existing card (e.g. a CSV/XML import with no card chosen yet).
  return {
    month,
    fixedTotal,
    variableTotal,
    nonCardVariableTotal,
    cardProjections,
    cardsTotal,
    grandTotal: fixedTotal + variableTotal,
  };
}

// ---------------------------------------------------------------------------
// Document import: CSV / XML (real parsing) and PDF / image (archive only)
// ---------------------------------------------------------------------------

export async function listFinancialDocuments() {
  const docs = await db.getAll('financialDocuments');
  return docs.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

function guessFileType(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.csv') || file.type.includes('csv')) return 'csv';
  if (name.endsWith('.xml') || file.type.includes('xml')) return 'xml';
  if (name.endsWith('.pdf') || file.type.includes('pdf')) return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  return 'outro';
}

/**
 * Turns recognized text (from OCR or PDF text extraction) into one or more
 * VariableExpense records. Shared by the image and PDF branches of
 * importFinancialDocument below — same parsers, same "never silently drop
 * it" contract either way.
 *
 * Tries statement mode first: a photo of a bank/wallet extract has several
 * transaction rows, and grabbing just the first number in the whole blob
 * (the single-receipt heuristic) produces a wrong, meaningless import — it
 * did exactly that on a real user statement, twice, before this safety net
 * existed. So: if the text *looks* like a statement (several dates, or
 * words like "extrato"/"saldo"/"movimentos") but parseStatementText can't
 * confidently pull out real rows, this refuses to guess with the
 * single-value fallback — that fallback is only safe for text that doesn't
 * look like a statement in the first place (an actual single receipt).
 */
async function importExpenseFromText(text, source) {
  const cardId = await matchCardByDigits(text);

  const statementRows = text ? parseStatementText(text) : [];
  if (statementRows.length > 0) {
    const importedExpenses = await Promise.all(statementRows.map((r) => createVariableExpense({
      desc: r.desc, value: r.value, date: r.date, category: 'importado', paymentMethod: 'cartao', cardId, source,
    })));
    return { parseStatus: 'parsed', importedExpenses, errors: [] };
  }

  if (text && looksLikeStatement(text)) {
    return {
      parseStatus: 'unparsed',
      importedExpenses: [],
      errors: ['Este documento parece ser um extrato com várias transações, mas não consegui separar as linhas com confiança. Tente exportar CSV do banco, ou lance os gastos manualmente.'],
    };
  }

  const parsed = text ? parseExpenseText(text) : null;
  if (parsed?.value) {
    const expense = await createVariableExpense({
      desc: parsed.desc.slice(0, 120) || 'Importado',
      value: parsed.value,
      category: parsed.category || 'importado',
      paymentMethod: parsed.paymentMethod || 'cartao',
      cardId,
      source,
    });
    return { parseStatus: 'parsed', importedExpenses: [expense], errors: [] };
  }
  return {
    parseStatus: 'unparsed',
    importedExpenses: [],
    errors: ['Consegui ler o arquivo, mas não encontrei um valor reconhecível no texto.'],
  };
}

/**
 * Handles any uploaded financial document. CSV/XML are parsed directly.
 * Images go through client-side OCR (Tesseract.js, see ocr.js) and PDFs
 * through direct text extraction (PDF.js, see pdfText.js) — both feed the
 * recognized text into the same expense parser used for manual/voice entry.
 * This is the "future OCR phase" the original design left room for.
 * Nothing is ever silently dropped; the caller always gets a clear result.
 */
/**
 * Runs OCR (image) or text extraction (PDF) on a file and turns the result
 * into a VariableExpense if possible. Returns the outcome to merge into a
 * financialDocuments record — shared by importFinancialDocument (first
 * upload) and retryDocumentImport (re-attempting a previously failed one,
 * without asking the user to re-pick the file).
 */
async function runAutoImport(fileType, file) {
  try {
    const text = fileType === 'image' ? await recognizeImageText(file) : await extractPdfText(file);
    const source = fileType === 'image' ? 'ocr_import' : 'pdf_import';
    const { parseStatus, importedExpenses, errors } = await importExpenseFromText(text, source);
    return { parseStatus, importedExpenses, errors, ocrError: null };
  } catch (e) {
    // Network/CDN unreachable, decoding failure, encrypted/corrupt file, etc.
    // Keep it archived and clearly pending — never lose the upload.
    return { parseStatus: 'pending_ocr', importedExpenses: [], errors: [e.message], ocrError: e.message };
  }
}

export async function importFinancialDocument(file) {
  const fileType = guessFileType(file);
  const doc = {
    id: uid(),
    name: file.name,
    fileType,
    sizeKb: Math.round(file.size / 1024),
    parseStatus: 'pending_ocr',
    importedCount: 0,
    ocrError: null,
    uploadedAt: new Date().toISOString(),
    blob: file,
  };

  let importedExpenses = [];
  let errors = [];

  if (fileType === 'csv') {
    const text = await file.text();
    const { rows, errors: csvErrors } = parseCSV(text);
    errors = csvErrors;
    const cardId = await matchCardByDigits(text);
    importedExpenses = await Promise.all(rows.map((r) => createVariableExpense({
      desc: r.desc, value: r.value, date: r.date, category: 'importado', paymentMethod: 'cartao', cardId, source: 'csv_import',
    })));
    doc.parseStatus = rows.length > 0 ? 'parsed' : (errors.length > 0 ? 'unparsed' : 'parsed');
    doc.importedCount = importedExpenses.length;
  } else if (fileType === 'xml') {
    const text = await file.text();
    const { rows, errors: xmlErrors } = parseXML(text);
    errors = xmlErrors;
    const cardId = await matchCardByDigits(text);
    importedExpenses = await Promise.all(rows.map((r) => createVariableExpense({
      desc: r.desc, value: r.value, date: r.date, category: 'importado', paymentMethod: 'cartao', cardId, source: 'xml_import',
    })));
    doc.parseStatus = rows.length > 0 ? 'parsed' : 'unparsed';
    doc.importedCount = importedExpenses.length;
  } else if (fileType === 'image' || fileType === 'pdf') {
    const result = await runAutoImport(fileType, file);
    doc.parseStatus = result.parseStatus;
    doc.ocrError = result.ocrError;
    importedExpenses = result.importedExpenses;
    errors = result.errors;
    doc.importedCount = importedExpenses.length;
  } else {
    doc.parseStatus = 'manual';
  }

  await db.put('financialDocuments', doc);
  return { document: doc, importedExpenses, errors };
}

/**
 * Re-attempts OCR/text-extraction for a document that previously ended up
 * `pending_ocr` (e.g. the CDN was unreachable at the time) — reuses the
 * file blob already stored locally, no re-upload needed.
 */
export async function retryDocumentImport(docId) {
  const doc = await db.get('financialDocuments', docId);
  if (!doc || (doc.fileType !== 'image' && doc.fileType !== 'pdf')) return null;

  const result = await runAutoImport(doc.fileType, doc.blob);
  doc.parseStatus = result.parseStatus;
  doc.ocrError = result.ocrError;
  doc.importedCount = result.importedExpenses.length;
  await db.put('financialDocuments', doc);
  return { document: doc, importedExpenses: result.importedExpenses, errors: result.errors };
}

export async function deleteFinancialDocument(id) {
  return db.delete('financialDocuments', id);
}
