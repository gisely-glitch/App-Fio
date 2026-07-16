// appointments.js — Appointment entity: CRUD, conflict checking, derived
// follow-up tasks, attachments, and the "did you go?" confirmation flow.

import { db, uid } from './db.js';
import { mirrorAppointmentToGoogleCalendar, deleteGoogleCalendarEvent } from './integrations/google.js';

const FOLLOWUP_DAYS = (window.FIO_CONFIG && window.FIO_CONFIG.DEFAULT_FOLLOWUP_DAYS) || 5;

// Appointment types that automatically spawn a follow-up task, and the label
// used for that task. Kept as a simple table now; V2 makes this user-configurable
// (see "Regras de categoria configuráveis" in the roadmap).
const DERIVED_TASK_RULES = {
  exame: 'Buscar resultado do exame',
};

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Checks the given datetime against all existing appointments (except
 * `excludeId`) for conflicts within a ±1h window. Returns the list of
 * conflicting appointments — never throws, never blocks creation.
 */
export async function checkConflicts(datetimeISO, excludeId = null) {
  const all = await db.getAll('appointments');
  const target = new Date(datetimeISO).getTime();
  const WINDOW_MS = 60 * 60 * 1000;
  return all.filter((a) => {
    if (a.id === excludeId) return false;
    const t = new Date(a.datetime).getTime();
    return Math.abs(t - target) <= WINDOW_MS;
  });
}

/**
 * Creates a new appointment, checks for conflicts, generates a derived task
 * when applicable, and (best-effort, non-blocking) mirrors it to Google
 * Calendar if the integration is connected.
 */
export async function createAppointment({ title, type, datetime, source }) {
  const conflicts = await checkConflicts(datetime);

  const appointment = {
    id: uid(),
    title: title || 'Compromisso',
    type: type || 'outro',
    datetime,
    status: 'pendente',
    source: source || 'manual',
    derivedTask: null,
    attachments: [],
    googleEventId: null,
    createdAt: new Date().toISOString(),
  };

  const taskLabel = DERIVED_TASK_RULES[appointment.type];
  if (taskLabel) {
    const due = addBusinessDays(new Date(datetime), FOLLOWUP_DAYS);
    appointment.derivedTask = { label: taskLabel, done: false, dueDate: isoDate(due) };
  }

  await db.put('appointments', appointment);

  // Best-effort mirror; failures never block local creation.
  mirrorAppointmentToGoogleCalendar(appointment)
    .then((eventId) => {
      if (eventId) {
        appointment.googleEventId = eventId;
        db.put('appointments', appointment);
      }
    })
    .catch(() => { /* integration not configured/authorized — local data is still safe */ });

  return { appointment, conflicts };
}

export async function updateAppointment(appointment) {
  await db.put('appointments', appointment);
  return appointment;
}

export async function deleteAppointment(id) {
  const appt = await db.get('appointments', id);
  if (appt && appt.googleEventId) {
    deleteGoogleCalendarEvent(appt.googleEventId).catch(() => {});
  }
  const attachments = await db.getAllByIndex('attachments', 'appointmentId', id);
  await Promise.all(attachments.map((a) => db.delete('attachments', a.id)));
  return db.delete('appointments', id);
}

export async function listAppointments({ type = null, from = null, to = null } = {}) {
  let all = await db.getAll('appointments');
  if (type) all = all.filter((a) => a.type === type);
  if (from) all = all.filter((a) => a.datetime >= from);
  if (to) all = all.filter((a) => a.datetime <= to);
  return all.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
}

export async function getAppointment(id) {
  return db.get('appointments', id);
}

/** Marks the "Você foi?" answer. On "não", the caller opens the reschedule flow. */
export async function markAttendance(id, attended) {
  const appt = await db.get('appointments', id);
  if (!appt) return null;
  appt.status = attended ? 'confirmado' : 'faltou';
  await db.put('appointments', appt);
  return appt;
}

export async function rescheduleAppointment(id, newDatetime) {
  const appt = await db.get('appointments', id);
  if (!appt) return null;
  appt.datetime = newDatetime;
  appt.status = 'pendente';
  await db.put('appointments', appt);
  mirrorAppointmentToGoogleCalendar(appt).catch(() => {});
  return appt;
}

export async function toggleDerivedTask(id) {
  const appt = await db.get('appointments', id);
  if (!appt || !appt.derivedTask) return null;
  appt.derivedTask.done = !appt.derivedTask.done;
  await db.put('appointments', appt);
  return appt;
}

/** Returns appointments whose time has passed but are still "pendente" — used to trigger the "Você foi?" prompt. */
export async function getOverduePending() {
  const all = await db.getAll('appointments');
  const now = Date.now();
  return all.filter((a) => a.status === 'pendente' && new Date(a.datetime).getTime() < now);
}

/** Returns upcoming appointments within the reminder window that haven't been reminded yet. */
export async function getUpcomingForReminder(withinMinutes) {
  const all = await db.getAll('appointments');
  const now = Date.now();
  const windowMs = withinMinutes * 60 * 1000;
  return all.filter((a) => {
    if (a.status !== 'pendente') return false;
    const t = new Date(a.datetime).getTime();
    return t > now && t - now <= windowMs;
  });
}

export async function addAttachment(appointmentId, file) {
  const attachment = {
    id: uid(),
    appointmentId,
    name: file.name,
    fileType: file.type || 'application/octet-stream',
    blob: file,
    uploadedAt: new Date().toISOString(),
  };
  await db.put('attachments', attachment);
  const appt = await db.get('appointments', appointmentId);
  if (appt) {
    appt.attachments = appt.attachments || [];
    appt.attachments.push({ id: attachment.id, name: attachment.name, fileType: attachment.fileType, uploadedAt: attachment.uploadedAt });
    await db.put('appointments', appt);
  }
  return attachment;
}

export async function getAttachmentsForAppointment(appointmentId) {
  return db.getAllByIndex('attachments', 'appointmentId', appointmentId);
}

export async function deleteAttachment(attachmentId, appointmentId) {
  await db.delete('attachments', attachmentId);
  const appt = await db.get('appointments', appointmentId);
  if (appt) {
    appt.attachments = (appt.attachments || []).filter((a) => a.id !== attachmentId);
    await db.put('appointments', appt);
  }
}
