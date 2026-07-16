// notifications.js — Local reminders, the post-appointment "Você foi?"
// confirmation, and due-soon alerts for fixed expenses.
//
// Uses the Notification API when permission is granted and the tab is
// backgrounded; always also raises an in-app callback so the UI can show
// the same prompt even without OS notification permission (mobile browsers
// vary a lot here, so we never depend on it being available).

import { getOverduePending, getUpcomingForReminder } from './appointments.js';
import { getFixedExpensesDueSoon } from './finance.js';

const REMINDER_MINUTES_BEFORE = (window.FIO_CONFIG && window.FIO_CONFIG.REMINDER_MINUTES_BEFORE) || 60;
const CHECK_INTERVAL_MS = 60 * 1000; // check every minute while the app is open

const remindedIds = new Set();
const dueSoonNotifiedIds = new Set();

let listeners = {
  onAttendancePrompt: null, // (appointment) => void — "Você foi?"
  onReminder: null, // (appointment) => void
  onExpenseDueSoon: null, // (fixedExpense) => void
};

export function onNotificationEvents(handlers) {
  listeners = { ...listeners, ...handlers };
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

function raiseOsNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: './icons/icon-192.png' });
    } catch (e) {
      // Some mobile browsers only allow notifications via a Service Worker
      // registration; fall back silently — the in-app prompt still fires.
      navigator.serviceWorker?.getRegistration().then((reg) => {
        reg?.showNotification(title, { body, icon: './icons/icon-192.png' });
      }).catch(() => {});
    }
  }
}

async function tick() {
  // 1. Appointments needing the "Você foi?" prompt.
  const overdue = await getOverduePending();
  for (const appt of overdue) {
    listeners.onAttendancePrompt?.(appt);
  }

  // 2. Upcoming appointments within the reminder window.
  const upcoming = await getUpcomingForReminder(REMINDER_MINUTES_BEFORE);
  for (const appt of upcoming) {
    if (remindedIds.has(appt.id)) continue;
    remindedIds.add(appt.id);
    raiseOsNotification('Fio — lembrete', `${appt.title} às ${new Date(appt.datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    listeners.onReminder?.(appt);
  }

  // 3. Fixed expenses due soon.
  const dueSoon = await getFixedExpensesDueSoon(3);
  for (const exp of dueSoon) {
    if (dueSoonNotifiedIds.has(exp.id)) continue;
    dueSoonNotifiedIds.add(exp.id);
    raiseOsNotification('Fio — conta a vencer', `${exp.label}: R$ ${exp.value.toFixed(2)} vence dia ${exp.dueDay}`);
    listeners.onExpenseDueSoon?.(exp);
  }
}

let intervalHandle = null;

export function startNotificationScheduler() {
  requestNotificationPermission().catch(() => {});
  tick();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
}

export function stopNotificationScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
