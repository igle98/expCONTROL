// =========================================================
// CONFIGURACIÓN — plantilla pública
//
// Cómo usar:
//   1. Copia este archivo como `js/config.js`:
//        cp js/config.example.js js/config.js
//   2. Rellena SPREADSHEET_ID y OAUTH_CLIENT_ID con tus valores.
//   3. `config.js` está en .gitignore — nunca se subirá al repo.
//
// Ver README.md → "Cómo configurar una copia propia".
// =========================================================

// ID del Google Sheet que actúa como backend.
// Lo encuentras en la URL: https://docs.google.com/spreadsheets/d/<ESTE-ID>/edit
// En local (localhost) se usa siempre la copia de pruebas, para no tocar datos reales.
const PROD_SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
const TEST_SPREADSHEET_ID = 'YOUR_TEST_SPREADSHEET_ID_HERE'; // copia del Sheet para desarrollo
export const IS_LOCAL       = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
export const SPREADSHEET_ID = IS_LOCAL ? TEST_SPREADSHEET_ID : PROD_SPREADSHEET_ID;

// OAuth Client ID de tipo "Web application" creado en Google Cloud Console.
// Debe tener tu dominio (p.ej. https://tuapp.web.app) en "Authorized JavaScript origins".
// Este valor es PÚBLICO por diseño — los OAuth Client IDs viven en código cliente;
// la protección real está en los Authorized Origins configurados en GCP.
export const OAUTH_CLIENT_ID = 'YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com';

export const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// Nombres de las pestañas dentro del Sheet. Si las renombras, ajusta aquí.
export const SHEETS = {
  TRANSACTIONS:   'TRANSACTIONS',
  BUDGET_KEYS:    'BUDGET_KEYS',
  MERCHANT_MAP:   'MERCHANT_MAP',
  BUDGET_HISTORY: 'BUDGET_HISTORY',
  DEBTS:          'DEBTS',
  FUTURE:         'FUTURE',
  PLAN_LINES:     'PLAN_LINES',
  FUNDING:        'FUNDING',
  MIGRATIONS:     'MIGRATIONS',
  INCOME:         'INCOME',
  INCOME_KEYS:    'INCOME_KEYS',
  HUCHAS:         'HUCHAS',
};

// Índices de columna en TRANSACTIONS (0-based)
// tx_id | ts_ingest | month | date | amount | currency | merchant_raw | merchant_norm | merchant_base | description | budget_key | type | confidence | merchant_map_source | telegram_message_id
export const TX_COL = {
  TX_ID:              0,
  TS_INGEST:          1,
  MONTH:              2,
  DATE:               3,
  AMOUNT:             4,
  CURRENCY:           5,
  MERCHANT_RAW:       6,
  MERCHANT_NORM:      7,
  MERCHANT_BASE:      8,
  DESCRIPTION:        9,
  BUDGET_KEY:        10,
  TYPE:              11,
  CONFIDENCE:        12,
  MERCHANT_MAP_SRC:  13,
  TELEGRAM_MSG_ID:   14,
};

// Índices de columna en BUDGET_KEYS (0-based) — catálogo de categorías (presupuesto v2)
// budget_key | code | allows_hucha | ref_amount | due_day | status
// code: NMC…EDV o INV (ver js/utils/categoryCodes.js). status: active | paused | archived.
// Lo presupuestado cada mes NO vive aquí, sino en PLAN_LINES.
export const BK_COL = {
  BUDGET_KEY:   0,
  CODE:         1,
  ALLOWS_HUCHA: 2,
  REF_AMOUNT:   3,
  DUE_DAY:      4,
  STATUS:       5,
};

// Formato anterior de BUDGET_KEYS (antes de la migración v2), solo para lectura
// budget_key | type | monthly_budget | fixed_amount | due_day | active
export const LEGACY_BK_COL = {
  BUDGET_KEY:     0,
  TYPE:           1,
  MONTHLY_BUDGET: 2,
  FIXED_AMOUNT:   3,
  DUE_DAY:        4,
  ACTIVE:         5,
};

// Índices de columna en MERCHANT_MAP (0-based)
// merchant_norm | budget_key | type | first_seen | last_seen | confidence_last | source
export const MM_COL = {
  MERCHANT_NORM:    0,
  BUDGET_KEY:       1,
  TYPE:             2,
  FIRST_SEEN:       3,
  LAST_SEEN:        4,
  CONFIDENCE_LAST:  5,
  SOURCE:           6,
};

// Índices de columna en BUDGET_HISTORY (0-based)
// month | budget_key | type | monthly_budget | fixed_amount | due_day | spent | snapshot_ts
export const BH_COL = {
  MONTH:          0,
  BUDGET_KEY:     1,
  TYPE:           2,
  MONTHLY_BUDGET: 3,
  FIXED_AMOUNT:   4,
  DUE_DAY:        5,
  SPENT:          6,
  SNAPSHOT_TS:    7,
};

// Índices de columna en DEBTS (0-based)
// id | person | amount | reason | date_created | status | date_paid | notes
export const DEBT_COL = {
  ID:           0,
  PERSON:       1,
  AMOUNT:       2,
  REASON:       3,
  DATE_CREATED: 4,
  STATUS:       5,
  DATE_PAID:    6,
  NOTES:        7,
};

// Índices de columna en FUTURE (0-based) — compras y pagos futuros
// id | concept | amount | date | priority | status | notes | date_updated
// `date` puede ser un mes ('YYYY-MM') o un día concreto ('YYYY-MM-DD').
export const FUTURE_COL = {
  ID:           0,
  CONCEPT:      1,
  AMOUNT:       2,
  DATE:         3,
  PRIORITY:     4,
  STATUS:       5,
  NOTES:        6,
  DATE_UPDATED: 7,
};

// Índices de columna en PLAN_LINES (0-based) — lo presupuestado por categoría y mes
// month | budget_key | amount | note
// Claves que empiezan por '@' son líneas especiales (p.ej. '@IMPREVISTOS' = reserva del mes).
export const PL_COL = {
  MONTH:      0,
  BUDGET_KEY: 1,
  AMOUNT:     2,
  NOTE:       3,
};

// Índices de columna en FUNDING (0-based) — de dónde sale el dinero de cada gasto
// date | month | tx_id | source | amount | kind | note
// source: 'IMPREVISTOS', 'HUCHA:<nombre>', 'CAT:<budget_key>'…  kind: cobertura | aportacion | retirada | ajuste
export const FUND_COL = {
  DATE:   0,
  MONTH:  1,
  TX_ID:  2,
  SOURCE: 3,
  AMOUNT: 4,
  KIND:   5,
  NOTE:   6,
};

// Índices de columna en INCOME (0-based) — ingresos de cada mes
// month | income_key | amount | note
export const IN_COL = {
  MONTH:      0,
  INCOME_KEY: 1,
  AMOUNT:     2,
  NOTE:       3,
};

// Categorías de ingreso (INCOME_KEYS): income_key | status (active | archived)
export const DEFAULT_INCOME_KEYS = ['Nómina', 'Alba', 'Extra nómina', 'Extra propios', 'Cobro de deudas', 'Otros'];

// Índices de columna en HUCHAS (0-based)
// name | type | status | target | target_date | note
// type: objetivo | provision · status: active | archived · target_date: 'YYYY-MM' opcional
export const HUCHA_COL = {
  NAME:        0,
  TYPE:        1,
  STATUS:      2,
  TARGET:      3,
  TARGET_DATE: 4,
  NOTE:        5,
};

// Huchas iniciales (Sheet CLASIFICACION, pestaña HUCHAS, 2026-10-10). Las de inversión
// (TR, MY) no son huchas: son categorías INV. BODAS estaba inactiva.
export const DEFAULT_HUCHAS = [
  ['FONDO EMERGENCIA', 'objetivo'], ['PC', 'objetivo'], ['NAVIDADES', 'objetivo'],
  ['CREMAS', 'objetivo'], ['SUPLEMENTOS', 'objetivo'], ['OCIO_PLAN', 'objetivo'],
  ['TATTOO', 'objetivo'], ['GIFTS', 'objetivo'], ['ENTRADA_COCHE', 'objetivo'],
  ['VIAJES', 'objetivo'], ['CURSOS', 'objetivo'], ['COLONIA', 'objetivo'],
  ['ARREGLO_COCHE', 'objetivo'], ['ROPA_CAPRICHO', 'objetivo'], ['ROPA_BASICA', 'objetivo'],
  ['CAPRICHOS', 'provision'], ['DECLA_RENTA', 'provision'], ['HOUSE_INS', 'provision'],
  ['ITV', 'provision'], ['MINOXIDIL', 'provision'], ['DUTASTERIDA', 'provision'],
  ['SHAMPOO', 'provision'], ['LENTILLAS', 'provision'], ['AGUA', 'provision'],
  ['RODAJE', 'provision'], ['SALUD_DENTAL', 'provision'], ['BODAS', 'provision', 'archived'],
  ['EMPRENDIMIENTO', 'provision'],
];

export const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
