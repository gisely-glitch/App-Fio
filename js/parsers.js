// parsers.js — pt-BR natural language parsing for captured text (share/voice),
// plus real CSV and XML parsers for financial document import.

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'];
const WEEKDAY_INDEX = {
  domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6,
};
const MONTHS = {
  janeiro: 0, fevereiro: 1, março: 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const TYPE_KEYWORDS = [
  { type: 'exame', words: ['exame', 'ultrassom', 'raio-x', 'raio x', 'ressonância', 'ressonancia', 'tomografia', 'sangue', 'coleta'] },
  { type: 'consulta', words: ['consulta', 'médico', 'medico', 'dentista', 'dermatologista', 'cardiologista', 'psicólogo', 'psicologo', 'pediatra', 'oftalmo'] },
  { type: 'reuniao', words: ['reunião', 'reuniao', 'call', 'meeting', 'apresentação', 'apresentacao'] },
];

function normalize(text) {
  return text.toLowerCase();
}

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Parses free-form pt-BR text and tries to extract a date, a time, an
 * appointment type and a short title. Never throws — returns partial matches
 * with a `confidence` flag so the UI can ask the user to confirm/fill gaps.
 */
export function parseAppointmentText(rawText, referenceDate = new Date()) {
  const text = normalize(rawText || '');
  const result = {
    title: rawText ? rawText.trim().split('\n')[0].slice(0, 80) : '',
    date: null, // 'YYYY-MM-DD'
    time: null, // 'HH:MM'
    type: 'outro',
    matchedDate: false,
    matchedTime: false,
  };

  // ---- Type detection ----
  for (const { type, words } of TYPE_KEYWORDS) {
    if (words.some((w) => stripAccents(text).includes(stripAccents(w)))) {
      result.type = type;
      break;
    }
  }

  // ---- Date detection ----
  // Matched against the accent-stripped text: JS regex \b treats accented
  // letters (ã, é, ...) as non-word characters, so a literal "amanhã" would
  // silently fail to satisfy a trailing \b — stripping accents first keeps
  // word boundaries meaningful.
  const flatText = stripAccents(text);
  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);

  if (/\bhoje\b/.test(flatText)) {
    result.date = toISODate(ref);
    result.matchedDate = true;
  } else if (/depois de amanha/.test(flatText)) {
    result.date = toISODate(addDays(ref, 2));
    result.matchedDate = true;
  } else if (/\bamanha\b/.test(flatText)) {
    result.date = toISODate(addDays(ref, 1));
    result.matchedDate = true;
  } else {
    // dd/mm or dd/mm/yyyy
    const dmy = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    // "15 de julho" or "dia 15 de julho"
    const dayMonthName = flatText.match(/\bdia\s+(\d{1,2})|(\d{1,2})\s+de\s+([a-z]+)/);
    // weekday, optionally "que vem"/"próxima"
    const weekdayMatch = flatText.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/);

    if (dmy) {
      const day = parseInt(dmy[1], 10);
      const month = parseInt(dmy[2], 10) - 1;
      let year = ref.getFullYear();
      if (dmy[3]) {
        year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10);
      }
      const d = new Date(year, month, day);
      if (!isNaN(d)) {
        result.date = toISODate(d);
        result.matchedDate = true;
      }
    } else if (dayMonthName && dayMonthName[3]) {
      const day = parseInt(dayMonthName[2], 10);
      const monthName = dayMonthName[3];
      const monthIdx = MONTHS[monthName];
      if (monthIdx !== undefined) {
        let year = ref.getFullYear();
        const d = new Date(year, monthIdx, day);
        if (d < ref) d.setFullYear(year + 1); // assume future
        result.date = toISODate(d);
        result.matchedDate = true;
      }
    } else if (weekdayMatch) {
      const targetIdx = WEEKDAY_INDEX[weekdayMatch[1]];
      const isNextWeek = /proxima|que vem/.test(flatText);
      let d = nextWeekday(ref, targetIdx, isNextWeek);
      result.date = toISODate(d);
      result.matchedDate = true;
    }
  }

  // ---- Time detection ----
  // "16h", "16h30", "16:00", "às 4 da tarde", "4pm". A time explicitly
  // preceded by "às"/"as" (how pt-BR actually states an appointment time,
  // e.g. "consulta às 13:30h") is checked FIRST and preferred over any bare
  // H:MM pattern found elsewhere — text pasted or OCR'd from a WhatsApp
  // screenshot is full of other H:MM-looking things (chat message
  // timestamps, the phone's own status bar clock) that aren't the
  // appointment's time at all, and used to win just by appearing earlier
  // in the string.
  const asTimeMatch = flatText.match(/\bas\s+(\d{1,2})(?:[h:](\d{2}))?h?\b/);
  const timeMatch = asTimeMatch || text.match(/\b(\d{1,2})[h:](\d{2})?h?\b/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    let minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (/tarde|noite/.test(text) && hour < 12) hour += 12;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      result.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      result.matchedTime = true;
    }
  }

  // ---- Title cleanup ----
  // Try to find a short label after keywords like "com Dr." / "com" for a
  // nicer title. WhatsApp renders *bold* around a name with literal
  // asterisks in the underlying text ("com * Dr(a). Fabiana"), so an
  // optional "*"/"_" is allowed between "com" and the capitalized name.
  const withMatch = rawText && rawText.match(/com\s*[*_]?\s*([A-ZÀ-Ú][\wÀ-ú.()]*(\s+[A-ZÀ-Ú][\wÀ-ú.()]*)*)/);
  if (withMatch) {
    const typeLabel = { exame: 'Exame', consulta: 'Consulta', reuniao: 'Reunião', outro: 'Compromisso' }[result.type];
    result.title = `${typeLabel} com ${withMatch[1]}`.slice(0, 80);
  } else if (rawText) {
    // Fallback: first line of the raw text — but text pasted/OCR'd from a
    // chat screenshot often has a first line that's just UI noise (a
    // timestamp, a stray symbol from a misread icon), not anything
    // resembling a title. Skip lines that don't have enough real letters
    // in them before settling for one, rather than confidently naming the
    // appointment "22:58 > SE)".
    const candidateLine = rawText.split('\n').map((l) => l.trim()).find((l) => (l.match(/\p{L}/gu) || []).length >= 4);
    result.title = (candidateLine || rawText.trim().split('\n')[0]).slice(0, 80);
  }

  result.recurrence = parseRecurrenceText(rawText);

  return result;
}

/**
 * Detects recurrence phrases in pt-BR text: "toda terça e quinta", "todos os
 * sábados", "todo dia"/"diariamente", "dias úteis"/"de segunda a sexta".
 * Returns { freq: 'daily'|'weekly', daysOfWeek: [0-6]|null } or null if no
 * recurrence was mentioned — a single one-off date (e.g. "consulta terça às
 * 10h", no "toda") correctly returns null here even though the date parser
 * above still resolves "terça" to a specific upcoming date.
 */
export function parseRecurrenceText(rawText) {
  const flat = stripAccents((rawText || '').toLowerCase());

  if (/dias uteis|de segunda a sexta|de segunda-feira a sexta-feira/.test(flat)) {
    return { freq: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] };
  }
  if (/\btodo(s)?\s+(?:os?\s+)?dias?\b|\bdiariamente\b|\bdiari[ao]\b/.test(flat)) {
    return { freq: 'daily', daysOfWeek: null };
  }

  const weekdayNames = 'domingo|segunda|terca|quarta|quinta|sexta|sabado';
  const prefixRe = new RegExp(`\\btod[ao]s?\\b(?:\\s+(?:os|as))?\\s+((?:(?:${weekdayNames})s?(?:-feira)?s?(?:\\s*(?:,|e)\\s*)?)+)`);
  const prefixMatch = flat.match(prefixRe);
  if (prefixMatch) {
    const dayRe = new RegExp(`(${weekdayNames})s?`, 'g');
    const daysFound = new Set();
    let m;
    while ((m = dayRe.exec(prefixMatch[1])) !== null) {
      daysFound.add(WEEKDAY_INDEX[m[1]]);
    }
    if (daysFound.size > 0) {
      return { freq: 'weekly', daysOfWeek: [...daysFound].sort((a, b) => a - b) };
    }
  }

  return null;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function nextWeekday(from, targetIdx, forceNextWeek) {
  const currentIdx = from.getDay();
  let diff = (targetIdx - currentIdx + 7) % 7;
  if (diff === 0) diff = forceNextWeek ? 7 : 0;
  if (forceNextWeek && diff < 7) diff += 7;
  return addDays(from, diff);
}

// ---------------------------------------------------------------------------
// Financial text parsing (manual/voice/share entry of an expense)
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS = [
  { category: 'mercado', words: ['mercado', 'supermercado', 'feira', 'hortifruti'] },
  { category: 'farmácia', words: ['farmacia', 'farmácia', 'remedio', 'remédio'] },
  { category: 'transporte', words: ['uber', '99', 'taxi', 'gasolina', 'combustivel', 'combustível', 'onibus', 'ônibus'] },
  { category: 'alimentação', words: ['restaurante', 'lanche', 'ifood', 'almoco', 'almoço', 'jantar', 'padaria'] },
  { category: 'lazer', words: ['cinema', 'streaming', 'show', 'ingresso'] },
  { category: 'casa', words: ['aluguel', 'condominio', 'condomínio', 'luz', 'agua', 'água', 'internet'] },
];

const PAYMENT_KEYWORDS = [
  { method: 'pix', words: ['pix'] },
  { method: 'dinheiro', words: ['dinheiro', 'espécie', 'especie'] },
  { method: 'debito', words: ['debito', 'débito'] },
  { method: 'cartao', words: ['cartao', 'cartão', 'credito', 'crédito'] },
];

export function parseExpenseText(rawText) {
  const text = stripAccents((rawText || '').toLowerCase());
  const result = { desc: rawText ? rawText.trim() : '', value: null, category: null, paymentMethod: null };

  // Priority matters: a document can contain other digit sequences that
  // aren't the amount at all — most commonly a card reference like "final
  // 4321", which used to get grabbed as if it were "R$ 432,00" whenever it
  // appeared before the real value in the text. So: prefer an explicit
  // "R$"-prefixed number, then any plain decimal-comma amount ("87,30"),
  // and only fall back to a bare integer (no currency signal at all) when
  // nothing else matches — that fallback exists for simple voice/manual
  // input like "gastei 50 no mercado" where there's genuinely no "R$".
  const prefixedMatch = (rawText || '').match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
  const decimalMatch = (rawText || '').match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  const bareMatch = (rawText || '').match(/\b(\d{1,3})\b/);
  const valueMatch = prefixedMatch || decimalMatch || bareMatch;
  if (valueMatch) {
    let numStr = valueMatch[1].replace(/\./g, '').replace(',', '.');
    // handle plain "50" without decimals correctly (no comma/dot means whole reais)
    if (!/[.,]/.test(valueMatch[1])) numStr = valueMatch[1];
    const val = parseFloat(numStr);
    if (!isNaN(val)) result.value = val;
  }

  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.some((w) => text.includes(stripAccents(w)))) {
      result.category = category;
      break;
    }
  }
  for (const { method, words } of PAYMENT_KEYWORDS) {
    if (words.some((w) => text.includes(stripAccents(w)))) {
      result.paymentMethod = method;
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Statement-style OCR text — a photo/screenshot of a bank/wallet extract
// with several rows (date, description, value, running balance), as opposed
// to a single receipt/confirmation. parseExpenseText above only ever grabs
// the *first* number it sees in the whole blob, which silently produces a
// wrong, meaningless import when the text actually contains many
// transactions.
//
// A first version of this split the OCR text by newlines and required a
// date + value on the same line — that assumption turned out to be wrong:
// real Tesseract output on a dense table frequently drops the line breaks
// between rows entirely, running everything together into one blob (e.g.
// "...R$ 320,4202-07-2026 Rendimentos..." with the next row's date glued
// straight onto the previous row's balance, no whitespace at all). Splitting
// on newlines found zero rows in that case and silently fell through to the
// single-value grab — the exact bug this was meant to fix.
//
// This version anchors on date matches instead of line breaks: every date
// found in the text starts a new "row", ending where the next date begins.
// That holds regardless of whether real newlines survived OCR, as long as
// the reading order is roughly row-by-row (true for the layouts tested).
// ---------------------------------------------------------------------------

const STATEMENT_DATE_RE = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g;
const STATEMENT_VALUE_RE = /-?\s?r?\$?\s*-?\d{1,3}(?:\.\d{3})*,\d{2}/gi;
// Compound phrases specific enough to an actual account statement/extract or
// a card app's transaction list — deliberately NOT single generic words like
// "fatura" or "saldo" alone, which show up plenty in ordinary
// single-transaction receipts too (a card charge notification, a Pix
// confirmation) and would wrongly block those from importing via the normal
// single-value path.
const STATEMENT_KEYWORDS = /extrato de conta|saldo inicial|saldo final|detalhe dos movimentos|ultimas transa[çc][õo]es|movimenta[çc][õo]es na fatura|detalhes de consumo/i;

/** Heuristic: does this look like a multi-transaction statement rather than a single receipt? */
export function looksLikeStatement(rawText) {
  const text = rawText || '';
  const dateCount = (text.match(STATEMENT_DATE_RE) || []).length + (text.match(ABBR_DATE_RE) || []).length;
  // Bare DD/MM (no year — e.g. a card invoice's transaction list) is a
  // looser pattern, more prone to matching unrelated things, so it needs a
  // higher count before being treated as a signal on its own.
  const bareDateCount = (text.match(INVOICE_DATE_RE) || []).length;
  return dateCount >= 3 || bareDateCount >= 5 || STATEMENT_KEYWORDS.test(text);
}

/**
 * Extracts one row per date occurrence in the text (see design note above).
 * Only negative values (money going out) become rows — this app tracks
 * despesas, not income, so a statement's "Rendimentos"/"Entradas" lines are
 * intentionally skipped, not misfiled as expenses.
 * Returns [] if fewer than 2 usable rows were found, so callers can fall
 * back to the single-value parser used for simple receipts — but see
 * looksLikeStatement above for when that fallback is actually safe to use.
 */
export function parseStatementText(rawText) {
  const text = rawText || '';
  const dateMatches = [...text.matchAll(STATEMENT_DATE_RE)];
  if (dateMatches.length === 0) return [];

  const rows = [];
  for (let i = 0; i < dateMatches.length; i++) {
    const dm = dateMatches[i];
    const segmentStart = dm.index + dm[0].length;
    const segmentEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].index : text.length;
    const segment = text.slice(segmentStart, segmentEnd);

    const valueTokens = segment.match(STATEMENT_VALUE_RE);
    if (!valueTokens || valueTokens.length === 0) continue;

    // A row is typically "... Valor Saldo" — the transaction amount comes
    // before the running balance, so prefer the first token when there's
    // more than one currency-looking number in the segment.
    const raw = valueTokens[0];
    const isNegative = raw.includes('-');
    const numeric = parseFloat(raw.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(numeric) || numeric === 0 || !isNegative) continue; // skip income/zero/unparseable

    const day = dm[1].padStart(2, '0');
    const month = dm[2].padStart(2, '0');
    const year = dm[3].length === 2 ? `20${dm[3]}` : dm[3];

    const desc = segment.split(raw)[0]
      .replace(/\d{5,}/g, '') // strip long operation/reference IDs
      .replace(/[^\p{L}\s]/gu, ' ') // drop stray punctuation/digits, keep words
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Transação';

    rows.push({ desc, value: Math.abs(numeric), date: `${year}-${month}-${day}` });
  }

  return rows.length >= 2 ? rows : [];
}

// ---------------------------------------------------------------------------
// Card-app transaction list — a different shape from a bank extract: a
// banking app's "Últimas transações" screen lists MERCHANT ... VALOR first,
// with the date trailing afterwards ("AMAZON BR R$ 35,98 Autorizado 15 jul.
// 2026"), using abbreviated Portuguese month names instead of dd/mm/yyyy —
// and every listed entry is a charge (no running balance/income concept to
// filter out, unlike a bank extract). parseStatementText's date-anchored
// approach doesn't fit this shape (the date isn't a reliable row-start
// marker here), so this anchors on values instead and looks for a date
// trailing shortly after each one.
// ---------------------------------------------------------------------------

const PT_MONTH_ABBR = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};
const ABBR_DATE_RE = new RegExp(`(\\d{1,2})\\s*(?:de\\s+)?(${Object.keys(PT_MONTH_ABBR).join('|')})[a-z]*\\.?\\s*(?:de\\s+)?(\\d{4})`, 'gi');

export function parseCardTransactionsText(rawText) {
  const text = rawText || '';
  const valueMatches = [...text.matchAll(STATEMENT_VALUE_RE)];
  if (valueMatches.length === 0) return [];

  const rows = [];
  for (let i = 0; i < valueMatches.length; i++) {
    const vm = valueMatches[i];
    const numeric = parseFloat(vm[0].replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(numeric) || numeric === 0) continue;

    // Look for a trailing date shortly after this value (before the next
    // value starts, so it isn't accidentally borrowed from the next row).
    const windowEnd = i + 1 < valueMatches.length ? valueMatches[i + 1].index : Math.min(text.length, vm.index + vm[0].length + 60);
    const afterText = text.slice(vm.index + vm[0].length, windowEnd);
    const dateMatch = afterText.match(ABBR_DATE_RE) ? [...afterText.matchAll(ABBR_DATE_RE)][0] : null;
    if (!dateMatch) continue; // no confidently-associated date — skip rather than guess

    const day = dateMatch[1].padStart(2, '0');
    const month = PT_MONTH_ABBR[dateMatch[2].toLowerCase()];
    const year = dateMatch[3];

    // Description: the merchant name immediately before the value — take
    // the tail end of the preceding text (bounded by the previous value's
    // end, or a short fixed window) and keep only its last segment after
    // common UI separators, so surrounding chrome (card number, "Titular",
    // filter buttons...) doesn't leak into it.
    const priorStart = i > 0 ? valueMatches[i - 1].index + valueMatches[i - 1][0].length : Math.max(0, vm.index - 80);
    const beforeText = text.slice(priorStart, vm.index);
    const lastSegment = beforeText.split(/[>|•\n]/).pop() || beforeText;
    const desc = lastSegment
      .replace(/\d{5,}/g, '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Transação';

    rows.push({ desc, value: Math.abs(numeric), date: `${year}-${month}-${day}` });
  }

  return rows.length >= 2 ? rows : [];
}

// ---------------------------------------------------------------------------
// Card invoice ("fatura") — a third shape, distinct from both above: a
// credit card bill grouped into sections per physical card ("Cartão Visa
// [****6057]"), each with its own "Data Movimentações Valor em R$" header
// and a "Total R$ X,XX" line at the end. Dates here are DD/MM with NO year
// (the invoice's own emission/due date supplies the year), and every row is
// a positive charge — same as the card-app transactions list, but date
// comes first instead of trailing after the value.
//
// The "Total" line is deliberately not special-cased: since it has no date
// of its own, it simply becomes trailing noise at the end of the previous
// row's segment, and only the FIRST currency value in a segment is ever
// used — so it's naturally ignored rather than mistaken for a transaction.
// ---------------------------------------------------------------------------

const INVOICE_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const REFERENCE_YEAR_RE = /(?:emitido em|vencimento)\s*:?\s*\d{1,2}\/\d{1,2}\/(\d{4})/i;
// "Total" (and similar summary labels) usually sits far enough from any
// transaction date that the per-segment check below excludes it — but a
// highlighted "Total" box (as invoice apps commonly render the amount due)
// can get read twice by OCR's page-segmentation, landing its value in a
// segment where nothing "total"-looking immediately precedes it. As a
// second line of defense, scan the WHOLE text (not just individual
// date-anchored segments) for any value labeled "total" and refuse to
// import a transaction for that exact amount at all — a real purchase
// coincidentally costing the invoice's grand total to the cent isn't a
// realistic risk worth trading away this protection for.
const TOTAL_LABEL_VALUE_RE = /total[^\d\n]{0,25}(-?\s?r?\$?\s*-?\d{1,3}(?:\.\d{3})*,\d{2})/gi;

function collectLabeledTotals(text) {
  const totals = new Set();
  for (const m of text.matchAll(TOTAL_LABEL_VALUE_RE)) {
    const numeric = parseFloat(m[1].replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (!isNaN(numeric) && numeric !== 0) totals.add(numeric.toFixed(2));
  }
  return totals;
}

export function parseCardInvoiceText(rawText) {
  const text = rawText || '';
  const dateMatches = [...text.matchAll(INVOICE_DATE_RE)];
  if (dateMatches.length === 0) return [];

  const excludedTotals = collectLabeledTotals(text);

  const refYearMatch = text.match(REFERENCE_YEAR_RE);
  const referenceYear = refYearMatch ? refYearMatch[1] : String(new Date().getFullYear());

  const rows = [];
  for (let i = 0; i < dateMatches.length; i++) {
    const dm = dateMatches[i];
    const segmentStart = dm.index + dm[0].length;
    const segmentEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].index : text.length;
    const segment = text.slice(segmentStart, segmentEnd);

    const valueTokens = segment.match(STATEMENT_VALUE_RE);
    if (!valueTokens || valueTokens.length === 0) continue;

    // A payment TOWARD the card (paying off a previous invoice), a
    // refund/credit, or a summary/total figure ("Total a pagar R$ 2.102,79"
    // from the invoice's header, "Total R$ 1.029,37" closing a card
    // section) isn't a real transaction — skip it. Checked against the text
    // immediately before the value specifically, not the whole segment,
    // since "total" only disqualifies a row when it's describing *this*
    // value (a merchant name mentioned earlier in a longer segment
    // shouldn't be excluded just because the word appears somewhere in it).
    const beforeValue = segment.slice(0, segment.indexOf(valueTokens[0]));
    if (/pagamento (da|de) fatura|estorno|cr[eé]dito devolvido|total/i.test(beforeValue)) continue;

    const raw = valueTokens[0];
    const numeric = parseFloat(raw.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(numeric) || numeric === 0) continue;
    if (excludedTotals.has(numeric.toFixed(2))) continue;

    const day = dm[1].padStart(2, '0');
    const month = dm[2].padStart(2, '0');
    const year = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : referenceYear;

    const desc = segment.split(raw)[0]
      .replace(/parcela\s+\d+\s+de\s+\d+/i, '')
      .replace(/\d{5,}/g, '')
      .replace(/\*/g, ' ')
      .replace(/[^\p{L}0-9\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Transação';

    rows.push({ desc, value: Math.abs(numeric), date: `${year}-${month}-${day}` });
  }

  return rows.length >= 2 ? rows : [];
}

// ---------------------------------------------------------------------------
// CSV import — detects delimiter, maps pt-BR header variants, returns rows.
// ---------------------------------------------------------------------------

const CSV_HEADER_MAP = {
  date: ['data', 'date', 'dt'],
  desc: ['descricao', 'descrição', 'historico', 'histórico', 'desc', 'description', 'lançamento', 'lancamento'],
  value: ['valor', 'value', 'montante', 'amount'],
};

export function parseCSV(text) {
  const errors = [];
  const cleanText = text.replace(/^﻿/, '').trim();
  if (!cleanText) return { rows: [], errors: ['Arquivo CSV vazio.'] };

  const lines = cleanText.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ['CSV precisa de cabeçalho e ao menos uma linha de dados.'] };

  // Delimiter detection: whichever of , or ; appears more often in the header line.
  const delimiter = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';

  const headerCells = lines[0].split(delimiter).map((h) => stripAccents(h.trim().toLowerCase()));
  const colIndex = { date: -1, desc: -1, value: -1 };
  headerCells.forEach((cell, i) => {
    for (const [field, variants] of Object.entries(CSV_HEADER_MAP)) {
      if (colIndex[field] === -1 && variants.some((v) => cell === stripAccents(v))) {
        colIndex[field] = i;
      }
    }
  });

  if (colIndex.value === -1) {
    errors.push('Não encontrei uma coluna de valor no CSV (esperado: "valor").');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter);
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const rawValue = colIndex.value >= 0 ? cells[colIndex.value] : null;
    const rawDesc = colIndex.desc >= 0 ? cells[colIndex.desc] : `Linha ${i + 1}`;
    const rawDate = colIndex.date >= 0 ? cells[colIndex.date] : null;

    if (!rawValue) {
      errors.push(`Linha ${i + 1}: sem valor, ignorada.`);
      continue;
    }
    const numeric = parseFloat(rawValue.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
    if (isNaN(numeric)) {
      errors.push(`Linha ${i + 1}: valor "${rawValue}" não reconhecido, ignorada.`);
      continue;
    }
    rows.push({
      desc: (rawDesc || `Linha ${i + 1}`).trim(),
      value: Math.abs(numeric),
      date: rawDate ? parseFlexibleDate(rawDate.trim()) : toISODate(new Date()),
    });
  }

  return { rows, errors };
}

function parseFlexibleDate(str) {
  const dmy = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmy) {
    let year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10);
    return toISODate(new Date(year, parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10)));
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return toISODate(new Date());
}

// ---------------------------------------------------------------------------
// XML import — NF-e aware, with a generic fallback for other XML shapes.
// ---------------------------------------------------------------------------

export function parseXML(text) {
  const errors = [];
  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(text, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error(parserError.textContent);
  } catch (e) {
    return { rows: [], errors: [`XML inválido: ${e.message}`] };
  }

  const rows = [];

  // NF-e structure: <det><prod><xProd>Descrição</xProd><vProd>10.00</vProd></prod></det>
  const dets = doc.querySelectorAll('det, Det');
  if (dets.length > 0) {
    dets.forEach((det, i) => {
      const prod = det.querySelector('prod, Prod') || det;
      const xProd = prod.querySelector('xProd, XProd');
      const vProd = prod.querySelector('vProd, VProd');
      if (xProd && vProd) {
        const val = parseFloat(vProd.textContent.replace(',', '.'));
        if (!isNaN(val)) {
          rows.push({ desc: xProd.textContent.trim(), value: val, date: toISODate(new Date()) });
        } else {
          errors.push(`Item ${i + 1}: valor inválido em vProd.`);
        }
      }
    });
  }

  // Try to find a NF-e level date (dhEmi/dEmi) to apply to all rows.
  const dhEmi = doc.querySelector('dhEmi, DhEmi, dEmi, DEmi');
  if (dhEmi && rows.length > 0) {
    const iso = dhEmi.textContent.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) rows.forEach((r) => { r.date = iso; });
  }

  // Generic fallback: any element whose tag name contains valor/total/value,
  // using the closest preceding sibling/parent text as description.
  if (rows.length === 0) {
    const all = doc.getElementsByTagName('*');
    for (const el of all) {
      const tag = stripAccents(el.tagName.toLowerCase());
      if (/valor|total|value/.test(tag) && el.children.length === 0) {
        const raw = el.textContent.trim();
        const val = parseFloat(raw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
        if (!isNaN(val) && val > 0) {
          const desc = findNearbyDescription(el) || el.tagName;
          rows.push({ desc, value: val, date: toISODate(new Date()) });
        }
      }
    }
    if (rows.length === 0) {
      errors.push('Não encontrei elementos de valor reconhecíveis neste XML.');
    }
  }

  return { rows, errors };
}

function findNearbyDescription(el) {
  // Look at siblings within the same parent for a text-bearing element.
  const parent = el.parentElement;
  if (!parent) return null;
  for (const sibling of parent.children) {
    if (sibling === el) continue;
    const tag = stripAccents(sibling.tagName.toLowerCase());
    if (/desc|nome|name|prod|item|hist/.test(tag) && sibling.textContent.trim()) {
      return sibling.textContent.trim();
    }
  }
  return null;
}
