# Registro Básico de Datos (RBD)

Sistema de captura, consulta y seguimiento de vinculaciones políticas/territoriales para la campaña Pedro Canales — Hidalgo.

**Stack:** HTML + CSS + JavaScript puro · Google Apps Script (Web App) · Google Sheets como BD.

> Antes llamado **MVT (Mapa de Vinculación Territorial)**. Renombrado a RBD para reflejar alcance operativo.

---

## Estructura

```
Electoralangeles/
├── index.html              ← Login
├── app.html                ← SPA principal (consulta / captura / ficha)
├── css/styles.css          ← Sistema de diseño
├── js/
│   ├── config.js           ← URL del Web App Apps Script
│   ├── auth.js             ← Login + sesión localStorage
│   ├── api.js              ← Capa de llamadas al backend
│   └── ui.js               ← Helpers (toasts, badges, loading)
├── assets/                 ← Iconos SVG inline (sin CDN)
├── codigo.txt              ← Backend Apps Script (copiar a apps script)
├── semilla.txt             ← Script de inicialización del Sheet (una sola vez)
├── diagnostico.gs          ← Utilidad de diagnóstico (no producción)
├── .gitignore
├── ROADMAP.txt             ← Hoja de ruta del proyecto
└── README.md               ← Este archivo
```

---

## Despliegue paso a paso

### 1. Crear el Google Sheet

1. Ve a [sheets.new](https://sheets.new) y crea un libro nuevo.
2. Nómbralo como desees (sugerido: `RBD DB`).
3. Copia el **ID** del Sheet de la URL:
   `https://docs.google.com/spreadsheets/d/<ESTE_ID>/edit`

### 2. Inicializar las hojas (una sola vez)

1. En el Sheet, abre **Extensiones → Apps Script**.
2. Crea un archivo nuevo llamado `seed` y pega el contenido de `semilla.txt`.
3. **Importante:** edita las constantes `ADMIN_USERNAME` y `ADMIN_PASSWORD` (líneas 11-12) antes de ejecutar. **No uses las credenciales por defecto en producción.**
4. Ejecuta la función `inicializar()` desde el editor.
5. Acepta los permisos cuando los pida.
6. El script crea 6 hojas: `REGISTROS`, `MUNICIPIOS`, `LOCALIDADES`, `USUARIOS`, `CATALOGOS`, `SEGUIMIENTOS`.
7. Para importar las ~4700 localidades de Hidalgo, crea una hoja temporal `_LOCALIDADES_SEED` con 3 columnas (NOM_MUN, LOC, NOM_LOC), pega los datos y ejecuta `importarLocalidades()`.

### 3. Desplegar el backend

1. En el mismo Apps Script, crea un archivo nuevo llamado `codigo`.
2. Pega el contenido de `codigo.txt`.
3. **Edita la constante `SHEET_ID`** (línea 8) con el ID del Sheet del paso 1.
4. (Opcional) Cambia `SESION_TTL_MIN` para ajustar la duración de la sesión. Por defecto: 7 días.
5. Haz clic en **Implementar → Nueva implementación**.
6. Tipo: **Aplicación web**.
7. Configurar como:
   - Ejecutar como: **Yo** (tu cuenta)
   - Quién tiene acceso: **Cualquier persona** (para que el frontend público pueda llamar)
8. Copia la **URL de la aplicación web** que termina en `/exec`.

### 4. Configurar el frontend

1. Abre `js/config.js` y reemplaza el valor de `API_URL` con la URL del paso 3.
2. Guarda.

### 5. Publicar el frontend

Opciones:

#### Opción A: GitHub Pages (recomendado)
1. Sube el contenido de `Electoralangeles/` a un repositorio en GitHub.
2. En el repo, ve a **Settings → Pages**.
3. Source: **Deploy from a branch**, Branch: **main**, Folder: **/(root)**.
4. Espera ~1 min. Tu app estará en `https://<usuario>.github.io/<repo>/`.

#### Opción B: Servidor propio
Sube los archivos a cualquier hosting estático (Netlify, Vercel, S3, etc.).

#### Opción C: Local (solo pruebas)
Abre `index.html` directamente en el navegador. **Nota:** Apps Script puede rechazar requests desde `file://` por CORS. Usa un servidor local:
```bash
python -m http.server 8765
# y abre http://localhost:8765
```

---

## Seguridad

| Capa | Medida |
|---|---|
| Auth | SHA-256 con salt (`MVT_HGO_2026`) — no texto plano en Sheet |
| Sesión | Token UUID en hoja `SESIONES`, expira en 7 días |
| Token | Frontend valida formato y expiración local antes de cada llamada |
| Backend | Valida token en TODA llamada excepto `login`. Sin token válido → 401 |
| Frontend | `localStorage` limpia sesión expirada. Logout limpia backend + local |
| Secrets | Hash y salt viven solo en Apps Script. Frontend no tiene credenciales |

**Antes de producción:**
- Cambia `ADMIN_PASSWORD` en `semilla.txt` y vuelve a correr `inicializar()` (o actualiza directo en Sheet).
- Cambia el salt `'MVT_HGO_2026'` por uno propio en `codigo.txt` y `semilla.txt`.
- Limita "Quién tiene acceso" del Web App si quieres reducir superficie.

---

## Modelo de datos (Sheets)

### REGISTROS
| Columna | Tipo | Notas |
|---|---|---|
| id | number | autogenerado |
| fecha_creacion | date | server-side |
| municipio | string | requerido |
| localidad | string | opcional |
| nombre | string | requerido |
| organizacion | string | opcional |
| perfil | string | del catálogo |
| tipo_vinculacion | string | del catálogo |
| que_aporta | text | |
| prioridad | enum | Alta / Media / Baja |
| motivo_prioridad | text | |
| proximo_paso | text | |
| fecha_seguimiento | date | |
| estatus | enum | Por contactar / En seguimiento / Contactado / Compromiso adquirido / Cerrado |
| observaciones | text | |
| creado_por | string | usuario |
| actualizado_en | date | server-side |

### MUNICIPIOS
`id | nombre | clave` — solo Tulancingo de Bravo.

### LOCALIDADES
`id | municipio_id | nombre | clave` — localidades de Tulancingo de Bravo.

### USUARIOS
`id | usuario | password_hash | nombre | rol | activo | created_at`
- `rol`: `admin` (puede editar) o `operador` (solo lectura).

### CATALOGOS
`tipo | valor | orden` — agrupa: `perfil`, `tipo_vinculacion`, `prioridad`, `estatus`, `sector`.

### SEGUIMIENTOS
`id | registro_id | fecha | estatus_anterior | estatus_nuevo | proximo_paso | observaciones | usuario`

### SESIONES (auto)
`token | usuario | creado_en | expira_en` — generada por el backend en cada login.

---

## API (acciones Apps Script)

| Acción | Método | Auth | Descripción |
|---|---|---|---|
| `login` | GET | no | devuelve token + rol + nombre |
| `catalogos` | GET | sí | municipios, localidades, catálogos |
| `crear` | POST | sí | crea un registro |
| `buscar` | GET | sí | filtros: q, municipio, localidad, perfil, prioridad, estatus, limit, offset |
| `obtener` | GET | sí | un registro + sus seguimientos |
| `seguimiento` | POST | sí | agrega seguimiento y actualiza estatus del registro |
| `actualizar` | POST | sí | edita campos del registro |
| `quien_soy` | GET | sí | devuelve `{usuario, nombre, rol}` del usuario logueado |
| `logout` | GET | sí | elimina sesión del backend |

Todas las respuestas son JSON: `{ ok: true, data: {...} }` o `{ ok: false, error: "...", code: "..." }`.

---

## Desarrollo local

```bash
# Clonar
git clone <repo>
cd Electoralangeles

# Servir localmente (Python)
python -m http.server 8765
# Abrir http://localhost:8765
```

Sin build, sin dependencias, sin frameworks. Edita HTML/CSS/JS y refresca el navegador.

---

## Licencia

Privado. Uso interno de la campaña Pedro Canales.