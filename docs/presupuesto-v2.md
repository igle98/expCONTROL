# Presupuesto v2 — diseño acordado

Rediseño para planificar el mes, gestionar huchas y clasificar gastos íntegramente desde la PWA,
sin editar el Sheet a mano y sin perder el historial existente.

Rama de trabajo: `presupuesto-v2`. En `localhost` la app usa siempre el Sheet
**Coach Financiero - PRUEBAS**; la web publicada usa **Coach Financiero**.

---

## 1. Clasificación de categorías

Cada categoría tiene un código de tres letras:

| Código | Necesidad | Frecuencia | Importe |
|---|---|---|---|
| NMC / NMV | Necesario | Mensual | Constante / Variable |
| NDC / NDV | Necesario | Discontinuo | Constante / Variable |
| EMC / EMV | Electivo | Mensual | Constante / Variable |
| EDC / EDV | Electivo | Discontinuo | Constante / Variable |
| INV | Inversión | — | — |

- Compatibilidad: `Fijo` = código acabado en **C**; `Variable` = acabado en **V**.
- **Inversión** (`INV`): sale del dinero del mes como un fijo, pero **no cuenta como gasto** en
  estadísticas y **no tiene saldo** (la app no refleja el valor de la cartera). Se muestra aparte
  ("Invertido este año"), incluyendo todo el histórico (TRADE_REPUBLIC, MYINVESTOR, AXA_INV).
- **Estado** de cada categoría: `active` (se sugiere), `paused` (no se sugiere, reactivable),
  `archived` (no se sugiere nunca; sus transacciones se conservan en estadísticas).
- Cada categoría indica si **permite pagar con hucha** (SI/NO).

## 2. Catálogo (`BUDGET_KEYS`)

`budget_key | code | allows_hucha | ref_amount | due_day | status`

- Desaparecen `monthly_budget` y `fixed_amount`: lo asignado cada mes vive en el plan del mes.
- `ref_amount` es una referencia que mantiene la app: en constantes, el último importe pagado;
  en variables, se ignora (las sugerencias salen del historial).

## 3. Plan mensual

- Cada mes tiene su propio plan (`PLAN_MONTHS` + `PLAN_LINES`): preparar el mes siguiente no toca el actual.
- Los presupuestos históricos (`BUDGET_HISTORY`) se convierten en planes de esos meses.
- Orden del asistente: Ingresos → Fijos/discontinuos → Inversión → Ahorro y aportaciones a huchas
  → Reserva de imprevistos → Variables (con sugerencias) → Resumen y aprobar.
- Ingresos por mes en `INCOME`.

## 4. Huchas

- `HUCHAS`: nombre, tipo (`objetivo` / `provision`), activa, objetivo y fecha opcionales.
- `FUNDING` (libro de movimientos): aportaciones (+), retiradas para pagar gastos (−), ajustes.
  El saldo es la suma. El dinero ya ahorrado entra como movimiento inicial.
- Todas las huchas viven físicamente en la cuenta de ahorro; la app calcula la transferencia neta del mes.
- Al pagar: se elige tipo (provisión/objetivo) y luego cualquier hucha de la lista; la app
  preselecciona la última usada con esa categoría.

## 5. Cobertura de gastos (regla central)

**Registrar siempre el gasto; ampliar el presupuesto ajustado solo por el importe cubierto por una
fuente identificada; dejar visible el resto como déficit.**

Por categoría: `inicial` (plan) · `ajustado` (inicial + coberturas) · `gastado` · `disponible`.

Cuando un gasto no cabe en el disponible de su categoría, se ofrece cubrir lo que falta con
(admite varias fuentes y cobertura parcial):

1. **Mover de otra categoría** con saldo (el usuario elige cuál; nunca automático).
2. **Dinero del mes sin asignar.**
3. **Reducir una aportación prevista** a hucha aún no realizada (se registra como "reducción del ahorro previsto").
4. **Hucha** (cualquiera; registra retirada).
5. **Reserva de imprevistos.**
6. **Dejar pendiente de cubrir** (no es una fuente: queda como déficit visible).

Control de gasto electivo:
- En categorías **E** (electivas: ocio, caprichos…) la reserva de imprevistos (el "colchón")
  **nunca puede ser la primera opción ni venir preseleccionada**, en ningún caso; primero se pide
  decidir qué otro gasto u objetivo se sacrifica.
- En categorías **N** (necesarias) imprevistos sí aparece entre las primeras opciones.
- Las reasignaciones quedan siempre visibles: "Ocio: 50 € previstos, 80 € gastados, +30 € de Gasolina".

## 6. Cierre de mes

Muestra por separado:
- Desviación respecto al plan inicial.
- Importe pendiente de cubrir (no se arrastra automáticamente: se resuelve como deuda real,
  hucha usada sin registrar o asignación pendiente).
- Dinero retirado de huchas.
- **Sobrante de imprevistos** → el usuario elige a qué hucha va.
- **Recordatorio de transferencia** a la cuenta de ahorro (aportaciones − retiradas + sobrantes).

## 7. Migración (fase 0)

Se ejecuta desde una pantalla de la app que muestra todos los cambios antes de aplicarlos.
Primero en PRUEBAS; después, con copia de seguridad, en el Sheet real.

| Cambio | Alcance |
|---|---|
| `HAIRCUT1` → `HAIRCUT` | 6 transacciones |
| `PELO` → `DEUDAS` | 8 |
| `NIACILAMINA` → `NIACINAMIDA` | 1 |
| `SUPERMERCADO` → `SUPERMERCADO_CONJUNTO` | 1 |
| `ROPA` → `ROPA_BASICA` | 0 (solo catálogo) |
| `CASA_ART` → `MEJORAS_HOGAR` / `REPOSICION_HOGAR` | 16, revisión una a una |
| `IMPREVISTOS` → categoría real, marcadas "cubierto con imprevistos" | 18, revisión una a una (p. ej. "axa" → `AXA_INV`) |
| Borrar transacción `REPOSICION_AHORRO` (432,70 €, 2026-10-04) | 1 (era un traspaso, no un gasto) |
| Columna `month` → texto `AAAA-MM` en todas las filas | TRANSACTIONS y BUDGET_HISTORY |
| Catálogo nuevo desde CLASIFICACION + `INV` + estados | BUDGET_KEYS |
| `MERCHANT_MAP` con los nombres nuevos | Para que la IA clasifique bien |
| `IMPREVISTOS` y `CAPRICHOS` duplicada | Imprevistos archivada; Caprichos una sola hucha |
| Pestañas nuevas | PLAN_MONTHS, PLAN_LINES, INCOME, HUCHAS, FUNDING |

### Cómo se aplica

Ajustes → **Migración a presupuesto v2** → *Revisar cambios* → corregir los gastos marcados ⚠️ →
*Aplicar migración*. En `localhost` se aplica sobre PRUEBAS; en la web publicada pide escribir `MIGRAR`.

Orden de escritura (todo idempotente; el catálogo, que es lo que activa el modelo v2, va al final):
celdas sueltas → PLAN_LINES y FUNDING → borrados → BUDGET_KEYS → marca en MIGRATIONS.

Hasta que exista el asistente (fase 2), el presupuesto de cada mes se edita en
Presupuesto → **✏️ Editar presupuesto**. Un mes sin plan propio usa el último anterior.

## 8. Fases

0. Migración de datos y catálogo.
1. Huchas y cobertura de gastos (pagar con hucha / imprevistos / mover / pendiente).
2. Asistente de presupuesto mensual y cierre de mes.
3. Detección de ciclos de discontinuos y avisos de patrones.
