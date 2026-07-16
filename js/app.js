// app.js — Bootstraps Fio: wires navigation, forms and modals to the entity
// modules, and owns all DOM rendering. No framework — plain DOM APIs.

import { parseAppointmentText, parseExpenseText } from './parsers.js';
import {
  createAppointment, listAppointments, getAppointment, updateAppointment, deleteAppointment,
  markAttendance, rescheduleAppointment, toggleDerivedTask,
  addAttachment, getAttachmentsForAppointment, deleteAttachment,
} from './appointments.js';
import {
  listCards, createCard, deleteCard,
  listFixedExpenses, createFixedExpense, updateFixedExpense, deleteFixedExpense,
  listVariableExpenses, createVariableExpense, deleteVariableExpense,
  consolidatedMonth, projectAllCardInvoices,
  importFinancialDocument,
} from './finance.js';
import { listAllDocuments, statusLabel } from './documents.js';
import { startNotificationScheduler, onNotificationEvents, requestNotificationPermission } from './notifications.js';
import { startListening, isVoiceSupported } from './voice.js';
import { consumeSharedPayload } from './share.js';
import {
  isGoogleConfigured, isGoogleConnected, connectGoogle, disconnectGoogle,
} from './integrations/google.js';
import { scanRecentEmailsForAppointments, listEmailSuggestions, resolveEmailSuggestion } from './integrations/gmail.js';

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(message, isError = false) {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' is-error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}
function closeModal(id) {
  const dialog = document.getElementById(id);
  if (dialog && dialog.open) dialog.close();
}

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) closeBtn.closest('dialog')?.close();
});
// Clicking the ::backdrop (click landing on the dialog element itself, not its content) closes it.
$$('dialog.modal').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
});

function formatCurrency(value) {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TYPE_LABELS = { consulta: 'Consulta', exame: 'Exame', reuniao: 'Reunião', outro: 'Outro' };
const STATUS_LABELS = { pendente: 'Pendente', confirmado: 'Confirmado', faltou: 'Faltou' };
const PAYMENT_LABELS = { pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', cartao: 'Cartão' };

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

function initTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => { b.classList.remove('is-active'); b.removeAttribute('aria-current'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
      $$('.view').forEach((v) => v.classList.remove('is-active'));
      $(`#view-${btn.dataset.tab}`).classList.add('is-active');
      if (btn.dataset.tab === 'financeiro') renderFinance();
      if (btn.dataset.tab === 'documentos') renderDocuments();
      if (btn.dataset.tab === 'compromissos') renderAppointments();
    });
  });

  $$('.fin-subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.fin-subtab-btn').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      $$('.finsub').forEach((s) => s.classList.remove('is-active'));
      $(`#finsub-${btn.dataset.finsub}`).classList.add('is-active');
    });
  });
}

// ---------------------------------------------------------------------------
// Compromissos — timeline rendering
// ---------------------------------------------------------------------------

async function renderAppointments() {
  const type = $('#filter-appt-type').value;
  const fromDate = $('#filter-appt-from').value;
  const toDate = $('#filter-appt-to').value;
  const items = await listAppointments({
    type: type || null,
    from: fromDate ? `${fromDate}T00:00` : null,
    to: toDate ? `${toDate}T23:59` : null,
  });

  const timeline = $('#appt-timeline');
  timeline.innerHTML = '';
  $('#appt-empty').hidden = items.length > 0;

  const now = Date.now();
  for (const appt of items) {
    const isPastPending = appt.status === 'pendente' && new Date(appt.datetime).getTime() < now;
    const node = document.createElement('div');
    node.className = `timeline-node status-${appt.status}${isPastPending ? ' status-pendente-past' : ''}`;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'appt-card';
    card.dataset.id = appt.id;
    card.innerHTML = `
      <div class="appt-card-top">
        <span class="appt-title">${escapeHtml(appt.title)}</span>
        <span class="appt-datetime">${formatDateTime(appt.datetime)}</span>
      </div>
      <div class="appt-meta">
        <span class="badge badge-type">${TYPE_LABELS[appt.type] || appt.type}</span>
        <span class="badge badge-status-${appt.status}">${isPastPending ? 'Aguardando confirmação' : STATUS_LABELS[appt.status]}</span>
        ${appt.derivedTask ? `<span class="badge ${appt.derivedTask.done ? 'badge-task-done' : 'badge-task-open'}">${escapeHtml(appt.derivedTask.label)}</span>` : ''}
        ${appt.attachments?.length ? `<span class="badge">📎 ${appt.attachments.length}</span>` : ''}
      </div>`;
    card.addEventListener('click', () => openAppointmentDetail(appt.id));

    node.appendChild(card);
    timeline.appendChild(node);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

$('#filter-appt-type').addEventListener('change', renderAppointments);
$('#filter-appt-from').addEventListener('change', renderAppointments);
$('#filter-appt-to').addEventListener('change', renderAppointments);

// ---------------------------------------------------------------------------
// Appointment detail modal
// ---------------------------------------------------------------------------

let currentDetailApptId = null;

async function openAppointmentDetail(id) {
  const appt = await getAppointment(id);
  if (!appt) return;
  currentDetailApptId = id;
  $('#appt-detail-title').textContent = appt.title;

  const isPastPending = appt.status === 'pendente' && new Date(appt.datetime).getTime() < Date.now();
  $('#appt-detail-body').innerHTML = `
    <p><strong>${formatDateTime(appt.datetime)}</strong></p>
    <p class="hint">${TYPE_LABELS[appt.type]} · origem: ${appt.source} · status: ${isPastPending ? 'aguardando confirmação' : STATUS_LABELS[appt.status]}</p>
    ${appt.derivedTask ? `
      <div class="field">
        <label><input type="checkbox" id="detail-task-checkbox" ${appt.derivedTask.done ? 'checked' : ''} style="width:auto;display:inline-block;margin-right:6px;">
        ${escapeHtml(appt.derivedTask.label)} (prazo: ${formatDate(appt.derivedTask.dueDate)})</label>
      </div>` : ''}
    ${appt.status === 'pendente' ? `<button type="button" class="btn btn-secondary btn-small" id="btn-manual-attendance">Registrar comparecimento</button>` : ''}
  `;

  $('#detail-task-checkbox')?.addEventListener('change', async () => {
    await toggleDerivedTask(id);
    renderAppointments();
  });
  $('#btn-manual-attendance')?.addEventListener('click', () => {
    closeModal('modal-appt-detail');
    showAttendancePrompt(appt);
  });

  await renderAttachmentsList(id);

  $('#btn-delete-appt').onclick = async () => {
    if (!confirm('Excluir este compromisso e seus anexos? Esta ação não pode ser desfeita.')) return;
    await deleteAppointment(id);
    closeModal('modal-appt-detail');
    toast('Compromisso excluído.');
    renderAppointments();
  };

  openModal('modal-appt-detail');
}

async function renderAttachmentsList(appointmentId) {
  const attachments = await getAttachmentsForAppointment(appointmentId);
  const list = $('#appt-attachments-list');
  list.innerHTML = '';
  for (const att of attachments) {
    const li = document.createElement('li');
    li.className = 'list-item';
    const url = URL.createObjectURL(att.blob);
    li.innerHTML = `
      <div class="list-item-main">
        <a class="list-item-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(att.name)}</a>
        <div class="list-item-sub">${formatDate(att.uploadedAt)}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="icon-btn" aria-label="Remover anexo">🗑</button>
      </div>`;
    li.querySelector('button').addEventListener('click', async () => {
      await deleteAttachment(att.id, appointmentId);
      renderAttachmentsList(appointmentId);
      renderAppointments();
    });
    list.appendChild(li);
  }
}

$('#appt-attach-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentDetailApptId) return;
  await addAttachment(currentDetailApptId, file);
  toast(`Anexo "${file.name}" salvo.`);
  renderAttachmentsList(currentDetailApptId);
  renderAppointments();
  e.target.value = '';
});

// ---------------------------------------------------------------------------
// "Você foi?" attendance flow + reschedule
// ---------------------------------------------------------------------------

const promptedAttendanceIds = new Set();

function showAttendancePrompt(appt) {
  $('#attendance-appt-label').textContent = `${appt.title} — ${formatDateTime(appt.datetime)}`;
  $('#btn-attendance-yes').onclick = async () => {
    await markAttendance(appt.id, true);
    closeModal('modal-attendance');
    toast('Confirmado — que bom que você foi!');
    renderAppointments();
  };
  $('#btn-attendance-no').onclick = async () => {
    await markAttendance(appt.id, false);
    closeModal('modal-attendance');
    openRescheduleModal(appt.id);
  };
  openModal('modal-attendance');
}

function openRescheduleModal(appointmentId) {
  const now = new Date();
  $('#reschedule-date').value = now.toISOString().slice(0, 10);
  $('#reschedule-time').value = '09:00';
  $('#btn-confirm-reschedule').onclick = async () => {
    const date = $('#reschedule-date').value;
    const time = $('#reschedule-time').value;
    if (!date || !time) { toast('Preencha data e hora.', true); return; }
    await rescheduleAppointment(appointmentId, `${date}T${time}`);
    closeModal('modal-reschedule');
    toast('Compromisso reagendado.');
    renderAppointments();
  };
  openModal('modal-reschedule');
}

// ---------------------------------------------------------------------------
// Nova captura modal
// ---------------------------------------------------------------------------

let captureKind = 'compromisso';
let activeVoiceStop = null;

function initCaptureModal() {
  $('#btn-fab').addEventListener('click', () => {
    resetCaptureForm();
    openModal('modal-capture');
  });

  $$('.segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      captureKind = btn.dataset.captureKind;
      $$('.segmented-btn').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      const showCompromisso = captureKind === 'compromisso';
      $('#fields-compromisso').hidden = !showCompromisso;
      $('#fields-compromisso').disabled = !showCompromisso;
      $('#fields-gasto').hidden = showCompromisso;
      $('#fields-gasto').disabled = showCompromisso;
    });
  });

  $('#btn-interpret').addEventListener('click', () => interpretCaptureText());

  $('#btn-voice').addEventListener('click', () => {
    if (!isVoiceSupported()) {
      toast('Reconhecimento de voz não é suportado neste navegador.', true);
      return;
    }
    if (activeVoiceStop) {
      activeVoiceStop();
      return;
    }
    const btn = $('#btn-voice');
    btn.classList.add('is-listening');
    $('#voice-status').textContent = 'Ouvindo…';
    const { stop } = startListening({
      onResult: ({ final, interim }) => {
        $('#capture-text').value = final || interim;
      },
      onError: (err) => {
        $('#voice-status').textContent = err.message;
        btn.classList.remove('is-listening');
        activeVoiceStop = null;
      },
      onEnd: (finalText) => {
        btn.classList.remove('is-listening');
        $('#voice-status').textContent = finalText ? 'Transcrito.' : '';
        activeVoiceStop = null;
        if (finalText) interpretCaptureText();
      },
    });
    activeVoiceStop = stop;
  });

  $('#appt-date').addEventListener('change', checkAndShowConflict);
  $('#appt-time').addEventListener('change', checkAndShowConflict);

  $('#exp-payment').addEventListener('change', () => {
    $('#exp-card-field').hidden = $('#exp-payment').value !== 'cartao';
  });

  $('#form-capture').addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitCapture();
  });
}

function resetCaptureForm() {
  $('#capture-text').value = '';
  $('#voice-status').textContent = '';
  $('#capture-source-hint').hidden = true;
  $('#appt-title').value = '';
  $('#appt-type').value = 'outro';
  const now = new Date();
  $('#appt-date').value = now.toISOString().slice(0, 10);
  $('#appt-time').value = '09:00';
  $('#conflict-warning').hidden = true;
  $('#exp-desc').value = '';
  $('#exp-value').value = '';
  $('#exp-category').value = '';
  $('#exp-payment').value = 'pix';
  $('#exp-card-field').hidden = true;
  $('#exp-date').value = now.toISOString().slice(0, 10);
  document.querySelector('.segmented-btn[data-capture-kind="compromisso"]').click();
  window.__fioShareSource = null;
}

function interpretCaptureText() {
  const text = $('#capture-text').value.trim();
  if (!text) return;
  if (captureKind === 'compromisso') {
    const parsed = parseAppointmentText(text);
    if (parsed.title) $('#appt-title').value = parsed.title;
    $('#appt-type').value = parsed.type;
    if (parsed.date) $('#appt-date').value = parsed.date;
    if (parsed.time) $('#appt-time').value = parsed.time;
    if (!parsed.matchedDate || !parsed.matchedTime) {
      toast('Não consegui identificar tudo automaticamente — confira data e hora.', true);
    }
    checkAndShowConflict();
  } else {
    const parsed = parseExpenseText(text);
    $('#exp-desc').value = parsed.desc;
    if (parsed.value != null) $('#exp-value').value = parsed.value;
    if (parsed.category) $('#exp-category').value = parsed.category;
    if (parsed.paymentMethod) {
      $('#exp-payment').value = parsed.paymentMethod;
      $('#exp-card-field').hidden = parsed.paymentMethod !== 'cartao';
    }
  }
}

async function checkAndShowConflict() {
  const date = $('#appt-date').value;
  const time = $('#appt-time').value;
  const warningEl = $('#conflict-warning');
  if (!date || !time) { warningEl.hidden = true; return; }
  const { checkConflicts } = await import('./appointments.js');
  const conflicts = await checkConflicts(`${date}T${time}`);
  if (conflicts.length > 0) {
    warningEl.hidden = false;
    warningEl.textContent = `⚠ Conflito de horário com: ${conflicts.map((c) => c.title).join(', ')} — ainda assim você pode salvar.`;
  } else {
    warningEl.hidden = true;
  }
}

async function submitCapture() {
  if (captureKind === 'compromisso') {
    const title = $('#appt-title').value.trim();
    const date = $('#appt-date').value;
    const time = $('#appt-time').value;
    if (!title || !date || !time) { toast('Preencha título, data e hora.', true); return; }
    const source = window.__fioShareSource || 'manual';
    const { conflicts } = await createAppointment({
      title, type: $('#appt-type').value, datetime: `${date}T${time}`, source,
    });
    closeModal('modal-capture');
    toast(conflicts.length ? 'Compromisso salvo (havia conflito de horário).' : 'Compromisso salvo.');
    renderAppointments();
  } else {
    const value = parseFloat($('#exp-value').value);
    if (!value || value <= 0) { toast('Informe um valor válido.', true); return; }
    await createVariableExpense({
      desc: $('#exp-desc').value.trim() || 'Gasto',
      value,
      category: $('#exp-category').value.trim() || 'outros',
      paymentMethod: $('#exp-payment').value,
      cardId: $('#exp-card').value || null,
      date: $('#exp-date').value,
      source: window.__fioShareSource ? 'compartilhamento' : 'manual',
    });
    closeModal('modal-capture');
    toast('Gasto lançado.');
    renderFinance();
  }
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

let currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

async function refreshCardSelects() {
  const cards = await listCards();
  const options = cards.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('#exp-card').innerHTML = options || '<option value="">Nenhum cartão cadastrado</option>';
  $('#fixed-card').innerHTML = options || '<option value="">Nenhum cartão cadastrado</option>';
}

async function renderFinance() {
  await refreshCardSelects();
  await renderPainel();
  await renderLancamentos();
  await renderFixas();
  await renderCartoes();
}

async function renderPainel() {
  const [y, m] = currentMonth.split('-').map(Number);
  $('#current-month-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const summary = await consolidatedMonth(currentMonth);
  $('#summary-grid').innerHTML = `
    <div class="summary-card">
      <div class="summary-card-label">Despesas fixas provisionadas</div>
      <div class="summary-card-value">${formatCurrency(summary.fixedTotal)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Gastos variáveis (fora do cartão)</div>
      <div class="summary-card-value">${formatCurrency(summary.nonCardVariableTotal)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Faturas de cartão (projeção)</div>
      <div class="summary-card-value">${formatCurrency(summary.cardsTotal)}</div>
    </div>
    <div class="summary-card is-total">
      <div class="summary-card-label">Total geral do mês</div>
      <div class="summary-card-value">${formatCurrency(summary.grandTotal)}</div>
    </div>
  `;

  const projections = summary.cardProjections;
  const cards = await listCards();
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const cpEl = $('#card-projections');
  if (projections.length === 0) {
    cpEl.innerHTML = '<p class="hint">Nenhum cartão cadastrado ainda. Adicione um na aba "Cartões".</p>';
  } else {
    cpEl.innerHTML = projections.map((p) => `
      <div class="card-projection-item">
        <div class="cp-top"><span>${escapeHtml(cardsById.get(p.cardId)?.name || 'Cartão')}</span><span>${formatCurrency(p.total)}</span></div>
        <div class="hint">${p.variableItems.length} lançamento(s) variável(is) · ${formatCurrency(p.variableTotal)} + fixas no cartão: ${formatCurrency(p.fixedTotal)}</div>
      </div>
    `).join('');
  }
}

$('#btn-month-prev').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); renderPainel(); renderLancamentos(); });
$('#btn-month-next').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); renderPainel(); renderLancamentos(); });

async function renderLancamentos() {
  const category = $('#filter-exp-category').value;
  const items = await listVariableExpenses({ month: currentMonth, category: category || null });

  const allItems = await listVariableExpenses({ month: currentMonth });
  const categories = [...new Set(allItems.map((e) => e.category))].sort();
  const currentSelection = $('#filter-exp-category').value;
  $('#filter-exp-category').innerHTML = '<option value="">Todas as categorias</option>'
    + categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('#filter-exp-category').value = currentSelection;

  const list = $('#variable-expense-list');
  list.innerHTML = '';
  $('#expense-empty').hidden = items.length > 0;
  for (const exp of items) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(exp.desc)}</div>
        <div class="list-item-sub">${formatDate(exp.date)} · ${exp.category} · ${PAYMENT_LABELS[exp.paymentMethod] || exp.paymentMethod}</div>
      </div>
      <div class="list-item-value">${formatCurrency(exp.value)}</div>
      <div class="list-item-actions"><button type="button" class="icon-btn" aria-label="Excluir lançamento">🗑</button></div>`;
    li.querySelector('button').addEventListener('click', async () => {
      await deleteVariableExpense(exp.id);
      renderLancamentos();
      renderPainel();
    });
    list.appendChild(li);
  }
}
$('#filter-exp-category').addEventListener('change', renderLancamentos);

async function renderFixas() {
  const items = await listFixedExpenses();
  const cards = await listCards();
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const list = $('#fixed-expense-list');
  list.innerHTML = '';
  for (const exp of items) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(exp.label)}</div>
        <div class="list-item-sub">Vence dia ${exp.dueDay}${exp.isCreditCard ? ` · cartão: ${escapeHtml(cardsById.get(exp.cardId)?.name || '—')}` : ''}</div>
      </div>
      <div class="list-item-value">${formatCurrency(exp.value)}</div>`;
    li.addEventListener('click', () => openFixedExpenseModal(exp));
    list.appendChild(li);
  }
}

async function renderCartoes() {
  const items = await listCards();
  const list = $('#card-list');
  list.innerHTML = '';
  for (const card of items) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(card.name)}</div>
        <div class="list-item-sub">Fecha dia ${card.closingDay || '—'} · vence dia ${card.dueDay || '—'}</div>
      </div>
      <div class="list-item-actions"><button type="button" class="icon-btn" aria-label="Excluir cartão">🗑</button></div>`;
    li.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Excluir o cartão "${card.name}"?`)) return;
      await deleteCard(card.id);
      renderFinance();
    });
    list.appendChild(li);
  }
}

let editingFixedId = null;
function openFixedExpenseModal(exp = null) {
  editingFixedId = exp ? exp.id : null;
  $('#fixed-label').value = exp?.label || '';
  $('#fixed-value').value = exp?.value ?? '';
  $('#fixed-dueday').value = exp?.dueDay ?? '';
  $('#fixed-iscard').checked = !!exp?.isCreditCard;
  $('#fixed-card-field').hidden = !exp?.isCreditCard;
  if (exp?.cardId) $('#fixed-card').value = exp.cardId;
  $('#btn-delete-fixed').hidden = !exp;
  openModal('modal-fixed');
}
$('#btn-add-fixed').addEventListener('click', () => openFixedExpenseModal());
$('#fixed-iscard').addEventListener('change', () => { $('#fixed-card-field').hidden = !$('#fixed-iscard').checked; });
$('#form-fixed').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    label: $('#fixed-label').value.trim(),
    value: parseFloat($('#fixed-value').value),
    dueDay: parseInt($('#fixed-dueday').value, 10),
    isCreditCard: $('#fixed-iscard').checked,
    cardId: $('#fixed-iscard').checked ? $('#fixed-card').value : null,
  };
  if (!data.label || !data.value || !data.dueDay) { toast('Preencha nome, valor e dia de vencimento.', true); return; }
  if (editingFixedId) {
    await updateFixedExpense({ id: editingFixedId, active: true, ...data });
  } else {
    await createFixedExpense(data);
  }
  closeModal('modal-fixed');
  toast('Despesa fixa salva.');
  renderFinance();
});
$('#btn-delete-fixed').addEventListener('click', async () => {
  if (!editingFixedId) return;
  if (!confirm('Excluir esta despesa fixa?')) return;
  await deleteFixedExpense(editingFixedId);
  closeModal('modal-fixed');
  toast('Despesa fixa excluída.');
  renderFinance();
});

$('#btn-add-card').addEventListener('click', () => {
  $('#card-name').value = '';
  $('#card-closing').value = '';
  $('#card-due').value = '';
  openModal('modal-card');
});
$('#form-card').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#card-name').value.trim();
  if (!name) { toast('Informe o nome do cartão.', true); return; }
  await createCard({
    name,
    closingDay: $('#card-closing').value ? parseInt($('#card-closing').value, 10) : null,
    dueDay: $('#card-due').value ? parseInt($('#card-due').value, 10) : null,
  });
  closeModal('modal-card');
  toast('Cartão adicionado.');
  renderFinance();
});

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

async function renderDocuments() {
  const kind = $('#filter-doc-kind').value;
  const items = await listAllDocuments({ kind: kind || null });
  const list = $('#documents-list');
  list.innerHTML = '';
  $('#documents-empty').hidden = items.length > 0;
  for (const doc of items) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(doc.name)}</div>
        <div class="list-item-sub">${formatDate(doc.date)} · ${doc.kind === 'appointment' ? 'compromisso' : 'financeiro'} · ${escapeHtml(doc.refLabel)}</div>
      </div>`;
    list.appendChild(li);
  }
}
$('#filter-doc-kind').addEventListener('change', renderDocuments);

$('#btn-upload-doc').addEventListener('click', () => $('#input-upload-doc').click());
$('#input-upload-doc').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { document: doc, importedExpenses, errors } = await importFinancialDocument(file);
  if (doc.parseStatus === 'parsed') {
    toast(`"${file.name}": ${importedExpenses.length} lançamento(s) importado(s).`);
  } else if (doc.parseStatus === 'pending_ocr') {
    toast(`"${file.name}" arquivado — aguardando leitura automática (OCR) em versão futura.`);
  } else {
    toast(`"${file.name}" arquivado, mas não consegui extrair lançamentos. ${errors[0] || ''}`, true);
  }
  renderDocuments();
  renderFinance();
  e.target.value = '';
});

// ---------------------------------------------------------------------------
// Ajustes (settings) modal
// ---------------------------------------------------------------------------

function initSettingsModal() {
  $('#btn-settings').addEventListener('click', () => {
    refreshSettingsStatus();
    openModal('modal-settings');
  });

  $('#btn-enable-notifications').addEventListener('click', async () => {
    const perm = await requestNotificationPermission();
    refreshSettingsStatus();
    if (perm === 'granted') toast('Notificações ativadas.');
    else if (perm === 'unsupported') toast('Este navegador não suporta notificações.', true);
    else toast('Permissão de notificação negada.', true);
  });

  $('#btn-google-connect').addEventListener('click', async () => {
    if (!isGoogleConfigured()) {
      toast('Configure GOOGLE_CLIENT_ID em config.js para ativar esta integração.', true);
      return;
    }
    if (isGoogleConnected()) {
      disconnectGoogle();
      toast('Google desconectado.');
    } else {
      try {
        await connectGoogle();
        toast('Google Agenda conectado — novos compromissos serão espelhados automaticamente.');
      } catch (err) {
        toast(`Falha ao conectar: ${err.message}`, true);
      }
    }
    refreshSettingsStatus();
  });

  $('#btn-gmail-scan').addEventListener('click', async () => {
    try {
      const found = await scanRecentEmailsForAppointments();
      toast(found.length ? `${found.length} sugestão(ões) encontrada(s).` : 'Nenhuma sugestão nova encontrada.');
      renderEmailSuggestions();
    } catch (err) {
      toast(err.message, true);
    }
  });

  renderEmailSuggestions();
}

function refreshSettingsStatus() {
  $('#notification-status').textContent = ('Notification' in window)
    ? `Status: ${Notification.permission === 'granted' ? 'ativadas' : Notification.permission === 'denied' ? 'negadas' : 'não solicitadas'}`
    : 'Não suportado neste navegador.';

  $('#google-status').textContent = !isGoogleConfigured()
    ? 'Não configurado (edite config.js).'
    : isGoogleConnected() ? 'Conectado.' : 'Desconectado.';
  $('#btn-google-connect').textContent = isGoogleConnected() ? 'Desconectar Google' : 'Conectar Google';
}

async function renderEmailSuggestions() {
  const suggestions = await listEmailSuggestions();
  const list = $('#email-suggestions-list');
  list.innerHTML = '';
  for (const s of suggestions) {
    const li = document.createElement('li');
    li.className = 'list-item';
    const p = s.suggested;
    li.innerHTML = `
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(s.subject)}</div>
        <div class="list-item-sub">${escapeHtml(p.title || '')} ${p.date ? `· ${formatDate(p.date)}` : ''} ${p.time ? `${p.time}` : ''}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-small btn-text" data-action="dismiss">Ignorar</button>
        <button type="button" class="btn btn-small btn-secondary" data-action="accept">Criar</button>
      </div>`;
    li.querySelector('[data-action="dismiss"]').addEventListener('click', async () => {
      await resolveEmailSuggestion(s.id, 'dismissed');
      renderEmailSuggestions();
    });
    li.querySelector('[data-action="accept"]').addEventListener('click', async () => {
      await createAppointment({
        title: p.title || s.subject,
        type: p.type || 'outro',
        datetime: p.date && p.time ? `${p.date}T${p.time}` : `${p.date || new Date().toISOString().slice(0, 10)}T09:00`,
        source: 'email',
      });
      await resolveEmailSuggestion(s.id, 'accepted');
      toast('Compromisso criado a partir do e-mail.');
      renderEmailSuggestions();
      renderAppointments();
    });
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Share target handling
// ---------------------------------------------------------------------------

function handleIncomingShare() {
  const payload = consumeSharedPayload();
  if (!payload) return;
  resetCaptureForm();
  window.__fioShareSource = payload.source;
  $('#capture-text').value = payload.rawText;
  $('#capture-source-hint').hidden = false;
  $('#capture-source-hint').textContent = `Recebido via compartilhamento (origem detectada: ${payload.source}).`;
  // Heuristic: money-looking content routes to the expense form.
  const looksLikeExpense = /r\$\s?\d|valor|total|nota fiscal|comprovante/i.test(payload.rawText);
  document.querySelector(`.segmented-btn[data-capture-kind="${looksLikeExpense ? 'gasto' : 'compromisso'}"]`).click();
  interpretCaptureText();
  openModal('modal-capture');
}

// ---------------------------------------------------------------------------
// Notifications wiring
// ---------------------------------------------------------------------------

function initNotifications() {
  onNotificationEvents({
    onAttendancePrompt: (appt) => {
      if (promptedAttendanceIds.has(appt.id)) return;
      if (document.getElementById('modal-attendance').open) return;
      promptedAttendanceIds.add(appt.id);
      showAttendancePrompt(appt);
    },
    onReminder: (appt) => toast(`Lembrete: ${appt.title} em breve.`),
    onExpenseDueSoon: (exp) => toast(`Conta a vencer: ${exp.label} — ${formatCurrency(exp.value)} (dia ${exp.dueDay}).`),
  });
  startNotificationScheduler();
}

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[Fio] Falha ao registrar service worker:', err);
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  initTabs();
  initCaptureModal();
  initSettingsModal();
  registerServiceWorker();
  initNotifications();

  await renderAppointments();
  handleIncomingShare();
}

init();
