// =========================================================
// v2Data.js — datos fijos de la migración a presupuesto v2
// Catálogo copiado del Sheet CLASIFICACION (pestaña GASTOS, 2026-10-10)
// más las inversiones. Ver docs/presupuesto-v2.md §7.
// =========================================================

/** [budget_key, código, permite hucha, estado] */
export const CATALOG = [
  ['CREMA_DIA',             'EDV', true ],
  ['CREMA_NOCHE',           'EDV', true ],
  ['CREMA_OJOS',            'EDV', true ],
  ['NIACINAMIDA',           'EDV', true ],
  ['PROTEINA',              'EDV', true ],
  ['OMEGA3',                'EDV', true ],
  ['CREATINA',              'EDV', true ],
  ['CREMA_ARROZ',           'EDV', true ],
  ['MAGNESIO',              'EDV', true ],
  ['COLONIA',               'EDV', true ],
  ['OCIO_PLAN',             'EDV', true ],
  ['TATTOO',                'EDV', true ],
  ['GIFTS',                 'EDV', true ],
  ['ENTRADA_COCHE',         'EDV', true ],
  ['MEJORAS_HOGAR',         'EDV', false],
  ['REPOSICION_HOGAR',      'NDV', false],
  ['VIAJES',                'EDV', true ],
  ['ESTUDIOS',              'EDV', true ],
  ['CAPRICHOS',             'EDV', true ],
  ['SPOTIFY',               'EMC', false],
  ['CHATGPT',               'EMC', false],
  ['CLASES_PADEL',          'EMC', false],
  ['CLAUDE',                'EMC', false],
  ['GREEN_PEACE',           'EMC', false],
  ['GYM',                   'EMC', false],
  ['OCIO',                  'EMV', false],
  ['INVITACIONES',          'EMV', false],
  ['PARTIDOS_PADEL',        'EMV', false],
  ['HOUSE_INS',             'NDC', true ],
  ['ITV',                   'NDC', true ],
  ['MINOXIDIL',             'NDC', true ],
  ['DUTASTERIDA',           'NDC', true ],
  ['SHAMPOO',               'NDC', true ],
  ['LENTILLAS',             'NDC', true ],
  ['AGUA',                  'NDC', true ],
  ['RODAJE',                'NDC', true ],
  ['DECLA_RENTA',           'NDC', true ],
  ['CREMA_GRANOS',          'NDV', true ],
  ['JABON_CARA',            'NDV', true ],
  ['CREMA_SOL',             'NDV', true ],
  ['TRANSPORTE_PUB',        'NDV', false],
  ['ARREGLO_COCHE',         'NDV', true ],
  ['ROPA_BASICA',           'NDV', true ],
  ['SALUD_DENTAL',          'NDV', true ],
  ['ROPA_CAPRICHO',         'EDV', true ],
  ['TECNOLOGÍA',            'EDV', true ],
  ['CAR_INS',               'NMC', false],
  ['HAIRCUT',               'NMC', false],
  ['O2',                    'NMC', false],
  ['LUZ_GAS',               'NMC', false],
  ['DEUDAS',                'NMC', false],
  ['PEÑA',                  'NMC', false],
  ['SUPERMERCADO_CONJUNTO', 'NMV', false],
  ['GASOLINA',              'NMV', false],
  ['TRADE_REPUBLIC',        'INV', false, 'active'  ],
  ['MYINVESTOR',            'INV', false, 'paused'  ],
  ['AXA_INV',               'INV', false, 'archived'],
];

/** Renombres directos (nombre antiguo → nuevo) en gastos, comercios e histórico */
export const RENAMES = {
  HAIRCUT1:     'HAIRCUT',
  HAIRCUT2:     'HAIRCUT',
  PELO:         'DEUDAS',
  NIACILAMINA:  'NIACINAMIDA',
  SUPERMERCADO: 'SUPERMERCADO_CONJUNTO',
  ROPA:         'ROPA_BASICA',
};

/**
 * Categorías nuevas que heredan importe de referencia y día de pago de su nombre
 * antiguo (solo erratas; DEUDAS no hereda de PELO, que era una financiación ya terminada)
 */
export const INHERIT_SETTINGS = {
  NIACINAMIDA:           'NIACILAMINA',
  SUPERMERCADO_CONJUNTO: 'SUPERMERCADO',
  ROPA_BASICA:           'ROPA',
};

/** Categorías antiguas cuyos gastos se revisan uno a uno */
export const REVIEW_KEYS = ['CASA_ART', 'IMPREVISTOS'];

/** Categorías antiguas cuyos gastos se borran (no eran gastos, sino traspasos al ahorro) */
export const DELETE_KEYS = ['REPOSICION_AHORRO'];

/** Cómo se trasladan al plan mensual las líneas antiguas de presupuesto */
export const PLAN_KEY_MAP = {
  ...RENAMES,
  CASA_ART:          'MEJORAS_HOGAR',
  IMPREVISTOS:       '@IMPREVISTOS',   // reserva del mes, no categoría
  REPOSICION_AHORRO: null,             // se descarta
};

/**
 * Propuesta de categoría para un gasto en revisión, según su descripción.
 * `uncertain` = no hay una categoría evidente: conviene que la revises.
 * @returns {{ key: string, uncertain: boolean }}
 */
export function proposeCategory(oldKey, description) {
  const d = String(description ?? '').toLowerCase();
  const rules = oldKey === 'CASA_ART' ? CASA_RULES : IMPREVISTO_RULES;
  for (const [pattern, key, uncertain = false] of rules) {
    if (pattern.test(d)) return { key, uncertain };
  }
  return oldKey === 'CASA_ART'
    ? { key: 'MEJORAS_HOGAR', uncertain: false }
    : { key: 'OCIO',          uncertain: true  };
}

const CASA_RULES = [
  [/dobby|bolsa/, 'REPOSICION_HOGAR'],
];

const IMPREVISTO_RULES = [
  [/\baxa\b/,                    'AXA_INV'],
  [/bocata|mc ?donal|vending/,   'OCIO'],
  [/futsal|torneo/,              'OCIO'],
  [/concierto/,                  'OCIO_PLAN'],
  [/xbox|juego/,                 'CAPRICHOS'],
  [/vasos|edred/,                'REPOSICION_HOGAR'],
  [/obramat/,                    'MEJORAS_HOGAR',  true],
  [/cuchillas/,                  'REPOSICION_HOGAR', true],
  [/parking/,                    'TRANSPORTE_PUB', true],
  [/youtube/,                    'CAPRICHOS',      true],
  [/padel/,                      'PARTIDOS_PADEL', true],
  [/planner|agenda/,             'ESTUDIOS',       true],
];
