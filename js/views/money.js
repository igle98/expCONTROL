// =========================================================
// money.js — pestaña "Dinero": Deudas · Huchas · Compras futuras.
// Tres botones arriba; se muestra una sección cada vez.
// =========================================================

import * as debts  from './debts.js';
import * as huchas from './huchas.js';
import * as future from './future.js';

const TABS = [
  { key: 'debts',  label: '💰 Deudas',          sectionId: 'debts-section',  view: debts  },
  { key: 'huchas', label: '🐷 Huchas',          sectionId: 'huchas-section', view: huchas },
  { key: 'future', label: '🗓️ Compras futuras', sectionId: 'future-section', view: future },
];

const STORAGE_KEY = 'money_tab';
let _tab = _loadTab();

export function render() {
  const bar = document.getElementById('money-tabs');
  if (!bar) return;

  bar.replaceChildren(...TABS.map(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip ${t.key === _tab ? 'chip-active' : ''}`;
    btn.textContent = t.label;
    btn.addEventListener('click', () => { _tab = t.key; _saveTab(); render(); });
    return btn;
  }));

  for (const t of TABS) {
    document.getElementById(t.sectionId)?.classList.toggle('hidden', t.key !== _tab);
  }
  TABS.find(t => t.key === _tab)?.view.render();
}

function _loadTab() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return TABS.some(t => t.key === saved) ? saved : 'huchas';
  } catch {
    return 'huchas';
  }
}

function _saveTab() {
  try { localStorage.setItem(STORAGE_KEY, _tab); } catch { /* noop */ }
}
