// =========================================================
// settings.js — pantalla de Ajustes (de momento solo OpenAI key).
// =========================================================

import { el, showToast } from '../utils/dom.js';
import { getOpenAIKey, setOpenAIKey } from '../expense/classifier.js';

const ROOT_ID = 'view-settings';

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const current = getOpenAIKey();
  const masked = current ? `${current.slice(0, 7)}…${current.slice(-4)}` : '';

  const input = el('input', {
    type: 'password',
    id: 'settings-openai-key',
    class: 'settings-input',
    placeholder: 'sk-…',
    value: current,
    autocomplete: 'off',
  });

  const saveBtn = el('button', {
    type: 'submit',
    class: 'btn btn-primary',
  }, 'Guardar');

  const clearBtn = el('button', {
    type: 'button',
    class: 'btn btn-secondary',
    onclick: () => {
      setOpenAIKey('');
      input.value = '';
      showToast('API key eliminada', 'info');
      render();
    },
  }, 'Borrar');

  const form = el('form', {
    class: 'settings-form',
    onsubmit: (e) => {
      e.preventDefault();
      const v = input.value.trim();
      setOpenAIKey(v);
      showToast(v ? 'API key guardada' : 'API key eliminada', 'success');
      render();
    },
  },
    el('label', { for: 'settings-openai-key', class: 'settings-label' },
      'OpenAI API key',
    ),
    el('p', { class: 'muted small' },
      'Se guarda solo en este dispositivo (localStorage). Se usa para clasificar gastos con gpt-4o-mini.'),
    input,
    masked
      ? el('p', { class: 'muted small' }, `Actual: ${masked}`)
      : null,
    el('div', { class: 'settings-actions' }, saveBtn, clearBtn),
  );

  root.replaceChildren(
    el('div', { class: 'settings-card' }, form),
  );
}
