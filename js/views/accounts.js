// =========================================================
// accounts.js — cuentas bancarias (pestaña Dinero → Cuentas) y
// transferencias del mes: cuánto pasar a cada cuenta al validar el presupuesto.
// En cada cuenta secundaria se eligen los ingresos, huchas, inversiones y gastos
// que viven en ella; lo demás vive en la principal.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatMonth } from '../utils/formatters.js';
import { isInvestmentCode } from '../utils/categoryCodes.js';

const ROOT_ID = 'accounts-section';

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (state.catalogFormat !== 'v2') { root.replaceChildren(); return; }

  const month = _thisMonth();
  const main = state.getMainAccount();
  const list = [...state.accounts].sort((a, b) =>
    Number(b === main) - Number(a === main) || Number(b.status === 'active') - Number(a.status === 'active'));

  root.replaceChildren(...[
    el('div', { class: 'debts-header' },
      el('div', { class: 'debts-title' }, el('span', { class: 'debts-icon' }, '🏦'), el('span', {}, 'Cuentas')),
    ),
    state.accounts.length === 0 ? el('p', { class: 'muted small' },
      'Crea tus cuentas (la de la nómina, la de ocio, la conjunta, la de ahorro…) y elige qué vive en cada una. ',
      'Al validar el presupuesto sabrás cuánto pasar a cada cuenta.') : null,
    state.getActiveAccounts().length >= 2 ? el('div', { class: 'account-transfers' },
      el('div', { class: 'cat-group-title' }, `Transferencias de ${formatMonth(month)}`),
      _transfersBody(month, render)) : null,
    list.length ? el('div', { class: 'debts-list' }, ...list.map(a => _row(a, main))) : null,
    el('div', { class: 'debts-actions' },
      el('button', { class: 'btn btn-primary debts-add-btn', onclick: () => _openEdit(null) }, '+ Nueva cuenta')),
  ].filter(Boolean));
}

function _row(a, main) {
  const isMain = a === main;
  const count = p => a.items.filter(i => i.startsWith(p)).length;
  const parts = isMain ? ['Todo lo que no asignes a otra cuenta'] : [
    count('INC:') ? `${count('INC:')} ingreso(s)` : null,
    count('HUCHA:') ? `${count('HUCHA:')} hucha(s)` : null,
    count('CAT:') ? `${count('CAT:')} categoría(s)` : null,
    a.items.includes('@AHORRO') ? 'ahorro libre' : null,
    a.items.includes('@IMPREVISTOS') ? 'colchón' : null,
  ].filter(Boolean);
  return el('div', {
    class: `debt-item account-row ${a.status === 'active' ? '' : 'is-archived'}`, role: 'button', tabindex: '0',
    onclick: () => _openEdit(a),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') _openEdit(a); },
  },
    el('div', { class: 'debt-item-main' },
      el('div', { class: 'debt-item-reason' }, a.name, isMain ? el('span', { class: 'account-main-badge' }, '★ principal') : null),
      el('div', { class: 'debt-item-meta' },
        a.status === 'active' ? (parts.join(' · ') || 'Sin nada asignado todavía') : 'Archivada'),
    ),
  );
}

// =========================================================
// Transferencias del mes
// =========================================================

/** Abre en un modal las transferencias de `month` (tras guardar el presupuesto, o desde el aviso) */
export function openTransfers(month, onDone) {
  const refresh = () => {
    openModal(`Transferencias de ${formatMonth(month)}`, _transfersBody(month, refresh),
      el('div', { style: { display: 'contents' } },
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => { closeModal(); onDone?.(); } }, 'Listo')));
  };
  refresh();
}

/** Transferencias pendientes de un mes (para avisos) */
export function pendingTransfers(month) {
  return state.getTransferPlan(month).list.filter(t => t.pending > 0.004);
}

function _transfersBody(month, refresh) {
  if (!state.getPlanSourceMonth(month)) return el('p', { class: 'muted small' }, 'Este mes aún no tiene presupuesto.');
  const plan = state.getTransferPlan(month);
  const pending = plan.list.filter(t => t.pending > 0.004);

  return el('div', { class: 'transfers' }, ...[
    plan.list.length === 0 ? el('p', { class: 'muted small' }, '✅ Cada cuenta ya tiene lo suyo: no hace falta mover dinero.') : null,
    ...plan.list.map(t => _transferRow(month, t, plan, refresh)),
    plan.short > 0.004 ? el('p', { class: 'transfer-short' },
      `⚠️ El presupuesto supera los ingresos en ${formatCurrency(plan.short)}: alguna cuenta se quedará corta.`) : null,
    pending.length > 1 ? el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm',
      onclick: () => _markDone(month, pending, refresh),
    }, `Marcar todas como hechas (${formatCurrency(pending.reduce((s, t) => s + t.pending, 0))})`) : null,
    el('details', { class: 'transfer-detail' },
      el('summary', { class: 'muted small' }, 'Ver qué necesita cada cuenta'),
      ...plan.accounts.map(a => el('div', { class: 'transfer-account' },
        el('div', { class: 'coverage-line' }, el('b', {}, a.name), el('span', {}, `necesita ${formatCurrency(a.need)}`)),
        ...a.inflows.map(i => el('div', { class: 'coverage-line muted small' }, el('span', {}, `+ ${i.key} (ingreso)`), el('span', {}, formatCurrency(i.amount)))),
        ...a.needs.sort((x, y) => y.amount - x.amount)
          .map(n => el('div', { class: 'coverage-line muted small' }, el('span', {}, planLabel(n.key)), el('span', {}, formatCurrency(n.amount)))),
      ))),
  ].filter(Boolean));
}

function _transferRow(month, t, plan, refresh) {
  const done = t.pending < 0.005;
  const to = plan.accounts.find(a => a.name === t.to);
  const purpose = t.leftover
    ? `Lo que sobra en ${t.from} después de cubrir lo suyo`
    : 'Para: ' + (to?.needs ?? []).sort((a, b) => b.amount - a.amount).slice(0, 4)
        .map(n => `${planLabel(n.key)} ${formatCurrency(n.amount, true)}`).join(' · ')
      + ((to?.needs.length ?? 0) > 4 ? ' …' : '');
  return el('div', { class: `transfer-row ${done ? 'is-done' : ''}` },
    el('div', { class: 'transfer-main' },
      el('span', { class: 'transfer-route' }, `${t.from} → ${t.to}`),
      el('b', {}, formatCurrency(done ? t.amount : t.pending))),
    el('div', { class: 'muted small' }, purpose,
      !done && t.done > 0.004 ? ` · ya pasaste ${formatCurrency(t.done, true)}` : ''),
    done
      ? el('div', { class: 'transfer-actions' },
          el('span', { class: 'transfer-ok' }, '✓ Hecha'),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => _undo(month, t, refresh) }, 'Deshacer'))
      : el('div', { class: 'transfer-actions' },
          el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => _markDone(month, [t], refresh) }, 'Hecha')),
  );
}

/** Registra transferencias hechas; si una cuenta ya recibió todo, apunta las aportaciones de sus huchas */
async function _markDone(month, list, refresh) {
  setLoading(true, 'Registrando transferencias…');
  try {
    await sheets.appendTransfers(list.map(t => ({
      month, date: _today(), from: t.from, to: t.to, amount: t.pending, note: 'presupuesto',
    })));
    const contributions = [];
    for (const to of new Set(list.map(t => t.to))) {
      const stillPending = state.getTransferPlan(month).list.some(t => t.to === to && t.pending > 0.004);
      if (stillPending) continue;
      for (const h of state.huchas.filter(x => x.status === 'active')) {
        if (state.getAccountOf(`HUCHA:${h.name}`) !== to) continue;
        const left = Math.round((state.getHuchaPlanned(month, h.name) - state.getHuchaContributed(month, h.name)) * 100) / 100;
        if (left > 0.004) contributions.push({
          date: _today(), month, source: `HUCHA:${h.name}`, amount: left, kind: 'aportacion', note: _contribNote(month, to),
        });
      }
    }
    if (contributions.length) await sheets.appendFunding(contributions);
    showToast(contributions.length
      ? `Transferencia registrada y ${contributions.length} aportación(es) a huchas apuntadas`
      : 'Transferencia registrada', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
    refresh();
  }
}

async function _undo(month, t, refresh) {
  const contribs = state.funding.filter(f => f.kind === 'aportacion' && f.month === month && f.note === _contribNote(month, t.to));
  if (!confirm(`¿Deshacer la transferencia ${t.from} → ${t.to}?` +
    (contribs.length ? ` También se quitarán las ${contribs.length} aportaciones a huchas que se apuntaron con ella.` : ''))) return;
  setLoading(true, 'Deshaciendo…');
  try {
    await sheets.deleteTransfers(state.transfers.filter(x => x.month === month && x.from === t.from && x.to === t.to).map(x => x.rowIndex));
    if (contribs.length) await sheets.deleteFunding(contribs.map(f => f.rowIndex));
    showToast('Transferencia deshecha', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
    refresh();
  }
}

function _contribNote(month, to) { return `transferencia ${month} → ${to}`; }

/** Nombre legible de una línea del plan */
export function planLabel(key) {
  if (key === '@AHORRO') return 'Ahorro libre';
  if (key === '@IMPREVISTOS') return 'Colchón';
  if (key.startsWith(state.HUCHA_PREFIX)) return `🐷 ${key.slice(state.HUCHA_PREFIX.length)}`;
  if (key.startsWith(state.REFILL_PREFIX)) return `🔁 Reponer ${key.slice(state.REFILL_PREFIX.length)}`;
  return key;
}

// =========================================================
// Alta / edición de cuenta
// =========================================================

function _openEdit(a) {
  const isFirst = state.accounts.length === 0;
  const currentMain = state.getMainAccount();
  const name = el('input', { class: 'modal-input', type: 'text', maxlength: '30', value: a?.name ?? '', placeholder: 'Ej: Revolut conjunta' });
  const main = el('input', { type: 'checkbox', checked: a ? a === currentMain : isFirst });
  const active = el('input', { type: 'checkbox', checked: (a?.status ?? 'active') === 'active' });
  const selected = new Set(a && a !== currentMain ? a.items : []);
  const ownerOf = item => state.getActiveAccounts().find(x => x !== a && x !== currentMain && x.items.includes(item))?.name;

  const option = (item, label) => {
    const box = el('input', {
      type: 'checkbox', checked: selected.has(item),
      onchange: () => { if (box.checked) selected.add(item); else selected.delete(item); },
    });
    const other = ownerOf(item);
    return el('label', { class: 'account-item' }, box, el('span', {}, label,
      other ? el('span', { class: 'muted small' }, ` · ahora en ${other}`) : null));
  };
  const group = (title, entries) => {
    if (entries.length === 0) return null;
    const anySelected = entries.some(([item]) => selected.has(item));
    return el('details', { class: 'account-group', open: anySelected },
      el('summary', {}, `${title} (${entries.length})`),
      el('div', { class: 'account-items' }, ...entries.map(([item, label]) => option(item, label))));
  };
  const cats = state.allBudgetKeys
    .filter(c => c.status === 'active' || selected.has(`CAT:${c.budgetKey}`))
    .sort((x, y) => x.budgetKey.localeCompare(y.budgetKey));
  const catGroup = (title, test) => group(title, cats.filter(test).map(c => [`CAT:${c.budgetKey}`, c.budgetKey]));

  const items = el('div', { class: 'account-groups' }, ...[
    el('p', { class: 'muted small' }, 'Marca lo que vive en esta cuenta. Lo que no marques en ninguna cuenta vive en la principal.'),
    group('Ingresos que entran aquí', state.incomeKeys
      .filter(k => k.status === 'active' || selected.has(`INC:${k.incomeKey}`))
      .map(k => [`INC:${k.incomeKey}`, k.incomeKey])),
    group('Huchas cuyo dinero está aquí', state.huchas
      .filter(h => h.status === 'active' || selected.has(`HUCHA:${h.name}`))
      .map(h => [`HUCHA:${h.name}`, h.name])),
    group('Ahorro y colchón', [['@AHORRO', 'Ahorro libre (sin hucha)'], ['@IMPREVISTOS', 'Colchón de imprevistos']]),
    catGroup('Inversiones', c => isInvestmentCode(c.code)),
    catGroup('Gastos necesarios mensuales', c => c.code.startsWith('NM')),
    catGroup('Gastos necesarios discontinuos', c => c.code.startsWith('ND')),
    catGroup('Gastos electivos mensuales', c => c.code.startsWith('EM')),
    catGroup('Gastos electivos discontinuos', c => c.code.startsWith('ED')),
  ].filter(Boolean));
  const syncMain = () => items.classList.toggle('hidden', main.checked);
  main.addEventListener('change', syncMain);
  syncMain();

  const body = el('div', { class: 'cat-form' },
    el('div', { class: 'input-group' }, el('label', { class: 'input-label' }, 'Nombre'), name),
    el('label', { class: 'cat-active' }, main,
      el('span', {}, 'Cuenta principal (donde entra la nómina; todo lo que no asignes a otra cuenta vive aquí)')),
    items,
    el('label', { class: 'cat-active' }, active, el('span', {}, 'Activa (desmárcala para archivarla)')),
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const n = name.value.trim().replace(/\s+/g, ' ');
        if (!n) { showToast('Indica un nombre', 'error'); return; }
        if (/[,→]/.test(n)) { showToast('El nombre no puede llevar comas ni flechas', 'error'); return; }
        if (state.accounts.some(x => x !== a && x.name.toLowerCase() === n.toLowerCase())) { showToast('Ya existe una cuenta con ese nombre', 'error'); return; }
        const isMain = main.checked;
        const mine = isMain ? [] : [...selected];
        const list = state.accounts.filter(x => x !== a).map(x => ({
          ...x,
          main: isMain ? false : x.main,
          items: x.items.filter(i => !mine.includes(i)),     // lo marcado aquí sale de las demás
        }));
        list.push({ name: n, main: isMain, status: active.checked ? 'active' : 'archived', items: mine, note: a?.note ?? '' });
        closeModal();
        setLoading(true, 'Guardando cuenta…');
        try {
          await sheets.saveAccounts(list);
          showToast(a ? 'Cuenta actualizada' : `Cuenta ${n} creada`, 'success');
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error', 5000);
        } finally {
          setLoading(false);
          render();
        }
      },
    }, 'Guardar'),
  );
  openModal(a ? `Editar ${a.name}` : 'Nueva cuenta', body, footer);
}

function _thisMonth() { return _today().slice(0, 7); }

function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
