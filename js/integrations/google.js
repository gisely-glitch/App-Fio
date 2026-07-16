// integrations/google.js — Optional Google Calendar mirroring.
//
// Uses Google Identity Services (GIS) for OAuth2 (token client / implicit
// flow, appropriate for a static front-end app with no backend) and calls
// the Calendar API v3 directly via fetch. Fully inert (no network calls, no
// script injection) when window.FIO_CONFIG.GOOGLE_CLIENT_ID is empty — see
// config.js for how to obtain a Client ID.
//
// Every appointment created in Fio is mirrored as a best-effort background
// operation; failures here never block or corrupt local data (appointments
// remain the source of truth in IndexedDB regardless of Calendar sync state).

const CLIENT_ID = window.FIO_CONFIG?.GOOGLE_CLIENT_ID || '';
const SCOPES = window.FIO_CONFIG?.GOOGLE_SCOPES || '';
const TOKEN_STORAGE_KEY = 'fio.google.accessToken';
const TOKEN_EXPIRY_KEY = 'fio.google.accessTokenExpiry';

let gisScriptPromise = null;
let tokenClient = null;

export function isGoogleConfigured() {
  return !!CLIENT_ID;
}

function loadGisScript() {
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Não foi possível carregar o Google Identity Services.'));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

function getStoredToken() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  if (token && Date.now() < expiry) return token;
  return null;
}

function storeToken(token, expiresInSeconds) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000 - 30000));
}

export function isGoogleConnected() {
  return !!getStoredToken();
}

export function disconnectGoogle() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

/** Opens the Google OAuth consent popup and resolves once an access token is stored. */
export async function connectGoogle() {
  if (!isGoogleConfigured()) {
    throw new Error('Integração com Google não configurada. Preencha GOOGLE_CLIENT_ID em config.js.');
  }
  await loadGisScript();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) return reject(new Error(response.error));
        storeToken(response.access_token, response.expires_in);
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

async function authorizedFetch(url, options = {}) {
  const token = getStoredToken();
  if (!token) throw new Error('not_connected');
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Calendar API error ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

function toCalendarEvent(appointment) {
  const start = new Date(appointment.datetime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1h duration
  return {
    summary: appointment.title,
    description: `Criado pelo app Fio · tipo: ${appointment.type}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/**
 * Creates (or updates, if already mirrored) the Google Calendar event for an
 * appointment. Returns the Google event id, or null if the integration
 * isn't configured/connected — callers treat that as a normal no-op.
 */
export async function mirrorAppointmentToGoogleCalendar(appointment) {
  if (!isGoogleConfigured() || !isGoogleConnected()) return null;
  const event = toCalendarEvent(appointment);
  try {
    if (appointment.googleEventId) {
      const updated = await authorizedFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${appointment.googleEventId}`,
        { method: 'PATCH', body: JSON.stringify(event) },
      );
      return updated.id;
    }
    const created = await authorizedFetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      { method: 'POST', body: JSON.stringify(event) },
    );
    return created.id;
  } catch (e) {
    console.warn('[Fio] Falha ao espelhar compromisso no Google Calendar:', e.message);
    return null;
  }
}

export async function deleteGoogleCalendarEvent(eventId) {
  if (!isGoogleConfigured() || !isGoogleConnected() || !eventId) return;
  try {
    await authorizedFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('[Fio] Falha ao remover evento do Google Calendar:', e.message);
  }
}

export { getStoredToken as getGoogleAccessToken };
