// share.js — Handles content arriving via the PWA Web Share Target
// (manifest.json `share_target`, GET method) so that sharing a WhatsApp/
// Instagram/Facebook/TikTok message into Fio lands directly in the capture
// screen, prefilled and with a best-effort guess of where it came from.
//
// Note: browsers deliberately do NOT tell a share target *which app*
// triggered the share (privacy), so `source` is inferred heuristically from
// the shared text/url contents (e.g. a wa.me link, an instagram.com URL).
// When nothing matches, we fall back to 'whatsapp' since informal
// appointment sharing via WhatsApp is this app's primary use case — the
// user can always correct it on the capture screen.

const SOURCE_PATTERNS = [
  { source: 'whatsapp', re: /wa\.me|whatsapp/i },
  { source: 'instagram', re: /instagram\.com|instagr\.am/i },
  { source: 'facebook', re: /facebook\.com|fb\.com|fb\.watch/i },
  { source: 'tiktok', re: /tiktok\.com/i },
];

function guessSource(text, url) {
  const combined = `${text || ''} ${url || ''}`;
  for (const { source, re } of SOURCE_PATTERNS) {
    if (re.test(combined)) return source;
  }
  return text || url ? 'whatsapp' : 'manual';
}

/**
 * Reads share_target GET params from the current URL. Returns null if this
 * page load wasn't triggered by a share. Consumes (strips) the params from
 * the URL bar afterwards so a page refresh doesn't re-trigger capture.
 */
export function consumeSharedPayload() {
  const params = new URLSearchParams(window.location.search);
  const hasShare = params.has('title') || params.has('text') || params.has('url');
  if (!hasShare) return null;

  const title = params.get('title') || '';
  const text = params.get('text') || '';
  const url = params.get('url') || '';
  const combinedText = [title, text, url].filter(Boolean).join(' — ');

  // Clean the URL so back/refresh doesn't replay the share.
  window.history.replaceState({}, document.title, window.location.pathname);

  return {
    rawText: combinedText,
    source: guessSource(text, url),
  };
}
