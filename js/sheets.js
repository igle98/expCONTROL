import { SPREADSHEET_ID, API_BASE, SHEETS, TX_COL, BK_COL, BH_COL, MM_COL, DEBT_COL, FUTURE_COL } from './config.js';
import { getToken } from './auth.js';
import {
  setTransactions, setBudgets, setAllBudgetKeys, setSheetMeta, setBudgetHistory,
  setMerchantMap, upsertMerchantMap, setDebts, setFutureItems, sheetMeta,
} from './state.js';

// =========================================================
// Carga inicial
// =========================================================

/** Obtiene los sheetId numéricos y los guarda en state.sheetMeta */
export async function loadSheetMeta() {
  const data = await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`
  );
  const meta = {};
  for (const sheet of data.sheets ?? []) {
    meta[sheet.properties.title] = sheet.properties.sheetId;
  }
  setSheetMeta(meta);
}

/** Carga todas las hojas de datos en paralelo */
export async function loadAll() {
  await Promise.all([
    loadTransactions(),
    loadBudgetKeys(),
    loadBudgetHistory(),
    loadMerchantMap(),
    loadDebts(),
    loadFuture(),
  ]);
}

/** Carga TRANSACTIONS y actualiza state */
export async function loadTransactions() {
  const range = `${SHEETS.TRANSACTIONS}!A:O`;
  const data  = await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
  );
  const rows = data.values ?? [];
  // La fila 0 es la cabecera → los datos empiezan en índice 1
  const txs = [];
  for (let i = 1; i < rows.length; i++) {
    const tx = _parseTransactionRow(rows[i], i);
    if (tx) txs.push(tx);
  }
  setTransactions(txs);
}

/** Carga BUDGET_KEYS y actualiza state (budgets = solo los activos) */
export async function loadBudgetKeys() {
  const range = `${SHEETS.BUDGET_KEYS}!A:F`;
  const data  = await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
  );
  const rows = data.values ?? [];
  const all  = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[BK_COL.BUDGET_KEY]) continue;
    all.push({
      budgetKey:      String(row[BK_COL.BUDGET_KEY]).trim(),
      type:           String(row[BK_COL.TYPE] ?? '').trim(),         // "Fijo" o "Variable"
      monthlyBudget:  _parseNumber(row[BK_COL.MONTHLY_BUDGET]),
      fixedAmount:    _parseNumber(row[BK_COL.FIXED_AMOUNT]),
      dueDay:         _parseNumber(row[BK_COL.DUE_DAY]),
      // Columna "active" (F, índice 5) — checkbox = TRUE/FALSE
      active:         String(row[BK_COL.ACTIVE] ?? '').toUpperCase() === 'TRUE',
    });
  }
  setAllBudgetKeys(all);
  setBudgets(all.filter(b => b.active).map(({ active, ...b }) => b));
}

/** Carga BUDGET_HISTORY completo y actualiza state */
export async function loadBudgetHistory() {
  const range = `${SHEETS.BUDGET_HISTORY}!A:H`;
  let data;
  try {
    data = await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
    );
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      setBudgetHistory([]);
      return;
    }
    throw err;
  }
  const rows = data.values ?? [];
  const history = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[BH_COL.MONTH] || !row[BH_COL.BUDGET_KEY]) continue;
    history.push({
      month:         String(row[BH_COL.MONTH]).trim(),
      budgetKey:     String(row[BH_COL.BUDGET_KEY]).trim(),
      type:          String(row[BH_COL.TYPE] ?? '').trim(),
      monthlyBudget: _parseNumber(row[BH_COL.MONTHLY_BUDGET]),
      fixedAmount:   _parseNumber(row[BH_COL.FIXED_AMOUNT]),
      dueDay:        _parseNumber(row[BH_COL.DUE_DAY]),
      spent:         _parseNumber(row[BH_COL.SPENT]),
      snapshotTs:    String(row[BH_COL.SNAPSHOT_TS] ?? '').trim(),
    });
  }
  setBudgetHistory(history);
}

/**
 * Upsert del snapshot de presupuesto para el mes indicado.
 * Actualiza filas existentes y hace append de las nuevas.
 * @param {string} month
 * @param {Budget[]} budgets
 * @param {Map<string,number>} spendMap
 */
export async function saveBudgetSnapshot(month, budgets, spendMap) {
  if (!budgets || budgets.length === 0) return;
  const snapshotTs = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T');

  // 1. Leer filas existentes para conocer los rowIndex reales
  const range = `${SHEETS.BUDGET_HISTORY}!A:H`;
  let existingData;
  try {
    existingData = await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
    );
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      existingData = { values: [] };
    } else {
      throw err;
    }
  }

  const existingRows = existingData.values ?? [];
  // Mapa: `${month}||${budgetKey}` → número de fila en Sheets (1-based)
  const existingMap = new Map();
  for (let i = 1; i < existingRows.length; i++) {
    const row = existingRows[i];
    const rowMonth     = String(row[BH_COL.MONTH]      ?? '').trim();
    const rowBudgetKey = String(row[BH_COL.BUDGET_KEY] ?? '').trim();
    if (rowMonth && rowBudgetKey) {
      existingMap.set(`${rowMonth}||${rowBudgetKey}`, i + 1);
    }
  }

  // 2. Clasificar en update o insert
  const toUpdate = [];
  const toInsert = [];
  for (const b of budgets) {
    const key = `${month}||${b.budgetKey}`;
    const spent = Math.round((spendMap.get(b.budgetKey) ?? 0) * 100) / 100;
    const rowValues = [
      month,
      b.budgetKey,
      b.type,
      b.monthlyBudget,
      b.fixedAmount,
      b.dueDay,
      spent,
      snapshotTs,
    ];
    if (existingMap.has(key)) {
      toUpdate.push({ sheetRow: existingMap.get(key), values: rowValues });
    } else {
      toInsert.push(rowValues);
    }
  }

  // 3. Ejecutar updates en una sola llamada batchUpdate
  if (toUpdate.length > 0) {
    const data = toUpdate.map(({ sheetRow, values }) => ({
      range:  `${SHEETS.BUDGET_HISTORY}!A${sheetRow}:H${sheetRow}`,
      values: [values],
    }));
    await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }
    );
  }

  // 4. Ejecutar inserts en una sola llamada append
  if (toInsert.length > 0) {
    const appendRange = `${SHEETS.BUDGET_HISTORY}!A:H`;
    await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: toInsert }) }
    );
  }

  // 5. Refrescar state local
  await loadBudgetHistory();
}

/** Carga MERCHANT_MAP completo y lo cachea en memoria */
export async function loadMerchantMap() {
  const range = `${SHEETS.MERCHANT_MAP}!A:G`;
  let data;
  try {
    data = await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
    );
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      setMerchantMap(new Map());
      return;
    }
    throw err;
  }
  const rows = data.values ?? [];
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row[MM_COL.MERCHANT_NORM] ?? '').trim();
    if (!key) continue;
    map.set(key, {
      merchantNorm:    key,
      budgetKey:       String(row[MM_COL.BUDGET_KEY]      ?? '').trim(),
      type:            String(row[MM_COL.TYPE]            ?? '').trim(),
      firstSeen:       String(row[MM_COL.FIRST_SEEN]      ?? '').trim(),
      lastSeen:        String(row[MM_COL.LAST_SEEN]       ?? '').trim(),
      confidenceLast:  _parseNumber(row[MM_COL.CONFIDENCE_LAST]),
      source:          String(row[MM_COL.SOURCE]          ?? '').trim(),
    });
  }
  setMerchantMap(map);
}

// =========================================================
// Escritura
// =========================================================

/**
 * Añade una nueva transacción a TRANSACTIONS.
 * @param {{
 *   txId: string, tsIngest: string, month: string, date: string,
 *   amount: number, currency: string,
 *   merchantRaw: string, merchantNorm: string, merchantBase: string,
 *   description: string, budgetKey: string, type: string,
 *   confidence: number, merchantMapSource: string,
 * }} tx
 */
export async function appendTransaction(tx) {
  // Orden: tx_id, ts_ingest, month, date, amount, currency, merchant_raw,
  //        merchant_norm, merchant_base, description, budget_key, type,
  //        confidence, merchant_map_source, telegram_message_id
  const row = [
    tx.txId,
    tx.tsIngest,
    tx.month,
    tx.date,
    tx.amount,
    tx.currency,
    tx.merchantRaw,
    tx.merchantNorm,
    tx.merchantBase,
    tx.description,
    tx.budgetKey,
    tx.type,
    tx.confidence,
    tx.merchantMapSource,
    '', // telegram_message_id (vacío, ya no hay Telegram)
  ];

  const appendRange = `${SHEETS.TRANSACTIONS}!A:O`;
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );

  // Garantiza que la columna AMOUNT (E) tenga formato numérico.
  // RAW respeta el formato de celda existente, y las filas nuevas heredan
  // el de la fila anterior; si alguna quedó como Fecha, el número se mostraría
  // como fecha. Forzar el formato es idempotente y auto-cura filas antiguas.
  await _ensureAmountColumnNumberFormat();
}

/**
 * Aplica formato numérico (0.00) a toda la columna AMOUNT de TRANSACTIONS.
 * No-op silencioso si no conocemos el sheetId todavía.
 */
async function _ensureAmountColumnNumberFormat() {
  const sheetId = sheetMeta[SHEETS.TRANSACTIONS];
  if (sheetId === undefined || sheetId === null) return;
  try {
    await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            repeatCell: {
              range: {
                sheetId,
                startRowIndex:    1,                  // salta la cabecera
                startColumnIndex: TX_COL.AMOUNT,      // E (índice 4)
                endColumnIndex:   TX_COL.AMOUNT + 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: 'NUMBER', pattern: '0.00' },
                },
              },
              fields: 'userEnteredFormat.numberFormat',
            },
          }],
        }),
      }
    );
  } catch (err) {
    // El formato es cosmético: si falla, no bloqueamos el guardado del gasto.
    console.warn('[sheets] No se pudo forzar formato numérico en AMOUNT:', err.message);
  }
}

/**
 * Añade una nueva entrada a MERCHANT_MAP y refresca la cache local.
 * @param {{
 *   merchantNorm: string, budgetKey: string, type: string,
 *   firstSeen: string, lastSeen: string,
 *   confidenceLast: number, source: string,
 * }} entry
 */
export async function appendMerchantMap(entry) {
  const row = [
    entry.merchantNorm,
    entry.budgetKey,
    entry.type,
    entry.firstSeen,
    entry.lastSeen,
    entry.confidenceLast,
    entry.source,
  ];
  const appendRange = `${SHEETS.MERCHANT_MAP}!A:G`;
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );
  upsertMerchantMap(entry);
}



/**
 * Actualiza los campos editables de una transacción.
 * Si se cambia `date`, automáticamente se recalcula `month`.
 * @param {number} rowIndex  Índice 0-based del row en el sheet (header = 0)
 * @param {{ amount?: number, merchantNorm?: string, budgetKey?: string, date?: string }} fields
 */
export async function updateTransaction(rowIndex, fields) {
  // La fila en A1 notation es 1-based, y la primera fila es el header (row 1)
  // rowIndex=1 → primera fila de datos → fila 2 en A1
  const sheetRow = rowIndex + 1;
  const data = [];

  // month → C, date → D, amount → E, merchant_norm → H, budget_key → K
  if (fields.date !== undefined) {
    const isoDate = String(fields.date);
    const month = isoDate.slice(0, 7);
    data.push({ range: `${SHEETS.TRANSACTIONS}!C${sheetRow}`, values: [[month]] });
    data.push({ range: `${SHEETS.TRANSACTIONS}!D${sheetRow}`, values: [[isoDate]] });
  }
  if (fields.amount !== undefined) {
    // Número crudo (no string): con RAW evita que el locale de la hoja
    // interprete "5.5" (punto) como fecha o texto.
    data.push({ range: `${SHEETS.TRANSACTIONS}!E${sheetRow}`, values: [[Number(fields.amount)]] });
  }
  if (fields.merchantNorm !== undefined) {
    data.push({ range: `${SHEETS.TRANSACTIONS}!H${sheetRow}`, values: [[String(fields.merchantNorm)]] });
  }
  if (fields.budgetKey !== undefined) {
    data.push({ range: `${SHEETS.TRANSACTIONS}!K${sheetRow}`, values: [[String(fields.budgetKey)]] });
  }

  if (data.length === 0) return;

  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({ valueInputOption: 'RAW', data }),
    }
  );

  // Si se tocó el importe, garantiza formato numérico en la columna E.
  if (fields.amount !== undefined) {
    await _ensureAmountColumnNumberFormat();
  }
}

/**
 * Elimina una fila de TRANSACTIONS.
 * @param {number} rowIndex  Índice 0-based (header = 0, primera fila de datos = 1)
 * @param {number} sheetId   Numeric sheetId de TRANSACTIONS (de state.sheetMeta)
 */
export async function deleteTransaction(rowIndex, sheetId) {
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    sheetId,
              dimension:  'ROWS',
              startIndex: rowIndex,
              endIndex:   rowIndex + 1,
            },
          },
        }],
      }),
    }
  );
  // Recargamos para obtener los rowIndex correctos (evitar drift)
  await loadTransactions();
}

// =========================================================
// BUDGET_KEYS — gestión de categorías
// =========================================================
// El nombre de la categoría (budget_key) está copiado como texto en
// TRANSACTIONS, MERCHANT_MAP y BUDGET_HISTORY. Al renombrar o eliminar
// hay que propagar el cambio a mano para no dejar referencias huérfanas.

/**
 * Añade una categoría nueva (activa) a BUDGET_KEYS.
 * @param {{budgetKey:string, type:string, monthlyBudget?:number,
 *          fixedAmount?:number, dueDay?:number}} cat
 */
export async function appendBudgetKey(cat) {
  const appendRange = `${SHEETS.BUDGET_KEYS}!A:F`;
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [_budgetKeyRow({ ...cat, active: true })] }) }
  );
}

/**
 * Actualiza una categoría. Si cambia el nombre o el tipo, lo propaga a
 * TRANSACTIONS y MERCHANT_MAP (budget_key + type). El nombre también se
 * propaga a BUDGET_HISTORY para no partir el histórico en dos.
 * @param {{budgetKey:string, type:string}} oldCat
 * @param {{budgetKey:string, type:string, monthlyBudget?:number,
 *          fixedAmount?:number, dueDay?:number, active:boolean}} cat
 * @returns {Promise<{transactions:number, merchants:number}>}
 */
export async function updateBudgetKey(oldCat, cat) {
  const refs = await _findBudgetKeyRefs(oldCat.budgetKey);
  if (refs.budgetKeyRows.length === 0) {
    throw new Error(`No se encontró la categoría ${oldCat.budgetKey} en ${SHEETS.BUDGET_KEYS}`);
  }

  const renamed = cat.budgetKey !== oldCat.budgetKey;
  const data = refs.budgetKeyRows.map(r => ({
    range:  `${SHEETS.BUDGET_KEYS}!A${r}:F${r}`,
    values: [_budgetKeyRow(cat)],
  }));
  if (renamed || cat.type !== oldCat.type) {
    data.push(..._retargetData(refs, cat.budgetKey, cat.type, { history: renamed }));
  }
  await _batchValuesUpdate(data);

  return { transactions: refs.txRows.length, merchants: refs.mmRows.length };
}

/**
 * Elimina una categoría de BUDGET_KEYS.
 * - Sus gastos y comercios aprendidos pasan a `target` (obligatorio si tiene gastos).
 * - Sin `target`, los comercios aprendidos se borran (la IA los volverá a clasificar).
 * - BUDGET_HISTORY no se toca: los meses pasados conservan su foto.
 * @param {string} budgetKey
 * @param {{budgetKey:string, type:string}|null} target
 * @returns {Promise<{transactions:number, merchants:number}>}
 */
export async function deleteBudgetKey(budgetKey, target) {
  const refs = await _findBudgetKeyRefs(budgetKey);
  if (refs.budgetKeyRows.length === 0) {
    throw new Error(`No se encontró la categoría ${budgetKey} en ${SHEETS.BUDGET_KEYS}`);
  }
  if (refs.txRows.length > 0 && !target) {
    throw new Error('La categoría tiene gastos: elige a qué categoría moverlos');
  }

  if (target) {
    const data = _retargetData(refs, target.budgetKey, target.type, { history: false });
    if (data.length > 0) await _batchValuesUpdate(data);
  }

  const rowsToDelete = refs.budgetKeyRows.map(r => [sheetMeta[SHEETS.BUDGET_KEYS], r]);
  if (!target) {
    rowsToDelete.push(...refs.mmRows.map(r => [sheetMeta[SHEETS.MERCHANT_MAP], r]));
  }
  // De abajo arriba, para que borrar una fila no desplace a las siguientes
  rowsToDelete.sort((a, b) => b[1] - a[1]);
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({
        requests: rowsToDelete.map(([sheetId, row]) => ({
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        })),
      }),
    }
  );

  return { transactions: refs.txRows.length, merchants: refs.mmRows.length };
}

function _budgetKeyRow(cat) {
  const num = v => (v === undefined || v === null || v === '' || isNaN(v)) ? '' : Number(v);
  // budget_key | type | monthly_budget | fixed_amount | due_day | active
  return [cat.budgetKey, cat.type, num(cat.monthlyBudget), num(cat.fixedAmount), num(cat.dueDay), Boolean(cat.active)];
}

/**
 * Busca (con una sola lectura batchGet) las filas que referencian `budgetKey`.
 * Devuelve números de fila 1-based (A1) por hoja.
 */
async function _findBudgetKeyRefs(budgetKey) {
  const targets = [
    ['budgetKeyRows', SHEETS.BUDGET_KEYS,    'A'],
    ['txRows',        SHEETS.TRANSACTIONS,   'K'],
    ['mmRows',        SHEETS.MERCHANT_MAP,   'B'],
    ['historyRows',   SHEETS.BUDGET_HISTORY, 'B'],
  ].filter(([, sheet]) => sheetMeta[sheet] !== undefined);   // pestañas opcionales

  const qs = targets
    .map(([, sheet, col]) => `ranges=${encodeURIComponent(`${sheet}!${col}:${col}`)}`)
    .join('&');
  const data = await _apiFetch(`${API_BASE}/${SPREADSHEET_ID}/values:batchGet?${qs}`);

  const refs = { budgetKeyRows: [], txRows: [], mmRows: [], historyRows: [] };
  targets.forEach(([name], idx) => {
    const values = data.valueRanges?.[idx]?.values ?? [];
    for (let i = 1; i < values.length; i++) {   // fila 0 = cabecera
      if (String(values[i]?.[0] ?? '').trim() === budgetKey) refs[name].push(i + 1);
    }
  });
  return refs;
}

/** Rangos para reasignar gastos y comercios (y opcionalmente histórico) a otra categoría */
function _retargetData(refs, budgetKey, type, { history }) {
  const data = [];
  for (const r of refs.txRows) {
    data.push({ range: `${SHEETS.TRANSACTIONS}!K${r}:L${r}`, values: [[budgetKey, type]] });
  }
  for (const r of refs.mmRows) {
    data.push({ range: `${SHEETS.MERCHANT_MAP}!B${r}:C${r}`, values: [[budgetKey, type]] });
  }
  if (history) {
    for (const r of refs.historyRows) {
      data.push({ range: `${SHEETS.BUDGET_HISTORY}!B${r}`, values: [[budgetKey]] });
    }
  }
  return data;
}

async function _batchValuesUpdate(data) {
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }
  );
}

// =========================================================
// DEBTS — me deben dinero
// =========================================================

/** Carga DEBTS completo y actualiza state */
export async function loadDebts() {
  const range = `${SHEETS.DEBTS}!A:H`;
  let data;
  try {
    data = await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
    );
  } catch (err) {
    // Si la pestaña aún no existe, queda como lista vacía hasta que se cree
    if (err.status === 400 || err.status === 404) {
      setDebts([]);
      return;
    }
    throw err;
  }
  const rows = data.values ?? [];
  const debts = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[DEBT_COL.ID] && !row[DEBT_COL.PERSON]) continue;
    debts.push({
      rowIndex:    i,
      id:          String(row[DEBT_COL.ID]           ?? '').trim(),
      person:      String(row[DEBT_COL.PERSON]       ?? '').trim(),
      amount:      _parseNumber(row[DEBT_COL.AMOUNT]),
      reason:      String(row[DEBT_COL.REASON]       ?? '').trim(),
      dateCreated: _parseDate(row[DEBT_COL.DATE_CREATED]),
      status:      String(row[DEBT_COL.STATUS]       ?? 'pending').trim().toLowerCase() || 'pending',
      datePaid:    _parseDate(row[DEBT_COL.DATE_PAID]),
      notes:       String(row[DEBT_COL.NOTES]        ?? '').trim(),
    });
  }
  setDebts(debts);
}

/**
 * Añade una nueva deuda a DEBTS.
 * @param {{
 *   id: string, person: string, amount: number, reason: string,
 *   dateCreated: string, status?: string, datePaid?: string, notes?: string
 * }} debt
 */
export async function appendDebt(debt) {
  const row = [
    debt.id,
    debt.person,
    debt.amount,
    debt.reason,
    debt.dateCreated,
    debt.status || 'pending',
    debt.datePaid || '',
    debt.notes || '',
  ];
  const appendRange = `${SHEETS.DEBTS}!A:H`;
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );
}

/**
 * Actualiza una fila de DEBTS.
 * @param {number} rowIndex  Índice 0-based (header = 0)
 * @param {{person?: string, amount?: number, reason?: string, dateCreated?: string,
 *          status?: string, datePaid?: string, notes?: string}} fields
 */
export async function updateDebt(rowIndex, fields) {
  const sheetRow = rowIndex + 1;
  const data = [];

  // B person, C amount, D reason, E dateCreated, F status, G datePaid, H notes
  if (fields.person !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!B${sheetRow}`, values: [[String(fields.person)]] });
  }
  if (fields.amount !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!C${sheetRow}`, values: [[String(fields.amount)]] });
  }
  if (fields.reason !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!D${sheetRow}`, values: [[String(fields.reason)]] });
  }
  if (fields.dateCreated !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!E${sheetRow}`, values: [[String(fields.dateCreated)]] });
  }
  if (fields.status !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!F${sheetRow}`, values: [[String(fields.status)]] });
  }
  if (fields.datePaid !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!G${sheetRow}`, values: [[String(fields.datePaid)]] });
  }
  if (fields.notes !== undefined) {
    data.push({ range: `${SHEETS.DEBTS}!H${sheetRow}`, values: [[String(fields.notes)]] });
  }

  if (data.length === 0) return;

  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }
  );
}

/**
 * Elimina una fila de DEBTS.
 * @param {number} rowIndex  Índice 0-based (header = 0)
 * @param {number} sheetId
 */
export async function deleteDebt(rowIndex, sheetId) {
  if (sheetId === undefined || sheetId === null) {
    throw new Error('sheetId requerido para borrar filas de DEBTS');
  }
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension:  'ROWS',
              startIndex: rowIndex,
              endIndex:   rowIndex + 1,
            },
          },
        }],
      }),
    }
  );
  await loadDebts();
}

// =========================================================
// FUTURE — compras y pagos futuros
// =========================================================

const FUTURE_HEADER = ['id', 'concept', 'amount', 'date', 'priority', 'status', 'notes', 'date_updated'];

/** Carga FUTURE completo y actualiza state */
export async function loadFuture() {
  const range = `${SHEETS.FUTURE}!A:H`;
  let data;
  try {
    data = await _apiFetch(
      `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
    );
  } catch (err) {
    // La pestaña se crea sola al añadir el primer elemento
    if (err.status === 400 || err.status === 404) {
      setFutureItems([]);
      return;
    }
    throw err;
  }
  const rows = data.values ?? [];
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[FUTURE_COL.ID] && !row[FUTURE_COL.CONCEPT]) continue;
    items.push({
      rowIndex:    i,
      id:          String(row[FUTURE_COL.ID]       ?? '').trim(),
      concept:     String(row[FUTURE_COL.CONCEPT]  ?? '').trim(),
      amount:      _parseNumber(row[FUTURE_COL.AMOUNT]),
      date:        _parseFutureDate(row[FUTURE_COL.DATE]),
      priority:    String(row[FUTURE_COL.PRIORITY] ?? 'medium').trim().toLowerCase() || 'medium',
      status:      String(row[FUTURE_COL.STATUS]   ?? 'wanted').trim().toLowerCase() || 'wanted',
      notes:       String(row[FUTURE_COL.NOTES]    ?? '').trim(),
      dateUpdated: _parseDate(row[FUTURE_COL.DATE_UPDATED]),
    });
  }
  setFutureItems(items);
}

/**
 * Añade un elemento a FUTURE (crea la pestaña si no existe).
 * @param {{
 *   id: string, concept: string, amount: number, date: string,
 *   priority: string, status: string, notes?: string, dateUpdated: string
 * }} item
 */
export async function appendFuture(item) {
  await _ensureFutureSheet();
  const row = [
    item.id,
    item.concept,
    Number(item.amount),
    item.date,
    item.priority,
    item.status,
    item.notes || '',
    item.dateUpdated,
  ];
  const appendRange = `${SHEETS.FUTURE}!A:H`;
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );
}

/**
 * Actualiza una fila de FUTURE.
 * @param {number} rowIndex  Índice 0-based (header = 0)
 * @param {{concept?: string, amount?: number, date?: string, priority?: string,
 *          status?: string, notes?: string, dateUpdated?: string}} fields
 */
export async function updateFuture(rowIndex, fields) {
  const sheetRow = rowIndex + 1;
  // B concept, C amount, D date, E priority, F status, G notes, H date_updated
  const cols = {
    concept: 'B', amount: 'C', date: 'D', priority: 'E',
    status: 'F', notes: 'G', dateUpdated: 'H',
  };
  const data = [];
  for (const [key, col] of Object.entries(cols)) {
    if (fields[key] === undefined) continue;
    const value = key === 'amount' ? Number(fields[key]) : String(fields[key]);
    data.push({ range: `${SHEETS.FUTURE}!${col}${sheetRow}`, values: [[value]] });
  }
  if (data.length === 0) return;

  // RAW: evita que Sheets convierta '2026-12' en fecha o lea '5.5' según el locale
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }
  );
}

/**
 * Elimina una fila de FUTURE.
 * @param {number} rowIndex  Índice 0-based (header = 0)
 */
export async function deleteFuture(rowIndex) {
  let sheetId = sheetMeta[SHEETS.FUTURE];
  if (sheetId === undefined || sheetId === null) {
    await loadSheetMeta();
    sheetId = sheetMeta[SHEETS.FUTURE];
  }
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`No se encontró la pestaña ${SHEETS.FUTURE} en la hoja`);
  }
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension:  'ROWS',
              startIndex: rowIndex,
              endIndex:   rowIndex + 1,
            },
          },
        }],
      }),
    }
  );
  await loadFuture();
}

/** Crea la pestaña FUTURE con su cabecera si todavía no existe. */
async function _ensureFutureSheet() {
  if (sheetMeta[SHEETS.FUTURE] !== undefined) return;
  await loadSheetMeta();
  if (sheetMeta[SHEETS.FUTURE] !== undefined) return;

  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      body:   JSON.stringify({
        requests: [{ addSheet: { properties: { title: SHEETS.FUTURE } } }],
      }),
    }
  );
  await _apiFetch(
    `${API_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`${SHEETS.FUTURE}!A1:H1`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [FUTURE_HEADER] }) }
  );
  await loadSheetMeta();
}

/** Igual que _parseDate pero acepta también un mes suelto ('YYYY-MM'). */
function _parseFutureDate(value) {
  const str = String(value ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(str)) return str;
  return _parseDate(str);
}

// =========================================================
// Fetch helper interno
// =========================================================

class SheetsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name   = 'SheetsError';
  }
}

let _retryingAfter401 = false;

async function _apiFetch(url, options = {}) {
  const token = await getToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !_retryingAfter401) {
    // Token expiró entre la validación y la llamada → reforzamos el flujo
    _retryingAfter401 = true;
    try {
      // Forzamos nuevo token descartando el almacenado
      try { sessionStorage.removeItem('gasto_bot_token'); } catch { /* noop */ }
      const newToken = await getToken();
      const retryRes = await fetch(url, {
        ...options,
        headers: { ...headers, Authorization: `Bearer ${newToken}` },
      });
      _retryingAfter401 = false;
      if (!retryRes.ok) await _throwSheetsError(retryRes);
      return retryRes.json();
    } catch (e) {
      _retryingAfter401 = false;
      throw e;
    }
  }

  _retryingAfter401 = false;

  if (!res.ok) await _throwSheetsError(res);

  // batchUpdate devuelve 200 con body; values.get también
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function _throwSheetsError(res) {
  let msg = `Error ${res.status}`;
  try {
    const body = await res.json();
    msg = body?.error?.message ?? msg;
  } catch { /* noop */ }
  throw new SheetsError(res.status, msg);
}

// =========================================================
// Parsers internos
// =========================================================

/**
 * Parsea una fila del Sheet en un objeto Transaction.
 * @param {string[]} row
 * @param {number} absoluteRowIndex  Índice 0-based incluyendo la cabecera (header=0)
 * @returns {Transaction|null}
 */
function _parseTransactionRow(row, absoluteRowIndex) {
  if (!row || row.length < 3) return null;
  const dateRaw   = row[TX_COL.DATE];
  const amountRaw = row[TX_COL.AMOUNT];
  if (!dateRaw && !amountRaw) return null;

  return {
    rowIndex:    absoluteRowIndex,
    date:        _parseDate(dateRaw),
    amount:      _parseNumber(amountRaw),
    merchantNorm: String(row[TX_COL.MERCHANT_NORM] ?? '').trim(),
    budgetKey:   String(row[TX_COL.BUDGET_KEY]    ?? '').trim(),
    month:       String(row[TX_COL.MONTH]         ?? '').trim(),
  };
}

/**
 * Normaliza una fecha a 'YYYY-MM-DD'. Acepta:
 *   - ISO 'YYYY-MM-DD'
 *   - Formato locale español 'DD/MM/YYYY' o 'D/M/YYYY'
 *   - Número serial de Google Sheets
 * No usa `new Date(str)` para evitar ambigüedad locale/timezone.
 */
function _parseDate(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  // Formato DD/MM/YYYY (locale español de Sheets cuando la celda tiene formato Fecha)
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Número serial de Google Sheets (días desde 30/12/1899)
  const n = Number(str);
  if (!isNaN(n) && n > 1000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return str;
}

function _parseNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  // Eliminar todo excepto dígitos, coma, punto y signo negativo
  const clean = String(value).replace(/[^0-9,.\-]/g, '').replace(',', '.');
  const n = Number(clean);
  return isNaN(n) ? 0 : n;
}
