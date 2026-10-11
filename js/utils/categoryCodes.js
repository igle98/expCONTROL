// =========================================================
// categoryCodes.js — clasificación de categorías (presupuesto v2)
// Código de 3 letras: Necesario/Electivo · Mensual/Discontinuo · Constante/Variable,
// más INV para inversiones (no cuentan como gasto). Ver docs/presupuesto-v2.md.
// =========================================================

export const CODES = [
  { code: 'NMC', label: 'Necesario mensual · constante'     },
  { code: 'NMV', label: 'Necesario mensual · variable'      },
  { code: 'NDC', label: 'Necesario discontinuo · constante' },
  { code: 'NDV', label: 'Necesario discontinuo · variable'  },
  { code: 'EMC', label: 'Electivo mensual · constante'      },
  { code: 'EMV', label: 'Electivo mensual · variable'       },
  { code: 'EDC', label: 'Electivo discontinuo · constante'  },
  { code: 'EDV', label: 'Electivo discontinuo · variable'   },
  { code: 'INV', label: 'Inversión (no es gasto)'           },
];

export const STATUSES = [
  { key: 'active',   label: 'Activa'    },
  { key: 'paused',   label: 'Pausada'   },
  { key: 'archived', label: 'Archivada' },
];

const VALID_CODES = new Set(CODES.map(c => c.code));

export function isValidCode(code) { return VALID_CODES.has(code); }

/** Inversión: sale del dinero del mes pero no es gasto */
export function isInvestmentCode(code) { return code === 'INV'; }

/** Electivo (ocio, caprichos…): el colchón de imprevistos nunca es su primera opción */
export function isElectiveCode(code) { return code?.[0] === 'E'; }

/** Compatibilidad con el modelo anterior: constante (o inversión) = 'Fijo', variable = 'Variable' */
export function typeFromCode(code) {
  return code === 'INV' || code?.[2] === 'C' ? 'Fijo' : 'Variable';
}

export function codeLabel(code) {
  return CODES.find(c => c.code === code)?.label ?? code;
}
