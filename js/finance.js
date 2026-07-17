// finance.js — Fixed/variable expenses, cards, monthly provisioning, credit
// card invoice projection, and CSV/XML/PDF/image document import.

import { db, uid } from './db.js';
import { parseCSV, parseXML, parseExpenseText } from './parsers.js';
import { recognizeImageText } from './ocr.js';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function listCards() {
  return db.getAll('cards');
}

export async function createCard({ name, closingDay, dueDay }) {
  const card = { id: uid(), name, closingDay: closingDay || null, dueDay: dueDay || null };
  await db.put('cards', card);
  return card;
}

export async function deleteCard(id) {
  return db.delete('cards', id);
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
 * Handles any uploaded financial document. CSV/XML are parsed directly.
 * Images are run through client-side OCR (Tesseract.js, see ocr.js) and the
 * recognized text is fed into the same expense parser used for manual/voice
 * entry — this is the "future OCR phase" the original design left room for.
 * PDFs still just archive with parseStatus 'pending_ocr' (text extraction
 * from PDF needs a different library, e.g. PDF.js — not wired up yet).
 * Nothing is ever silently dropped; the caller always gets a clear result.
 */
export async function importFinancialDocument(file) {
  const fileType = guessFileType(file);
  const doc = {
    id: uid(),
    name: file.name,
    fileType,
    sizeKb: Math.round(file.size / 1024),
    parseStatus: 'pending_ocr',
    importedCount: 0,
    uploadedAt: new Date().toISOString(),
    blob: file,
  };

  let importedExpenses = [];
  let errors = [];

  if (fileType === 'csv') {
    const text = await file.text();
    const { rows, errors: csvErrors } = parseCSV(text);
    errors = csvErrors;
    importedExpenses = await Promise.all(rows.map((r) => createVariableExpense({
      desc: r.desc, value: r.value, date: r.date, category: 'importado', paymentMethod: 'cartao', source: 'csv_import',
    })));
    doc.parseStatus = rows.length > 0 ? 'parsed' : (errors.length > 0 ? 'unparsed' : 'parsed');
    doc.importedCount = importedExpenses.length;
  } else if (fileType === 'xml') {
    const text = await file.text();
    const { rows, errors: xmlErrors } = parseXML(text);
    errors = xmlErrors;
    importedExpenses = await Promise.all(rows.map((r) => createVariableExpense({
      desc: r.desc, value: r.value, date: r.date, category: 'importado', paymentMethod: 'cartao', source: 'xml_import',
    })));
    doc.parseStatus = rows.length > 0 ? 'parsed' : 'unparsed';
    doc.importedCount = importedExpenses.length;
  } else if (fileType === 'image') {
    try {
      const text = await recognizeImageText(file);
      const parsed = text ? parseExpenseText(text) : null;
      if (parsed?.value) {
        const expense = await createVariableExpense({
          desc: parsed.desc.slice(0, 120) || file.name,
          value: parsed.value,
          category: parsed.category || 'importado',
          paymentMethod: parsed.paymentMethod || 'cartao',
          source: 'ocr_import',
        });
        importedExpenses = [expense];
        doc.parseStatus = 'parsed';
        doc.importedCount = 1;
      } else {
        doc.parseStatus = 'unparsed';
        errors = ['Consegui ler a imagem, mas não encontrei um valor reconhecível no texto.'];
      }
    } catch (e) {
      // Network/CDN unreachable, decoding failure, etc. — keep it archived
      // and clearly pending, never lose the upload.
      doc.parseStatus = 'pending_ocr';
      errors = [e.message];
    }
  } else if (fileType === 'pdf') {
    doc.parseStatus = 'pending_ocr';
  } else {
    doc.parseStatus = 'manual';
  }

  await db.put('financialDocuments', doc);
  return { document: doc, importedExpenses, errors };
}

export async function deleteFinancialDocument(id) {
  return db.delete('financialDocuments', id);
}
