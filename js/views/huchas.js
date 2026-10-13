// =========================================================
// huchas.js — sección "Huchas" (en la vista de Gráficas):
// saldos, aportaciones del mes, saldo inicial/ajustes, alta y edición.
// Los movimientos viven en FUNDING; las huchas en HUCHAS.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatDateShort, formatMonth } from '../utils/formatters.js';

const ROOT_ID = 'huchas-section';
const TYPES = [
  { key: 'objetivo',  label: 'Objetivos',   help: 'Ahorro para algo concreto (PC, viajes, Navidades…)' },
  { key: 'provision', label: 'Provisiones', help: 'Gastos que sabes que llegarán (ITV, seguros, lentillas…)' },
];

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (state.catalogFormat !== 'v2') { root.replaceChildren(); return; }

  const month = _thisMonth();
  const active = state.huchas.filter(h => h.status === 'active');
  const total = active.reduce((s, h) => s + state.getHuchaBalance(h.name), 0);
  const pending = active
    .map(h => ({ h, left: state.getHuchaPlanned(month, h.name) - state.getHuchaContributed(month, h.name) }))
    .filter(x => x.left > 0.004);

  root.replaceChildren(...[
    el('div', { class: 'debts-header' },
      el('div', { class: 'debts-title' }, el('span', { class: 'debts-icon' }, '🐷'), el('span', {}, 'Huchas')),
      el('div', { class: 'future-totals' }, el('div', { class: 'future-total' }, formatCurrency(total))),
    ),
    pending.length > 0 ? _pendingBanner(month, pending) : null,
    ...TYPES.map(t => _group(t, active.filter(h => h.type === t.key))),
    el('div', { class: 'debts-actions' },
      el('button', { class: 'btn btn-primary debts-add-btn', onclick: () => _openEdit(null) }, '+ Nueva hucha')),
    state.huchas.some(h => h.status !== 'active')
      ? el('p', { class: 'muted small' }, `Archivadas: ${state.huchas.filter(h => h.status !== 'active').map(h => h.name).join(', ')}`)
      : null,
  ].filter(Boolean));   // replaceChildren pintaría los null como texto
}

function _pendingBanner(month, pending) {
  const sum = pending.reduce((s, x) => s + x.left, 0);
  return el('div', { class: 'hucha-pending' },
    el('div', {}, `Aportaciones previstas en ${formatMonth(month)}: `, el('b', {}, formatCurrency(sum)),
      el('div', { class: 'muted small' }, 'Cuando hagas la transferencia a la cuenta de ahorro, regístrala aquí.')),
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _registerContributions(month, pending) }, 'Ya la hice'),
  );
}

function _group(type, list) {
  if (list.length === 0) return null;
  return el('div', { class: 'hucha-group' },
    el('div', { class: 'cat-group-title' }, type.label),
    el('div', { class: 'debts-list' }, ...list
      .map(h => ({ h, balance: state.getHuchaBalance(h.name) }))
      .sort((a, b) => b.balance - a.balance)
      .map(({ h, balance }) => _row(h, balance))),
  );
}

function _row(h, balance) {
  const pct = h.target > 0 ? Math.min(100, Math.round(balance / h.target * 100)) : null;
  return el('div', {
    class: 'debt-item hucha-row', role: 'button', tabindex: '0',
    onclick: () => _openDetail(h),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') _openDetail(h); },
  },
    el('div', { class: 'debt-item-main' },
      el('div', { class: 'debt-item-reason' }, h.name),
      el('div', { class: 'debt-item-meta' },
        h.target > 0 ? `${pct}% de ${formatCurrency(h.target, true)}${h.targetDate ? ` · ${formatMonth(h.targetDate)}` : ''}` : 'Sin objetivo'),
      pct !== null ? el('div', { class: 'hucha-bar' }, el('div', { class: 'hucha-bar-fill', style: { width: `${pct}%` } })) : null,
    ),
    el('div', { class: `debt-item-amount ${balance < 0 ? 'hucha-negative' : ''}` }, formatCurrency(balance)),
  );
}

// =========================================================
// Detalle: movimientos + ajustar saldo
// =========================================================

function _openDetail(h) {
  const moves = state.getHuchaMoves(h.name);
  const balance = state.getHuchaBalance(h.name);
  const labels = { aportacion: 'Aportación', retirada: 'Pago', ajuste: 'Ajuste' };
  const txById = new Map(state.transactions.map(t => [t.txId, t]));

  const body = el('div', { class: 'cat-form' },
    el('p', {}, 'Saldo: ', el('b', {}, formatCurrency(balance))),
    moves.length === 0
      ? el('p', { class: 'muted small' }, 'Aún no tiene movimientos. Si ya tienes dinero apartado para esto, usa "Ajustar saldo".')
      : el('div', { class: 'hucha-moves' }, ...moves.slice(0, 30).map(m => {
          const tx = m.txId ? txById.get(m.txId) : null;
          const sign = m.kind === 'retirada' ? -1 : 1;
          return el('div', { class: 'hucha-move' },
            el('span', {}, `${formatDateShort(m.date || `${m.month}-01`)} · ${labels[m.kind] ?? m.kind}`,
              tx ? el('span', { class: 'muted small' }, ` · ${tx.description || tx.budgetKey}`) : null,
              m.note && !tx ? el('span', { class: 'muted small' }, ` · ${m.note}`) : null),
            el('span', { class: sign < 0 ? 'hucha-negative' : 'hucha-positive' }, formatCurrency(sign * m.amount)),
          );
        })),
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openEdit(h) }, 'Editar'),
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openAdjust(h) }, 'Ajustar saldo'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => closeModal() }, 'Cerrar'),
  );
  openModal(`🐷 ${h.name}`, body, footer);
}

function _openAdjust(h) {
  const balance = state.getHuchaBalance(h.name);
  const input = el('input', {
    class: 'modal-input', type: 'number', inputmode: 'decimal', step: '0.01', value: String(balance),
  });
  const body = el('div', { class: 'cat-form' },
    el('p', { class: 'muted small' },
      'Pon el dinero que hay ahora mismo en esta hucha (por ejemplo, lo que ya tenías ahorrado). ',
      'Se guarda la diferencia como ajuste, así el historial cuadra.'),
    _inputGroup('Saldo real (€)', input),
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openDetail(h) }, 'Volver'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const target = Number(input.value);
        if (input.value === '' || isNaN(target)) { showToast('Importe inválido', 'error'); return; }
        const diff = Math.round((target - balance) * 100) / 100;
        closeModal();
        if (diff === 0) return;
        await _run('Ajustando saldo…', () => sheets.appendFunding([{
          date: _today(), month: _thisMonth(), source: `HUCHA:${h.name}`, amount: diff, kind: 'ajuste',
          note: balance === 0 && state.getHuchaMoves(h.name).length === 0 ? 'saldo inicial' : 'ajuste manual',
        }]), `Saldo de ${h.name}: ${formatCurrency(target)}`);
      },
    }, 'Guardar'),
  );
  openModal(`Ajustar saldo · ${h.name}`, body, footer);
}

// =========================================================
// Alta / edición
// =========================================================

function _openEdit(h) {
  const name = el('input', { class: 'modal-input', type: 'text', maxlength: '40', value: h?.name ?? '', placeholder: 'Ej: NAVIDADES' });
  const type = el('select', { class: 'modal-select' },
    ...TYPES.map(t => el('option', { value: t.key, selected: (h?.type ?? 'objetivo') === t.key }, `${t.label.slice(0, -1)} · ${t.help}`)));
  const target = el('input', { class: 'modal-input', type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: h?.target ? String(h.target) : '', placeholder: 'opcional' });
  const date = el('input', { class: 'modal-input', type: 'month', value: h?.targetDate ?? '' });
  const active = el('input', { type: 'checkbox', checked: (h?.status ?? 'active') === 'active' });

  const body = el('div', { class: 'cat-form' },
    _inputGroup('Nombre', name),
    _inputGroup('Tipo', type),
    el('div', { class: 'cat-form-fields cat-form-row' }, _inputGroup('Objetivo (€)', target), _inputGroup('Para (mes)', date)),
    el('label', { class: 'cat-active' }, active, el('span', {}, 'Activa (desmárcala para archivarla; conserva su historial)')),
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const n = name.value.trim().toUpperCase().replace(/\s+/g, ' ');
        if (!n) { showToast('Indica un nombre', 'error'); return; }
        if (state.huchas.some(x => x.name === n && x.name !== h?.name)) { showToast('Ya existe una hucha con ese nombre', 'error'); return; }
        if (date.value && !/^\d{4}-\d{2}$/.test(date.value)) { showToast('Mes inválido (AAAA-MM)', 'error'); return; }
        closeModal();
        await _run('Guardando hucha…', () => sheets.saveHucha(h?.name ?? null, {
          name: n, type: type.value, status: active.checked ? 'active' : 'archived',
          target: Number(target.value) || 0, targetDate: date.value, note: h?.note ?? '',
        }), h ? 'Hucha actualizada' : `Hucha ${n} creada`);
      },
    }, 'Guardar'),
  );
  openModal(h ? `Editar ${h.name}` : 'Nueva hucha', body, footer);
}

// =========================================================
// Aportaciones del mes
// =========================================================

async function _registerContributions(month, pending) {
  if (!confirm(`¿Registrar ${pending.length} aportación(es) por ${formatCurrency(pending.reduce((s, x) => s + x.left, 0))}?`)) return;
  await _run('Registrando aportaciones…', () => sheets.appendFunding(pending.map(({ h, left }) => ({
    date: _today(), month, source: `HUCHA:${h.name}`, amount: Math.round(left * 100) / 100,
    kind: 'aportacion', note: `presupuesto ${month}`,
  }))), 'Aportaciones registradas');
}

// =========================================================
// Helpers
// =========================================================

async function _run(loadingText, action, okText) {
  setLoading(true, loadingText);
  try {
    await action();
    render();
    showToast(okText, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

function _inputGroup(label, input) {
  return el('div', { class: 'input-group' }, el('label', { class: 'input-label' }, label), input);
}

function _thisMonth() { return _today().slice(0, 7); }

function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
