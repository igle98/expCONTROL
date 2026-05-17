# GastosBOTijo

> PWA personal de control de gastos, sin backend, con clasificación automática mediante IA.

Aplicación web instalable como app nativa (iOS / Android) que sustituye una solución previa basada en **bot de Telegram + workflow de n8n + Google Sheets**. Toda la lógica corre en el navegador del usuario; Google Sheets actúa como base de datos persistente y OpenAI clasifica los gastos en categorías de presupuesto.

---

## ✨ Qué hace

- **Registro rápido de gastos** desde un único input de texto libre (ej. `12.50 mercadona ayer`) que se parsea, normaliza y clasifica automáticamente.
- **Clasificación con IA** (`gpt-4o-mini`) cuando el comercio es desconocido — con caché local para no llamar dos veces por el mismo comercio.
- **Presupuestos mensuales** con seguimiento de fijos y variables, barra de progreso por categoría y snapshot histórico mes a mes.
- **Reportes y gráficas**: evolución mensual, distribución por categoría, top comercios.
- **Registro de deudas** ("me deben dinero") con agrupación por persona y filtros por estado (pendiente / cobrada / cancelada).
- **Offline-first** vía Service Worker: la app abre y navega sin conexión, las escrituras se sincronizan al recuperar red.
- **Instalable como PWA** en iPhone y Android (icono de inicio, pantalla completa, splash screen).
- **Responsive**: layout adaptado a móvil, tablet y desktop (en iPad / PC se reorganiza en columnas para aprovechar el ancho).

---

## 🏗️ Stack y decisiones técnicas

| Capa | Tecnología | Por qué |
|------|------------|---------|
| Frontend | **Vanilla JS + ES modules** | Cero build step, cero framework, cero dependencias npm. El bundle final es el propio código fuente. |
| Estilos | **CSS puro con custom properties** | Tematización consistente sin preprocesadores. Tres breakpoints (móvil / iPad / PC). |
| Backend | **Google Sheets API v4** | Cero servidor propio. El usuario es dueño 100% de sus datos. |
| Autenticación | **Google Identity Services (GIS)** | OAuth en cliente con renovación silenciosa de token. Sin sesión en backend. |
| Clasificación IA | **OpenAI `gpt-4o-mini`** | Llamada directa desde el navegador; API key del propio usuario en `localStorage`. |
| Hosting | **Firebase Hosting** | Servir en raíz de dominio (necesario para `start_url` de PWA en iOS). |
| Offline | **Service Worker** custom | Estrategia cache-first para el shell, network-only para Google APIs, network-first con fallback para CDN. |
| Gráficas | **Chart.js** (vía CDN) | Suficiente para barras / dona; no justifica una dependencia mayor. |

### Decisiones interesantes

- **Sin framework**: el alcance del proyecto no justifica React/Vue. Vanilla JS + módulos ES + funciones puras de render mantienen el código auditable y el bundle bajo control.
- **Sheets como base de datos**: trade-off consciente. Renuncio a queries complejas y a integridad transaccional a cambio de cero infraestructura y propiedad total del dato por parte del usuario.
- **Caché de clasificación (`MERCHANT_MAP`)**: una vez clasificado un comercio, los siguientes gastos del mismo skip la llamada a IA. Lookup O(1) en `Map` en memoria.
- **Migración desde n8n**: la versión anterior vivía en un workflow de 30 nodos disparado desde un bot de Telegram. La reescritura colapsó ese workflow a ~6 funciones JS y eliminó el bot, el backend y el problema crónico de tokens OAuth caducados de n8n.
- **State centralizado, render puro**: cada vista expone `render()`; los handlers escriben a Sheets y llaman a `loadX() → render()`. Sin reactividad mágica.
- **Service Worker versionado**: el `CACHE_NAME` se bumpea por release; el `activate` purga cachés viejas y `skipWaiting()` activa la nueva inmediatamente sin pedirle al usuario que cierre pestañas.

---

## 📐 Arquitectura

```
js/
├── app.js              ← entry point, router, bootstrapping
├── auth.js             ← OAuth con Google Identity Services
├── config.js           ← IDs y constantes (NO versionado, ver config.example.js)
├── sheets.js           ← capa de Google Sheets API (load / append / update / delete)
├── state.js            ← estado central en memoria + queries derivadas
├── expense/
│   ├── parser.js       ← parsea texto libre → {amount, merchant, date}
│   ├── normalizer.js   ← normaliza nombres de comercios
│   └── classifier.js   ← llama a OpenAI con el prompt de clasificación
├── views/
│   ├── transactions.js ← lista de gastos del mes + edición
│   ├── budgets.js      ← presupuestos fijos y variables
│   ├── reports.js      ← métricas y top comercios
│   ├── charts.js       ← gráficos + sección de deudas
│   ├── debts.js        ← "me deben dinero" (CRUD)
│   ├── addExpense.js   ← formulario de nuevo gasto con flujo IA
│   └── settings.js     ← gestión de API key de OpenAI
└── utils/
    ├── dom.js          ← helpers de creación de elementos, modal, toast
    ├── formatters.js   ← formateo de moneda y fechas
    └── colors.js       ← color determinista por categoría
```

---

## 🔧 Cómo configurar una copia propia

### 1. Crear la hoja de Google Sheets

Crea un Sheet con estas pestañas (los nombres deben coincidir exactamente):

| Pestaña | Columnas |
|---------|----------|
| `TRANSACTIONS` | `tx_id, ts_ingest, month, date, amount, currency, merchant_raw, merchant_norm, merchant_base, description, budget_key, type, confidence, merchant_map_source, telegram_message_id` |
| `BUDGET_KEYS` | `budget_key, type, monthly_budget, fixed_amount, due_day, active` |
| `MERCHANT_MAP` | `merchant_norm, budget_key, type, first_seen, last_seen, confidence_last, source` |
| `BUDGET_HISTORY` | `month, budget_key, type, monthly_budget, fixed_amount, due_day, spent, snapshot_ts` |
| `DEBTS` | `id, person, amount, reason, date_created, status, date_paid, notes` |

> Recomendación: formatea las columnas de fecha como **Texto plano** para evitar conversiones automáticas dependientes del locale.

### 2. Crear credenciales OAuth en Google Cloud

1. [console.cloud.google.com](https://console.cloud.google.com) → crea proyecto.
2. **APIs y servicios** → habilita "Google Sheets API".
3. **Credenciales** → crea un **OAuth Client ID** de tipo "Web application".
4. En **Authorized JavaScript origins** añade los dominios donde correrás la app (ej. `https://tu-app.web.app`, `http://127.0.0.1:5500` para Live Server).
5. Copia el **Client ID** generado.

### 3. Configurar el repo

```bash
cp js/config.example.js js/config.js
```

Edita `js/config.js` con tu `SPREADSHEET_ID` (del URL de la hoja) y tu `OAUTH_CLIENT_ID`.

> `js/config.js` está en `.gitignore` y nunca se subirá al repo.

### 4. Desplegar en Firebase Hosting

```bash
npm install -g firebase-tools  # si no lo tienes
firebase login
firebase use --add             # selecciona tu proyecto
firebase deploy
```

### 5. Configurar la API key de OpenAI (opcional)

La key se introduce desde la pantalla de **Ajustes** dentro de la app y se almacena en `localStorage`. Sin ella, los gastos en comercios desconocidos no se podrán clasificar automáticamente.

---

## 🧪 Desarrollo local

Cualquier servidor estático sirve. Yo uso la extensión **Live Server** de VS Code (botón "Go Live"). La app local correrá en `http://127.0.0.1:5500` — recuerda añadir ese origen en Google Cloud Console.

---

## 📱 Instalar como PWA

| Plataforma | Cómo |
|------------|------|
| **iOS / Safari** | Botón compartir → "Añadir a pantalla de inicio" |
| **Android / Chrome** | Menú ⋮ → "Añadir a pantalla de inicio" |
| **Desktop / Chrome** | Icono ⊕ en la barra de URL |

---

## 🔐 Modelo de seguridad

- Los datos viven en **tu** Sheet, protegido por Google OAuth. La app solo accede con el token del usuario que ha hecho login.
- La API key de OpenAI vive en **tu** `localStorage`. El riesgo realista es acceso físico al dispositivo desbloqueado. Como red de seguridad, conviene poner un **límite de gasto** en el dashboard de OpenAI.
- El `OAUTH_CLIENT_ID` es público por diseño; la protección real son los **Authorized JavaScript origins** configurados en Google Cloud.

---

## 📄 Licencia

MIT — siéntete libre de clonar, modificar y aprender de él.
