// config.js — Example configuration for external integrations.
//
// The Google Calendar and Gmail integrations are OPTIONAL. The app works
// fully offline without them (manual entry, voice, share capture, finance
// and documents all work with zero configuration). Fill these in only if
// you want appointments mirrored to Google Calendar and/or email scanning
// for appointment suggestions.
//
// How to obtain these values:
// 1. Go to https://console.cloud.google.com/ and create a project (or reuse one).
// 2. Enable the "Google Calendar API" and, if you want email scanning,
//    the "Gmail API" (APIs & Services > Library).
// 3. Configure the OAuth consent screen (APIs & Services > OAuth consent screen).
// 4. Create an OAuth 2.0 Client ID of type "Web application"
//    (APIs & Services > Credentials > Create Credentials > OAuth client ID).
//    - Add the URL where you serve this app (e.g. http://localhost:5173 or
//      your production domain) to "Authorized JavaScript origins".
// 5. Copy the generated Client ID into GOOGLE_CLIENT_ID below.
//
// These are client-side, public OAuth Client IDs (not secrets) used with
// Google Identity Services (GIS) — safe to ship in a static front-end app,
// as long as you restrict authorized origins in the Cloud Console.

window.FIO_CONFIG = {
  // OAuth 2.0 Client ID from Google Cloud Console. Leave empty to disable
  // Google Calendar mirroring and Gmail scanning.
  GOOGLE_CLIENT_ID: '',

  // Scopes requested. calendar.events lets Fio create/update events it
  // creates; gmail.readonly lets Fio *read* (never send/delete) recent
  // messages to suggest appointments. Suggestions always require manual
  // confirmation before becoming real appointments.
  GOOGLE_SCOPES: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/gmail.readonly',
  ].join(' '),

  // How many days ahead a derived follow-up task (e.g. "buscar resultado do
  // exame") defaults to when a triggering appointment type is created.
  DEFAULT_FOLLOWUP_DAYS: 5,

  // Minutes before an appointment's start time that a local reminder fires.
  REMINDER_MINUTES_BEFORE: 60,
};
