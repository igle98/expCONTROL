// =========================================================
// migration.js — pantalla (en Ajustes) para migrar el Sheet al modelo v2.
// Enseña todos los cambios y solo escribe cuando el usuario confirma.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { SHEETS, IS_LOCAL } from '../config.js';
import { el, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatDateShort } from '../utils/formatters.js';
import { codeLabel } from '../utils/categoryCodes.js';
import {
  computeMigration, buildWrites, MIGRATION_ID,
  CATALOG_HEADER, PLAN_HEADER, FUNDING_HEADER, MIGRATIONS_HEADER,
} from '../migration/v2.js';

const ROOT_ID = 'migration-section';

let _migration = null;            // resultado de computeMigration
const _choices = new Map();       // fila del gasto → categoría elegida

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (state.catalogFormat === 'v2') { root.replaceChildren(); return; }

  root.replaceChildren(
    el('div', { class: 'settings-card migration-card' },
      el('span', { class: 'settings-label' }, 'Migración a presupuesto v2'),
      el('p', { class: 'muted small' },
        'Pasa el Sheet al nuevo modelo: códigos de categoría, presupuesto por mes, ',
        'inversiones aparte y reclasificación de CASA_ART e IMPREVISTOS. ',
        'Primero se enseñan todos los cambios; nada se escribe hasta que confirmes.'),
      el('p', { class: `migration-target ${IS_LOCAL ? 'is-test' : 'is-prod'}` },
        IS_LOCAL ? '🧪 Se aplicará sobre el Sheet de PRUEBAS' : '⚠️ Se aplicará sobre tu Sheet REAL'),
      _migration ? _renderReview() : el('button', {
        class: 'btn btn-primary', onclick: () => _load(),
      }, 'Revisar cambios'),
    ),
  );
}

// =========================================================
// Carga y cálculo
// =========================================================

async function _readRaw() {
  const [budgetKeys, transactions, merchantMap, budgetHistory] = await sheets.readRanges([
    `${SHEETS.BUDGET_KEYS}!A:F`,
    `${SHEETS.TRANSACTIONS}!A:O`,
    `${SHEETS.MERCHANT_MAP}!A:G`,
    `${SHEETS.BUDGET_HISTORY}!A:H`,
  ]);
  return { budgetKeys, transactions, merchantMap, budgetHistory };
}

async function _load() {
  setLoading(true, 'Analizando el Sheet…');
  try {
    const raw = await _readRaw();
    if (sheets.isCatalogV2Header(raw.budgetKeys[0])) throw new Error('Este Sheet ya está migrado');
    _migration = computeMigration(raw, { thisMonth: _thisMonth() });
    _choices.clear();
    for (const it of _migration.review) _choices.set(it.row, it.key);
    render();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

// =========================================================
// Revisión
// =========================================================

function _renderReview() {
  const m = _migration;
  const byStatus = s => m.catalog.filter(c => c.status === s).length;
  const uncertain = m.review.filter(it => it.uncertain).length;

  return el('div', { class: 'migration-review' },
    _section('Resumen', el('ul', { class: 'migration-list' },
      el('li', {}, `${m.txCount} gastos en total; se modifican ${m.txUpdates.length + m.review.length} y se borra ${m.txDeletes.length}.`),
      el('li', {}, `${m.monthFixes} gastos tenían el mes guardado como fecha: se normalizan a AAAA-MM.`),
      el('li', {}, `Catálogo nuevo: ${m.catalog.length} categorías (${byStatus('active')} activas, ${byStatus('paused')} pausadas, ${byStatus('archived')} archivadas).`),
      el('li', {}, `Plan mensual creado desde el histórico: ${new Set(m.planRows.map(r => r[0])).size} meses, ${m.planRows.length} líneas.`),
      el('li', {}, `Comercios aprendidos: ${m.mmUpdates.length} se actualizan, ${m.mmDeletes.length} se borran.`),
      m.idFixes ? el('li', {}, `${m.idFixes} gasto(s) sin identificador reciben uno.`) : null,
    )),

    _section('Renombres', m.renameCounts.length === 0
      ? el('p', { class: 'muted small' }, 'Ninguno.')
      : el('ul', { class: 'migration-list' },
          ...m.renameCounts.map(([label, n]) => el('li', {}, `${label} (${n} gasto${n === 1 ? '' : 's'})`)))),

    _section(`Revisar uno a uno (${m.review.length}${uncertain ? ` · ${uncertain} dudosos` : ''})`,
      el('p', { class: 'muted small' },
        'Los marcados con ⚠️ no tienen una categoría evidente. Los de IMPREVISTOS quedan registrados como "cubiertos con imprevistos".'),
      el('div', { class: 'migration-rows' }, ...m.review
        .slice().sort((a, b) => a.date.localeCompare(b.date))
        .map(it => _reviewRow(it))),
    ),

    _section('Se borra', el('ul', { class: 'migration-list' },
      ...m.txDeletes.map(d => el('li', {},
        `${formatDateShort(d.date)} · ${d.description} · ${formatCurrency(d.amount)} (${d.oldKey}: era un traspaso al ahorro)`)))),

    m.unknownKeys.length ? _section('Categorías desconocidas (se conservan archivadas)', el('ul', { class: 'migration-list' },
      ...m.unknownKeys.map(([k, n]) => el('li', {}, `${k} (${n} gastos)`)))) : null,

    _section('Catálogo nuevo', el('details', {},
      el('summary', {}, 'Ver las categorías'),
      el('ul', { class: 'migration-list' }, ...m.catalog.map(c => el('li', {},
        el('b', {}, c.budgetKey), ` · ${c.code} (${codeLabel(c.code)})`,
        c.status !== 'active' ? ` · ${c.status === 'paused' ? 'pausada' : 'archivada'}` : '',
        c.allowsHucha ? ' · permite hucha' : '',
        c.refAmount ? ` · ref. ${formatCurrency(c.refAmount)}` : '',
      ))),
    )),

    el('div', { class: 'settings-actions' },
      el('button', { class: 'btn btn-secondary', onclick: () => { _migration = null; render(); } }, 'Cancelar'),
      el('button', { class: 'btn btn-primary', onclick: () => _confirmApply() }, 'Aplicar migración'),
    ),
  );
}

function _reviewRow(it) {
  const options = _migration.catalog
    .filter(c => c.status !== 'archived' || c.budgetKey === it.key)
    .map(c => el('option', { value: c.budgetKey, selected: c.budgetKey === _choices.get(it.row) }, c.budgetKey));
  return el('div', { class: `migration-row ${it.uncertain ? 'is-uncertain' : ''}` },
    el('div', { class: 'migration-row-main' },
      el('div', { class: 'migration-row-desc' }, `${it.uncertain ? '⚠️ ' : ''}${it.description || '(sin descripción)'}`),
      el('div', { class: 'muted small' },
        `${formatDateShort(it.date)} · ${formatCurrency(it.amount)} · antes ${it.oldKey}`),
    ),
    el('select', {
      class: 'modal-select migration-select',
      onchange: (e) => _choices.set(it.row, e.target.value),
    }, ...options),
  );
}

function _section(title, ...children) {
  return el('div', { class: 'migration-section' },
    el('div', { class: 'cat-group-title' }, title),
    ...children,
  );
}

// =========================================================
// Aplicar
// =========================================================

function _confirmApply() {
  if (!IS_LOCAL) {
    const typed = prompt('Vas a migrar tu Sheet REAL. Asegúrate de tener una copia de seguridad.\nEscribe MIGRAR para continuar:');
    if (typed !== 'MIGRAR') return;
  } else if (!confirm('¿Aplicar la migración sobre el Sheet de PRUEBAS?')) {
    return;
  }
  _apply();
}

async function _apply() {
  setLoading(true, 'Migrando… no cierres la app');
  try {
    // Se recalcula con datos frescos y se exige que la revisión siga cuadrando
    await sheets.loadSheetMeta();
    const raw = await _readRaw();
    if (sheets.isCatalogV2Header(raw.budgetKeys[0])) throw new Error('Este Sheet ya está migrado');
    const fresh = computeMigration(raw, { thisMonth: _thisMonth() });
    const sig = m => m.review.map(it => `${it.row}|${it.date}|${it.amount}`).join(';')
      + `#${m.txCount}#${m.txDeletes.map(d => d.row).join(',')}`;
    if (sig(fresh) !== sig(_migration)) {
      throw new Error('Los datos han cambiado desde la revisión. Vuelve a revisar los cambios.');
    }

    const w = buildWrites(fresh, _choices);

    // Orden pensado para poder repetir si algo falla a mitad: todo es idempotente
    // y el catálogo (que es lo que pasa la app al modelo v2) se escribe al final.
    // 1. Celdas sueltas: gastos, comercios e histórico
    await sheets.batchValuesUpdate(w.valueUpdates);
    // 2. Pestañas nuevas (se reescriben enteras)
    await sheets.ensureSheet(SHEETS.PLAN_LINES, PLAN_HEADER);
    await sheets.writeSheet(SHEETS.PLAN_LINES, [PLAN_HEADER, ...w.planRows]);
    await sheets.ensureSheet(SHEETS.FUNDING, FUNDING_HEADER);
    await sheets.writeSheet(SHEETS.FUNDING, [FUNDING_HEADER, ...w.fundingRows]);
    // 3. Borrados (desplazan filas: después de escribir celdas por número de fila)
    await sheets.deleteSheetRows(SHEETS.MERCHANT_MAP, w.mmDeleteRows);
    await sheets.deleteSheetRows(SHEETS.TRANSACTIONS, w.txDeleteRows);
    // 4. Catálogo nuevo
    await sheets.writeSheet(SHEETS.BUDGET_KEYS, [CATALOG_HEADER, ...w.catalogRows]);
    // 5. Marca de migración aplicada
    await sheets.ensureSheet(SHEETS.MIGRATIONS, MIGRATIONS_HEADER);
    await sheets.appendRows(SHEETS.MIGRATIONS, [[
      MIGRATION_ID, new Date().toISOString(),
      `${w.valueUpdates.length} celdas · ${w.catalogRows.length} categorías · ${w.planRows.length} líneas de plan · ${w.txDeleteRows.length} gasto(s) borrado(s)`,
    ]]);

    await sheets.loadAll();
    _migration = null;
    showToast('Migración aplicada ✅', 'success', 5000);
    document.dispatchEvent(new CustomEvent('data-reloaded'));
  } catch (err) {
    showToast(`Error en la migración: ${err.message}`, 'error', 8000);
  } finally {
    setLoading(false);
  }
}

function _thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
