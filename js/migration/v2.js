// =========================================================
// v2.js — migración del Sheet al modelo de presupuesto v2
//
// computeMigration() es una función pura: a partir de las filas crudas del
// Sheet calcula TODOS los cambios, para enseñarlos antes de aplicarlos.
// applyMigration() vuelve a leer el Sheet, recalcula y escribe.
// Ver docs/presupuesto-v2.md §7.
// =========================================================

import {
  CATALOG, RENAMES, INHERIT_SETTINGS, REVIEW_KEYS, DELETE_KEYS, PLAN_KEY_MAP, proposeCategory,
} from './v2Data.js';
import { typeFromCode } from '../utils/categoryCodes.js';

export const MIGRATION_ID = 'presupuesto-v2';

export const CATALOG_HEADER = ['budget_key', 'code', 'allows_hucha', 'ref_amount', 'due_day', 'status'];
export const PLAN_HEADER    = ['month', 'budget_key', 'amount', 'note'];
export const FUNDING_HEADER = ['date', 'month', 'tx_id', 'source', 'amount', 'kind', 'note'];
export const MIGRATIONS_HEADER = ['id', 'applied_at', 'summary'];

// Columnas (0-based) del formato antiguo
const TX = { ID: 0, MONTH: 2, DATE: 3, AMOUNT: 4, MERCHANT_NORM: 7, DESCRIPTION: 9, KEY: 10, TYPE: 11 };
const MM = { NORM: 0, KEY: 1, TYPE: 2 };
const BH = { MONTH: 0, KEY: 1, TYPE: 2, MONTHLY: 3, FIXED: 4 };
const OLD_BK = { KEY: 0, TYPE: 1, MONTHLY: 2, FIXED: 3, DUE: 4, ACTIVE: 5 };

/**
 * Calcula la migración completa.
 * @param {{ budgetKeys: string[][], transactions: string[][], merchantMap: string[][],
 *           budgetHistory: string[][] }} raw  Filas tal cual del Sheet (con cabecera)
 * @param {{ thisMonth: string, now?: number }} opts
 */
export function computeMigration(raw, { thisMonth, now = Date.now() }) {
  const oldCatalog = new Map();
  for (const row of raw.budgetKeys.slice(1)) {
    const key = _str(row[OLD_BK.KEY]);
    if (key) oldCatalog.set(key, row);
  }

  // ---------- Catálogo nuevo
  const catalog = new Map();
  for (const [key, code, allowsHucha, status = 'active'] of CATALOG) {
    const old = oldCatalog.get(key) ?? oldCatalog.get(INHERIT_SETTINGS[key]);
    const constant = code === 'INV' || code[2] === 'C';
    catalog.set(key, {
      budgetKey: key, code, allowsHucha, status,
      refAmount: constant && old ? _num(old[OLD_BK.FIXED]) : 0,
      dueDay:    old ? _num(old[OLD_BK.DUE]) : 0,
    });
  }

  // ---------- Gastos
  const mapKey = (key) => RENAMES[key] ?? key;
  const txUpdates = [];      // { row, cells: {col: value} }
  const review = [];         // gastos a reclasificar uno a uno
  const txDeletes = [];      // { row, date, amount, description, key }
  const unknownKeys = new Map();   // categorías con gastos que no están en el catálogo nuevo
  const renameCounts = new Map();
  let monthFixes = 0, idFixes = 0;

  raw.transactions.slice(1).forEach((r, i) => {
    const row = i + 2;                                   // fila A1 (cabecera = 1)
    if (!_str(r[TX.DATE]) && !_str(r[TX.AMOUNT])) return; // fila vacía
    const cells = {};
    const oldKey = _str(r[TX.KEY]);
    const info = {
      row, oldKey,
      txId:        _str(r[TX.ID]),
      date:        _parseDate(r[TX.DATE]),
      amount:      _num(r[TX.AMOUNT]),
      description: _str(r[TX.DESCRIPTION]) || _str(r[TX.MERCHANT_NORM]),
      merchantNorm: _str(r[TX.MERCHANT_NORM]),
    };

    if (DELETE_KEYS.includes(oldKey)) { txDeletes.push(info); return; }

    if (!info.txId) {
      info.txId = `${now}-mig${row}`;
      cells[TX.ID] = info.txId;
      idFixes++;
    }

    const month = _normalizeMonth(r[TX.MONTH], r[TX.DATE]);
    if (month && month !== _str(r[TX.MONTH])) { cells[TX.MONTH] = month; monthFixes++; }
    info.month = month;

    if (REVIEW_KEYS.includes(oldKey)) {
      review.push({ ...info, ...proposeCategory(oldKey, info.description), coveredByImprevistos: oldKey === 'IMPREVISTOS' });
      // budget_key/type se escriben al aplicar, según lo elegido
    } else {
      const newKey = mapKey(oldKey);
      if (newKey !== oldKey) {
        cells[TX.KEY] = newKey;
        renameCounts.set(`${oldKey} → ${newKey}`, (renameCounts.get(`${oldKey} → ${newKey}`) ?? 0) + 1);
      }
      if (newKey && !catalog.has(newKey)) {
        unknownKeys.set(newKey, (unknownKeys.get(newKey) ?? 0) + 1);
      }
      const type = typeFromCode(catalog.get(newKey)?.code ?? 'NMV');
      if (newKey && _str(r[TX.TYPE]) !== type) cells[TX.TYPE] = type;
    }

    if (Object.keys(cells).length > 0) txUpdates.push({ row, cells });
  });

  // Categorías con gastos que no conocemos: se conservan archivadas para no perder estadísticas
  for (const key of unknownKeys.keys()) {
    const old = oldCatalog.get(key);
    const code = _str(old?.[OLD_BK.TYPE]) === 'Fijo' ? 'NMC' : 'NMV';
    catalog.set(key, { budgetKey: key, code, allowsHucha: false, status: 'archived', refAmount: 0, dueDay: 0 });
  }

  // ---------- Comercios aprendidos
  const mmUpdates = [];   // { row, key, reviewFrom? }
  const mmDeletes = [];
  raw.merchantMap.slice(1).forEach((r, i) => {
    const row = i + 2;
    const oldKey = _str(r[MM.KEY]);
    if (!oldKey) return;
    if (DELETE_KEYS.includes(oldKey)) { mmDeletes.push(row); return; }
    if (REVIEW_KEYS.includes(oldKey)) {
      // Se resuelve al aplicar: toma la categoría elegida para un gasto de ese comercio
      mmUpdates.push({ row, merchantNorm: _str(r[MM.NORM]), reviewFrom: oldKey });
      return;
    }
    const newKey = mapKey(oldKey);
    const type = typeFromCode(catalog.get(newKey)?.code ?? 'NMV');
    if (newKey !== oldKey || _str(r[MM.TYPE]) !== type) mmUpdates.push({ row, key: newKey, type });
  });

  // ---------- Histórico de presupuestos → plan mensual
  const bhUpdates = [];
  const planMap = new Map();      // `${month}|${key}` → amount
  raw.budgetHistory.slice(1).forEach((r, i) => {
    const row = i + 2;
    const oldKey = _str(r[BH.KEY]);
    const month = _normalizeMonth(r[BH.MONTH]);
    if (!oldKey || !month) return;
    const cells = {};
    if (month !== _str(r[BH.MONTH])) cells[BH.MONTH] = month;
    if (RENAMES[oldKey]) cells[BH.KEY] = RENAMES[oldKey];
    if (Object.keys(cells).length > 0) bhUpdates.push({ row, cells });

    const planKey = oldKey in PLAN_KEY_MAP ? PLAN_KEY_MAP[oldKey] : oldKey;
    if (!planKey) return;
    const amount = _str(r[BH.TYPE]) === 'Fijo' ? _num(r[BH.FIXED]) : _num(r[BH.MONTHLY]);
    const k = `${month}|${planKey}`;
    planMap.set(k, (planMap.get(k) ?? 0) + amount);
  });

  // Mes en curso sin foto en el histórico: se toma del catálogo antiguo (activas)
  if (![...planMap.keys()].some(k => k.startsWith(`${thisMonth}|`))) {
    for (const [key, row] of oldCatalog) {
      if (_str(row[OLD_BK.ACTIVE]).toUpperCase() !== 'TRUE') continue;
      const planKey = key in PLAN_KEY_MAP ? PLAN_KEY_MAP[key] : key;
      if (!planKey) continue;
      const amount = _str(row[OLD_BK.TYPE]) === 'Fijo' ? _num(row[OLD_BK.FIXED]) : _num(row[OLD_BK.MONTHLY]);
      planMap.set(`${thisMonth}|${planKey}`, (planMap.get(`${thisMonth}|${planKey}`) ?? 0) + amount);
    }
  }

  const planRows = [...planMap.entries()]
    .map(([k, amount]) => { const [month, key] = k.split('|'); return [month, key, _round(amount), 'histórico']; })
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  return {
    catalog: [...catalog.values()].sort((a, b) => a.budgetKey.localeCompare(b.budgetKey)),
    txUpdates, review, txDeletes, mmUpdates, mmDeletes, bhUpdates, planRows,
    renameCounts: [...renameCounts.entries()],
    unknownKeys: [...unknownKeys.entries()],
    monthFixes, idFixes,
    txCount: raw.transactions.length - 1,
  };
}

/**
 * Convierte el resultado de computeMigration + lo elegido en la revisión en
 * escrituras concretas.
 * @param {ReturnType<typeof computeMigration>} m
 * @param {Map<number, string>} choices  fila del gasto → categoría elegida
 */
export function buildWrites(m, choices) {
  const catalogByKey = new Map(m.catalog.map(c => [c.budgetKey, c]));
  const typeOf = key => typeFromCode(catalogByKey.get(key)?.code ?? 'NMV');

  const missing = m.review.filter(it => !catalogByKey.has(choices.get(it.row)));
  if (missing.length > 0) {
    throw new Error(`Falta elegir categoría para ${missing.length} gasto(s) en revisión`);
  }

  const cell = (sheet, col, row, value) => ({ range: `${sheet}!${_colLetter(col)}${row}`, values: [[value]] });
  const data = [];

  for (const u of m.txUpdates) {
    for (const [col, value] of Object.entries(u.cells)) data.push(cell('TRANSACTIONS', Number(col), u.row, value));
  }
  const reviewByMerchant = new Map();
  for (const it of m.review) {
    const key = choices.get(it.row);
    data.push(cell('TRANSACTIONS', TX.KEY,  it.row, key));
    data.push(cell('TRANSACTIONS', TX.TYPE, it.row, typeOf(key)));
    if (it.merchantNorm && !reviewByMerchant.has(it.merchantNorm)) reviewByMerchant.set(it.merchantNorm, key);
  }

  const mmDeletes = [...m.mmDeletes];
  for (const u of m.mmUpdates) {
    const key = u.reviewFrom ? reviewByMerchant.get(u.merchantNorm) : u.key;
    if (!key) { mmDeletes.push(u.row); continue; }   // sin gasto de referencia: la IA lo reaprenderá
    data.push(cell('MERCHANT_MAP', MM.KEY,  u.row, key));
    data.push(cell('MERCHANT_MAP', MM.TYPE, u.row, typeOf(key)));
  }

  for (const u of m.bhUpdates) {
    for (const [col, value] of Object.entries(u.cells)) data.push(cell('BUDGET_HISTORY', Number(col), u.row, value));
  }

  const catalogRows = m.catalog.map(c => [
    c.budgetKey, c.code, c.allowsHucha, c.refAmount || '', c.dueDay || '', c.status,
  ]);

  const fundingRows = m.review
    .filter(it => it.coveredByImprevistos)
    .map(it => [it.date, it.month, it.txId, 'IMPREVISTOS', it.amount, 'cobertura',
                'migración v2: antes en la categoría IMPREVISTOS']);

  return {
    valueUpdates: data,
    catalogRows,
    planRows: m.planRows,
    fundingRows,
    txDeleteRows: m.txDeletes.map(d => d.row),
    mmDeleteRows: mmDeletes,
  };
}

// =========================================================
// Helpers
// =========================================================

function _str(v) { return String(v ?? '').trim(); }

function _num(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9,.\-]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function _round(n) { return Math.round(n * 100) / 100; }

function _parseDate(value) {
  const str = _str(value);
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const n = Number(str);
  if (!isNaN(n) && n > 1000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  return '';
}

/** 'YYYY-MM' a partir de la celda de mes (texto, fecha o serial) o, si no, de la fecha del gasto */
function _normalizeMonth(monthRaw, dateRaw) {
  const str = _str(monthRaw);
  if (/^\d{4}-\d{2}$/.test(str)) return str;
  const asDate = _parseDate(str);
  if (asDate) return asDate.slice(0, 7);
  const m = str.match(/^(\d{1,2})\/(\d{4})$/);          // "3/2026"
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const fromDate = _parseDate(dateRaw);
  return fromDate ? fromDate.slice(0, 7) : '';
}

function _colLetter(index) {
  return String.fromCharCode(65 + index);   // las pestañas usadas no pasan de la columna O
}
