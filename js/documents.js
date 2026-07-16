// documents.js — Unified "Documentos" view: appointment attachments (guias,
// receitas, resultados de exame) and financial documents (faturas, notas)
// in a single filterable, searchable list.

import { db } from './db.js';
import { listFinancialDocuments } from './finance.js';

/**
 * Returns a normalized list combining appointment attachments and financial
 * documents so the Documentos tab can render/filter them together.
 * Each item: { id, kind: 'appointment'|'financial', name, fileType, date, refId, refLabel, parseStatus }
 */
export async function listAllDocuments({ from = null, to = null, kind = null } = {}) {
  const [attachments, appointments, financialDocs] = await Promise.all([
    db.getAll('attachments'),
    db.getAll('appointments'),
    listFinancialDocuments(),
  ]);

  const apptById = new Map(appointments.map((a) => [a.id, a]));

  const appointmentItems = attachments.map((a) => ({
    id: a.id,
    kind: 'appointment',
    name: a.name,
    fileType: a.fileType,
    date: a.uploadedAt,
    refId: a.appointmentId,
    refLabel: apptById.get(a.appointmentId)?.title || 'Compromisso',
    parseStatus: 'manual',
  }));

  const financialItems = financialDocs.map((d) => ({
    id: d.id,
    kind: 'financial',
    name: d.name,
    fileType: d.fileType,
    date: d.uploadedAt,
    refId: d.id,
    refLabel: d.parseStatus === 'parsed' ? `${d.importedCount} lançamento(s) importado(s)` : statusLabel(d.parseStatus),
    parseStatus: d.parseStatus,
  }));

  let all = [...appointmentItems, ...financialItems];
  if (kind) all = all.filter((i) => i.kind === kind);
  if (from) all = all.filter((i) => i.date >= from);
  if (to) all = all.filter((i) => i.date <= to);

  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function statusLabel(status) {
  switch (status) {
    case 'pending_ocr': return 'Arquivado — aguardando leitura automática';
    case 'unparsed': return 'Arquivado — não foi possível extrair lançamentos';
    case 'manual': return 'Arquivado';
    default: return status;
  }
}

export { statusLabel };
