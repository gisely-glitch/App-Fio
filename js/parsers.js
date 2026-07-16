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
  // "16h", "16h30", "16:00", "às 4 da tarde", "4pm"
  const timeMatch = text.match(/\b(\d{1,2})[h:](\d{2})?\b/) || text.match(/\bàs?\s+(\d{1,2})\b/);
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
  // Try to find a short label after keywords like "com Dr." / "com" for a nicer title.
  const withMatch = rawText && rawText.match(/com\s+([A-ZÀ-Ú][\wÀ-ú.]*(\s+[A-ZÀ-Ú][\wÀ-ú.]*)*)/);
  if (withMatch) {
    const typeLabel = { exame: 'Exame', consulta: 'Consulta', reuniao: 'Reunião', outro: 'Compromisso' }[result.type];
    result.title = `${typeLabel} com ${withMatch[1]}`.slice(0, 80);
  }

  return result;
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

  const valueMatch = (rawText || '').match(/r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i);
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
