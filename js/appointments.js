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

function addDays(date, n) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + n);
  return copy;
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

function buildAppointmentRecord({ title, type, datetime, source, kind = 'compromisso', recurrenceGroupId = null }) {
  const appointment = {
    id: uid(),
    title: title || (kind === 'lembrete' ? 'Lembrete' : 'Compromisso'),
    kind,
    type: kind === 'lembrete' ? null : (type || 'outro'),
    datetime: datetime || null,
    status: 'pendente',
    source: source || 'manual',
    derivedTask: null,
    attachments: [],
    googleEventId: null,
    recurrence: recurrenceGroupId ? { groupId: recurrenceGroupId } : null,
    createdAt: new Date().toISOString(),
  };

  const taskLabel = kind === 'compromisso' && DERIVED_TASK_RULES[appointment.type];
  if (taskLabel) {
    const due = addBusinessDays(new Date(datetime), FOLLOWUP_DAYS);
    appointment.derivedTask = { label: taskLabel, done: false, dueDate: isoDate(due) };
  }

  return appointment;
}

async function saveAndMirror(appointment) {
  await db.put('appointments', appointment);
  // Reminders are a soft, often dateless note — not worth mirroring to Google
  // Calendar (which needs a real start time). Only compromissos sync.
  if (appointment.kind === 'lembrete') return appointment;
  // Best-effort mirror; failures never block local creation.
  mirrorAppointmentToGoogleCalendar(appointment)
    .then((eventId) => {
      if (eventId) {
        appointment.googleEventId = eventId;
        db.put('appointments', appointment);
      }
    })
    .catch(() => { /* integration not configured/authorized — local data is still safe */ });
  return appointment;
}

/**
 * Creates a new appointment, checks for conflicts, generates a derived task
 * when applicable, and (best-effort, non-blocking) mirrors it to Google
 * Calendar if the integration is connected.
 *
 * Pass `recurrence: { freq: 'daily'|'weekly', daysOfWeek, until }` to create
 * a repeating series (e.g. "academia toda terça e quinta") instead of a
 * single appointment — see generateRecurringSeries below. Each occurrence is
 * still an independent Appointment record (own status/attachments/derived
 * task), linked only by `recurrence.groupId`; the rule itself lives in the
 * `recurrenceSeries` store and keeps generating new occurrences on a rolling
 * window as time passes (see extendRecurringAppointments).
 */
export async function createAppointment({ title, type, datetime, source, kind = 'compromisso', recurrence = null }) {
  if (recurrence) {
    return generateRecurringSeries({ title, type, datetime, source, recurrence });
  }

  // Reminders don't have a fixed time slot to conflict over — no date at
  // all is a valid reminder ("some day"), so there's nothing to check.
  const conflicts = kind === 'lembrete' ? [] : await checkConflicts(datetime);
  const appointment = await saveAndMirror(buildAppointmentRecord({ title, type, datetime, source, kind }));
  return { appointment, conflicts, occurrencesCreated: 1, occurrenceConflictCount: 0 };
}

// ---------------------------------------------------------------------------
// Recurring series
// ---------------------------------------------------------------------------

const RECURRENCE_WINDOW_DAYS = 56; // ~8 weeks, topped up every time the app loads

function addDaysToISODate(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return isoDate(addDays(new Date(y, m - 1, d), n));
}

/** All dates in (fromExclusive, toInclusive] matching the series rule, respecting series.until. */
function computeOccurrenceDates(series, fromExclusiveISO, toInclusiveISO) {
  const end = series.until && series.until < toInclusiveISO ? series.until : toInclusiveISO;
  const dates = [];
  let cur = addDaysToISODate(fromExclusiveISO, 1);
  while (cur <= end) {
    const [y, m, d] = cur.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    if (series.freq === 'daily' || (series.freq === 'weekly' && series.daysOfWeek.includes(dow))) {
      dates.push(cur);
    }
    cur = addDaysToISODate(cur, 1);
  }
  return dates;
}

async function generateRecurringSeries({ title, type, datetime, source, recurrence }) {
  const [startDate, timeOfDay] = datetime.split('T');
  const series = {
    id: uid(),
    title: title || 'Compromisso',
    type: type || 'outro',
    source: source || 'manual',
    freq: recurrence.freq,
    daysOfWeek: recurrence.freq === 'weekly' ? (recurrence.daysOfWeek || []) : null,
    until: recurrence.until || null,
    timeOfDay,
    lastGeneratedDate: startDate,
  };

  const conflicts = await checkConflicts(datetime);
  const firstOccurrence = buildAppointmentRecord({ title, type, datetime, source, recurrenceGroupId: series.id });
  await saveAndMirror(firstOccurrence);

  const windowEnd = addDaysToISODate(isoDate(new Date()), RECURRENCE_WINDOW_DAYS);
  const moreDates = computeOccurrenceDates(series, startDate, windowEnd);
  let occurrenceConflictCount = 0;
  for (const date of moreDates) {
    const occDatetime = `${date}T${timeOfDay}`;
    const occConflicts = await checkConflicts(occDatetime);
    if (occConflicts.length > 0) occurrenceConflictCount++;
    await saveAndMirror(buildAppointmentRecord({ title, type, datetime: occDatetime, source, recurrenceGroupId: series.id }));
  }

  series.lastGeneratedDate = moreDates.length > 0 ? moreDates[moreDates.length - 1] : startDate;
  await db.put('recurrenceSeries', series);

  return {
    appointment: firstOccurrence,
    conflicts,
    occurrencesCreated: 1 + moreDates.length,
    occurrenceConflictCount,
  };
}

/**
 * Tops up every active recurring series so occurrences exist up to ~8 weeks
 * ahead. Call this on app load — there's no background job, so a series
 * simply catches up the next time the user opens the app. Safe to call
 * often: it never re-creates a date it has already generated (advances a
 * monotonic `lastGeneratedDate` watermark per series), so a single
 * occurrence the user deleted on purpose is never resurrected.
 */
export async function extendRecurringAppointments() {
  const allSeries = await db.getAll('recurrenceSeries');
  const today = isoDate(new Date());
  const windowEnd = addDaysToISODate(today, RECURRENCE_WINDOW_DAYS);

  for (const series of allSeries) {
    if (series.until && series.until < today) continue; // series has ended
    if (series.lastGeneratedDate >= windowEnd) continue; // already topped up

    const newDates = computeOccurrenceDates(series, series.lastGeneratedDate, windowEnd);
    for (const date of newDates) {
      const occDatetime = `${date}T${series.timeOfDay}`;
      await saveAndMirror(buildAppointmentRecord({
        title: series.title, type: series.type, datetime: occDatetime, source: series.source, recurrenceGroupId: series.id,
      }));
    }
    series.lastGeneratedDate = windowEnd;
    await db.put('recurrenceSeries', series);
  }
}

export async function getRecurrenceSeries(groupId) {
  return db.get('recurrenceSeries', groupId);
}

/**
 * Cancels a recurring series from a given occurrence onward: deletes that
 * occurrence and any already-generated future ones, and freezes the series
 * (`until` = the day before) so extendRecurringAppointments never generates
 * past this point again. Occurrences before this date are untouched —
 * appointments are a permanent record, so history never disappears.
 */
export async function cancelRecurrenceFromHere(appointmentId) {
  const appt = await db.get('appointments', appointmentId);
  if (!appt?.recurrence) return;
  const { groupId } = appt.recurrence;
  const cutoff = appt.datetime.slice(0, 10);

  const all = await db.getAll('appointments');
  const toDelete = all.filter((a) => a.recurrence?.groupId === groupId && a.datetime.slice(0, 10) >= cutoff);
  await Promise.all(toDelete.map((a) => deleteAppointment(a.id)));

  const series = await db.get('recurrenceSeries', groupId);
  if (series) {
    const dayBefore = addDaysToISODate(cutoff, -1);
    series.until = series.until && series.until < dayBefore ? series.until : dayBefore;
    if (series.lastGeneratedDate > dayBefore) series.lastGeneratedDate = dayBefore;
    await db.put('recurrenceSeries', series);
  }
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
  // A dateless reminder ("some day") has nothing to compare against a date
  // range, so a from/to filter naturally excludes it rather than erroring.
  if (from) all = all.filter((a) => a.datetime && a.datetime >= from);
  if (to) all = all.filter((a) => a.datetime && a.datetime <= to);
  return all.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
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

/** Toggles a reminder between pending and done — the lembrete equivalent of "Você foi?", but a plain checkbox instead of an attendance prompt. */
export async function toggleLembreteDone(id) {
  const appt = await db.get('appointments', id);
  if (!appt || appt.kind !== 'lembrete') return null;
  appt.status = appt.status === 'confirmado' ? 'pendente' : 'confirmado';
  await db.put('appointments', appt);
  return appt;
}

export async function toggleDerivedTask(id) {
  const appt = await db.get('appointments', id);
  if (!appt || !appt.derivedTask) return null;
  appt.derivedTask.done = !appt.derivedTask.done;
  await db.put('appointments', appt);
  return appt;
}

/** Returns appointments whose time has passed but are still "pendente" — used to trigger the "Você foi?" prompt. Reminders never get this prompt. */
export async function getOverduePending() {
  const all = await db.getAll('appointments');
  const now = Date.now();
  return all.filter((a) => a.kind !== 'lembrete' && a.status === 'pendente' && new Date(a.datetime).getTime() < now);
}

/** Returns upcoming appointments/reminders within the reminder window that haven't been reminded yet. A dateless reminder has nothing to schedule a notification for. */
export async function getUpcomingForReminder(withinMinutes) {
  const all = await db.getAll('appointments');
  const now = Date.now();
  const windowMs = withinMinutes * 60 * 1000;
  return all.filter((a) => {
    if (a.status !== 'pendente' || !a.datetime) return false;
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
