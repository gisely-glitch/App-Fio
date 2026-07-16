// integrations/gmail.js — Optional Gmail scanning for appointment
// suggestions. Uses the same Google OAuth token as Calendar (gmail.readonly
// scope must be included in config.js GOOGLE_SCOPES).
//
// IMPORTANT: this module never creates appointments automatically. It only
// reads recent messages, looks for scheduling-confirmation language, and
// stores a *suggestion* the user must explicitly accept or dismiss on the
// "Sugestões de e-mail" panel — see js/app.js.

import { isGoogleConnected, isGoogleConfigured, getGoogleAccessToken } from './google.js';
import { db, uid } from '../db.js';
import { parseAppointmentText } from '../parsers.js';

const KEYWORDS = [
  'consulta confirmada', 'consulta marcada', 'agendamento confirmado', 'exame marcado',
  'confirmação de consulta', 'confirmação de agendamento', 'sua consulta', 'seu exame',
  'agendado para', 'confirmamos seu', 'lembrete de consulta',
];

async function gmailFetch(path) {
  const token = getGoogleAccessToken();
  if (!token) throw new Error('not_connected');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error ${res.status}`);
  return res.json();
}

function decodeBase64Url(data) {
  try {
    return decodeURIComponent(atob(data.replace(/-/g, '+').replace(/_/g, '/')).split('').map(
      (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join(''));
  } catch {
    return '';
  }
}

function extractBodyText(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain') || payload.parts[0];
    return textPart ? extractBodyText(textPart) : '';
  }
  return '';
}

/**
 * Scans recent inbox messages for scheduling keywords and stores suggestions
 * (never real appointments) for the user to review. Returns the new
 * suggestions found in this scan.
 */
export async function scanRecentEmailsForAppointments({ maxResults = 20 } = {}) {
  if (!isGoogleConfigured()) throw new Error('Integração com Google não configurada (config.js).');
  if (!isGoogleConnected()) throw new Error('Conecte sua conta Google primeiro.');

  const query = encodeURIComponent(`newer_than:14d (${KEYWORDS.map((k) => `"${k}"`).join(' OR ')})`);
  const list = await gmailFetch(`messages?q=${query}&maxResults=${maxResults}`);
  const messages = list.messages || [];

  const existing = await db.getAll('emailSuggestions');
  const existingIds = new Set(existing.map((s) => s.gmailMessageId));

  const newSuggestions = [];
  for (const m of messages) {
    if (existingIds.has(m.id)) continue;
    const full = await gmailFetch(`messages/${m.id}?format=full`);
    const headers = full.payload?.headers || [];
    const subject = headers.find((h) => h.name === 'Subject')?.value || '(sem assunto)';
    const from = headers.find((h) => h.name === 'From')?.value || '';
    const bodyText = extractBodyText(full.payload) || full.snippet || '';
    const combined = `${subject}. ${bodyText}`;

    const parsed = parseAppointmentText(combined);
    const suggestion = {
      id: uid(),
      gmailMessageId: m.id,
      subject,
      from,
      snippet: full.snippet || '',
      suggested: parsed,
      status: 'pending', // pending | accepted | dismissed
      foundAt: new Date().toISOString(),
    };
    await db.put('emailSuggestions', suggestion);
    newSuggestions.push(suggestion);
  }

  return newSuggestions;
}

export async function listEmailSuggestions() {
  const all = await db.getAll('emailSuggestions');
  return all.filter((s) => s.status === 'pending').sort((a, b) => (a.foundAt < b.foundAt ? 1 : -1));
}

export async function resolveEmailSuggestion(id, status) {
  const suggestion = await db.get('emailSuggestions', id);
  if (!suggestion) return null;
  suggestion.status = status;
  await db.put('emailSuggestions', suggestion);
  return suggestion;
}
