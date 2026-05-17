// =========================================================
// classifier.js — clasifica un gasto con OpenAI gpt-4o-mini.
// Reproduce el nodo "Message a model" + "Parse AI Classification"
// del workflow n8n. La API key vive en localStorage.
// =========================================================

const OPENAI_KEY_STORAGE = 'gastosbot.openai_key';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

export function getOpenAIKey() {
  try { return localStorage.getItem(OPENAI_KEY_STORAGE) || ''; }
  catch { return ''; }
}

export function setOpenAIKey(key) {
  try {
    if (key) localStorage.setItem(OPENAI_KEY_STORAGE, key.trim());
    else localStorage.removeItem(OPENAI_KEY_STORAGE);
  } catch { /* noop */ }
}

export function hasOpenAIKey() {
  return Boolean(getOpenAIKey());
}

/**
 * @param {{
 *   merchant_raw:string, merchant_base:string, description:string,
 *   amount:number, currency:string, date:string,
 *   budget_keys:string[],
 * }} ctx
 * @returns {Promise<{budget_key_suggested:string, confidence:number}>}
 */
export async function classifyWithOpenAI(ctx) {
  const key = getOpenAIKey();
  if (!key) throw new Error('Falta la API key de OpenAI. Configúrala en Ajustes.');

  const prompt = _buildPrompt(ctx);

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    let msg = `OpenAI ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error?.message ?? msg;
    } catch { /* noop */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI no devolvió contenido.');

  return _parseClassification(raw);
}

function _buildPrompt(ctx) {
  return `Eres un clasificador de gastos. Devuelve SOLO JSON válido.

Clasifica el gasto en una de las categorías de la lista teniendo en cuenta los siguientes datos del gasto:

Merchant: ${ctx.merchant_raw}
Merchant_base: ${ctx.merchant_base}
Description: ${ctx.description}
Amount: ${ctx.amount} ${ctx.currency}
Date: ${ctx.date}

Las categorías permitidas están en esta lista:
${JSON.stringify(ctx.budget_keys)}

Devuelve exactamente:
{
  "budget_key_suggested": "string",
  "confidence": number
}

Reglas:
- Devuelve SOLO JSON válido. No uses bloques \`\`\` ni markdown.
- "budget_key_suggested" debe ser EXACTAMENTE una de las categorías permitidas.
- confidence entre 0 y 1.
- Si duda, elige la más probable con confidence baja.
`;
}

function _parseClassification(raw) {
  let cleaned = String(raw).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('OpenAI no devolvió un objeto JSON reconocible: ' + cleaned);
  }
  const slice = cleaned.slice(first, last + 1);

  let parsed;
  try { parsed = JSON.parse(slice); }
  catch { throw new Error('OpenAI devolvió texto no-JSON parseable: ' + slice); }

  if (!parsed.budget_key_suggested) throw new Error('Falta budget_key_suggested en respuesta de OpenAI.');
  if (typeof parsed.confidence !== 'number') throw new Error('confidence no es número en respuesta de OpenAI.');

  return {
    budget_key_suggested: String(parsed.budget_key_suggested).trim(),
    confidence:           parsed.confidence,
  };
}
