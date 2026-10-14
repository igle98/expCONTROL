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
- Asistente (Presupuesto → 📝 Preparar / ✏️ Editar), en este orden:
  1. **Ingresos** (categorías en `INCOME_KEYS`, ampliables desde el propio paso; importes en `INCOME`).
  2. **Necesarios + electivos mensuales** (NM, ND, EM) y al final el **colchón** (`@IMPREVISTOS`).
  3. **Inversiones** (INV).
  4. **Ahorro y huchas**: de momento una línea `@AHORRO`; con la fase de huchas se reparte entre ellas.
  5. **Resto de electivos** (ED).
  Siempre visible: ingresos · asignado · te quedan. Cada categoría muestra lo gastado el mes anterior.
- La vista Presupuesto muestra arriba ingresos, presupuestado y sin asignar, y filtros por tipo
  (NM, ND, EM, ED, INV).
- El selector de mes permite ir hasta un mes por delante para preparar el siguiente.

## 4. Huchas

- `HUCHAS`: nombre, tipo (`objetivo` / `provision`), activa, objetivo y fecha opcionales.
- `FUNDING` (libro de movimientos): aportaciones (+), retiradas para pagar gastos (−), ajustes.
  El saldo es la suma. El dinero ya ahorrado entra como movimiento inicial.
- Todas las huchas viven físicamente en la cuenta de ahorro; la app calcula la transferencia neta del mes.
- Al pagar: se elige tipo (provisión/objetivo) y luego cualquier hucha de la lista; la app
  preselecciona la última usada con esa categoría.

### Implementación (fase 1)

- `HUCHAS`: `name | type | status | target | target_date | note`. Se crea con las de serie
  (CLASIFICACION) la primera vez que se guarda algo de una hucha.
- `FUNDING` (importes siempre positivos salvo ajustes):
  `HUCHA:<n>` + `aportacion` (entra) · `retirada` (paga el gasto `tx_id`) · `ajuste` (saldo inicial/corrección);
  `IMPREVISTOS` | `SIN_ASIGNAR` | `CAT:<key>` + `cobertura` (cubre parte del gasto `tx_id`).
- Sección **Huchas** en Gráficas: saldos, objetivo y progreso, movimientos, "Ajustar saldo"
  (para meter lo ya ahorrado), alta/edición/archivado y aviso de **aportaciones previstas del mes**
  con botón "Ya la hice" (registra las aportaciones al hacer la transferencia).
- Paso 4 del asistente: aportación prevista por hucha (líneas `@HUCHA:<n>` del plan) con saldo y,
  si hay objetivo con fecha, la cantidad sugerida al mes; más `@AHORRO` (ahorro libre).
- Al registrar un gasto que no cabe (o de categoría que permite hucha) se abre **Cubrir el exceso**.
  La hucha se preselecciona: la última usada con esa categoría o la que se llama igual.
- Vista Presupuesto: las variables muestran el presupuesto **ajustado** y de dónde vino
  ("100 € previstos · +30 € de GASOLINA"); arriba, lo que queda del colchón.

### Gastado, pagado con hucha y consumido del mes

Por categoría y mes se distinguen:

| Concepto | Qué es |
|---|---|
| **Gastado** | Todo lo gastado. Es lo que cuentan estadísticas y gráficas. |
| **Pagado con hucha** | Parte pagada con dinero apartado en meses anteriores. |
| **Consumido del mes** | Gastado − pagado con hucha: lo que sale de los ingresos de este mes. |
| **Presupuesto ajustado** | Plan + dinero **del mes** movido (colchón, sin asignar, otras categorías). Las huchas **no** lo amplían. |
| **Disponible** | Ajustado − consumido. |

Ejemplo: GIFTS con 75 € de plan, gasto de 60 € pagando 30 € con la hucha GIFTS →
consumido 30 € de 75 € (40 %), hucha −30 €.

**Huchas ↔ categorías** es una relación varios-a-varios: cada hucha guarda la lista de
categorías de gasto que suele pagar (columna `categories` de HUCHAS; `-` = ninguna a propósito).
Una categoría puede tener varias huchas (TECNOLOGÍA ← PC, WATCH…). Se usa para:
- el asistente: cada categoría muestra el saldo de sus huchas, para presupuestar del mes solo
  lo que no vayan a cubrir;
- al pagar: las vinculadas salen primero (★); se puede elegir cualquier otra.

La financiación de un gasto se puede ver, ampliar o quitar después desde la lista de gastos
(Editar gasto → Financiación).

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
| Pestañas nuevas | PLAN_LINES, FUNDING, MIGRATIONS (INCOME e INCOME_KEYS se crean al guardar el primer presupuesto) |

### Cómo se aplica

Ajustes → **Migración a presupuesto v2** → *Revisar cambios* → corregir los gastos marcados ⚠️ →
*Aplicar migración*. En `localhost` se aplica sobre PRUEBAS; en la web publicada pide escribir `MIGRAR`.

Orden de escritura (todo idempotente; el catálogo, que es lo que activa el modelo v2, va al final):
celdas sueltas → PLAN_LINES y FUNDING → borrados → BUDGET_KEYS → marca en MIGRATIONS.

Un mes sin plan propio usa el último anterior.

## 8. Fases

0. Migración de datos y catálogo.
1. Huchas y cobertura de gastos (pagar con hucha / imprevistos / mover / pendiente).
2. Asistente de presupuesto mensual y cierre de mes.
3. Detección de ciclos de discontinuos y avisos de patrones.
