# Registro Básico de Datos (RBD) — V2

Sistema de captura de **simpatizantes** y **actores territoriales** para la campaña Pedro Canales — Tulancingo de Bravo.

**Stack:** HTML + CSS + JavaScript puro · Google Apps Script (Web App) · Google Sheets como BD.

> **V2 (2026-09-10):** migración a Sheet nuevo en cuenta limpia + reporte de observaciones V1:
> roles reales (admin/líder), ficha simple de simpatizante con consentimiento, duplicados por
> teléfono, papelera (soft-delete), historial de cambios, gestión de usuarios desde la app,
> aviso de privacidad y exportar CSV. El demo V1 queda retirado.

---

## Estructura

```
PedroCanalesRBD/
├── index.html              ← Login
├── app.html                ← SPA (consulta / captura / ficha / admin)
├── aviso-privacidad.html   ← Aviso de privacidad (gate en la app + link en login)
├── css/styles.css          ← Sistema de diseño
├── js/
│   ├── config.js           ← URL del Web App Apps Script (actualizar tras deploy)
│   ├── auth.js             ← Login + sesión localStorage
│   ├── api.js              ← Capa de llamadas al backend (todo por POST)
│   └── ui.js               ← Helpers (toasts, badges, loading)
├── assets/                 ← Iconos SVG inline (sin CDN)
├── codigo.gs               ← Backend Apps Script V2 (única fuente)
├── semilla_v2.gs           ← Inicializador del Sheet V2 (una sola vez)
├── seed_localidades_tulancingo.txt ← Localidades de Tulancingo (pegar en _LOCALIDADES_SEED)
├── diagnostico.gs          ← Utilidad de diagnóstico (no producción)
├── sw.js                   ← Service worker PWA (subir CACHE en cada deploy de frontend)
├── ROADMAP.txt
└── README.md               ← Este archivo
```

---

## Despliegue paso a paso (V2)

### 1. Google Sheet

Sheet en uso: `12VhHRb9yZjWGz4y_1tv5-t02Kb35quQi2lvRVvAWOG8` (cuenta limpia).
Abre el Sheet → **Extensiones → Apps Script**.

### 2. Código del backend

1. **Borra los archivos .gs que heredó la copia** (si los hay) para evitar colisiones de nombres.
2. Crea `codigo` y pega el contenido de `codigo.gs`.
3. Crea `semilla_v2` y pega el contenido de `semilla_v2.gs`.
4. **En `codigo.gs`:** reemplaza `APP_SALT` por una cadena aleatoria larga (ej. `Utilities.getUuid() + Utilities.getUuid()`).
5. **En `semilla_v2.gs`:** pon el `ADMIN_PASSWORD_V2` real (mínimo 8 caracteres).
6. Ejecuta `inicializarV2()` desde el editor y acepta los permisos.
7. Si el Sheet trae datos del demo (copia del Sheet viejo), ejecuta `limpiarDatosDemo()` una vez.
8. Ejecuta `cargarLocalidadesIntegradas()` — carga las 80 localidades de Tulancingo
   directamente desde el script (sin pegar nada en el Sheet). La vía manual
   (hoja `_LOCALIDADES_SEED` + `importarLocalidades()`) sigue disponible por si acaso.

### 3. Desplegar el Web App

1. **Implementar → Nueva implementación → Aplicación web**.
2. Ejecutar como: **Yo** · Acceso: **Cualquier persona** (el token de sesión protege los datos).
3. Copia la URL que termina en `/exec` y pégala en `js/config.js` (reemplaza `PREGUNTAR_URL_EXEC`).
4. Prueba desde el navegador: `URL?action=catalogos` → debe devolver JSON con municipios/localidades.

### 4. Frontend

- Sube el contenido a GitHub Pages (repo `PedroCanalesRBD`).
- Tras cada cambio de frontend, **sube `CACHE` en `sw.js`** (ej. `pc-shell-v3` → `v4`) y refresca dos veces.

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

## Seguridad (V2)

| Capa | Medida |
|---|---|
| Auth | SHA-256 con `APP_SALT` aleatorio (solo vive en el editor de Apps Script) |
| Roles | Validados en el servidor en TODA acción (`_exigir`/`_exigirAdmin`), no solo en UI |
| Aislamiento | Líder solo ve/edita lo suyo (`lider_usuario` / `creado_por`); obtener de otro → `No autorizado` |
| Sesión | Token UUID en `SESIONES` con rol/lider_id; TTL 24h admin / 7 días líder; bloquear usuario purga sesiones |
| Transporte | Todo por POST con token en el body (nunca en query string) |
| Login | Mensaje único "Usuario o contraseña incorrectos" (no revela existencia) |
| Consentimiento | Checkbox obligatorio validado en servidor + aviso de privacidad con gate por dispositivo |
| Auditoría | `HISTORIAL` registra crear/editar/inactivar/recuperar/bloqueos con diff de campos |
| Secrets | Hash y salt solo en Apps Script; el repo no lleva passwords reales |

---

## Roles (V2)

| Rol | Puede | No puede |
|---|---|---|
| `admin` | Todo: todos los registros, panel admin (alta/reset/bloqueo de usuarios), duplicados, papelera, exportar CSV | — |
| `lider` | Capturar/consultar/editar/inactivar SUS simpatizantes (folio propio, ficha simple) | Ver registros de otros líderes, recuperar de papelera, admin |
| `operador` | Lectura (legado, se crea solo desde el Sheet) | Escribir |

Las cuentas de líder se crean **desde la app (Admin → Líderes y usuarios)** con folio automático `L-001`, `L-002`…

---

## Modelo de datos (Sheets V2)

### SIMPATIZANTES (nueva — ficha simple)
`id | folio | nombre | telefono | telefono_norm | colonia | seccion | observaciones | consentimiento | consentimiento_medio | consentimiento_fecha | lider_usuario | lider_id | estado | duplicado_de | creado_por | fecha_creacion | actualizado_en`

- `folio`: `S-001`, `S-002`… (auto)
- `seccion`: dígitos (3-5) o `NO_CONOCE`
- `estado`: `Activo` / `Posible duplicado` / `Inactivo` (papelera)
- `duplicado_de`: folio del registro existente cuando el teléfono coincide

### HISTORIAL (nueva)
`id | entidad | entidad_id | accion | campo | valor_anterior | valor_nuevo | usuario | fecha`
- `entidad`: `SIMPATIZANTE` / `REGISTRO` / `USUARIO` / `AVISO`
- Registra crear, editar (diff por campo), inactivar, recuperar, resolver_duplicado, alta/bloqueo/cambio de password, login

### REGISTROS (ficha de líder/actor territorial — sin cambios de esquema)
`id | fecha_creacion | municipio | localidad | nombre | organizacion | perfil | tipo_vinculacion | que_aporta | prioridad | motivo_prioridad | proximo_paso | fecha_seguimiento | estatus | observaciones | creado_por | actualizado_en | problemas_identificados`

### USUARIOS (ampliada)
`id | usuario | password_hash | nombre | rol | activo | created_at | lider_id | fecha_alta`
- `lider_id`: `L-001`… (solo rol líder)

### SESIONES (ampliada)
`token | usuario | rol | nombre | lider_id | creado_en | expira_en`

### MUNICIPIOS / LOCALIDADES / CATALOGOS / SEGUIMIENTOS
Sin cambios (Tulancingo de Bravo único; CATALOGOS agrega tipo `consentimiento_medio`).

---

## API (acciones Apps Script V2)

| Acción | Auth | Rol | Descripción |
|---|---|---|---|
| `ping` / `catalogos` | no | — | públicos |
| `login` / `logout` | no/sí | — | sesión con rol + nombre + lider_id |
| `quien_soy` | sí | — | `{usuario, nombre, rol, lider_id}` |
| `crear_simpatizante` | sí | admin/lider | ficha simple; consentimiento obligatorio; duplicados → `Posible duplicado` |
| `buscar_simpatizantes` | sí | admin/lider | filtros q/colonia/seccion/lider/estados; líder solo lo suyo |
| `obtener_simpatizante` | sí | admin/lider | + historial para admin |
| `actualizar_simpatizante` | sí | admin/lider | diff → HISTORIAL |
| `cambiar_estado_sim` | sí | admin/lider | Inactivar (dueño/admin); recuperar solo admin |
| `duplicados_listar` / `duplicado_resolver` | sí | admin | bandeja y resolución (aceptar/descartar) |
| `usuarios_listar` / `usuario_crear` / `usuario_password` / `usuario_bloquear` | sí | admin | gestión de cuentas (L-XXX) |
| `cambiar_password` | sí | todos | password propia |
| `exportar` | sí | admin | CSV de simpatizantes |
| `historial` | sí | admin | auditoría filtrable |
| `borrar_datos_demo` | sí | admin | reset de datos (guarda: `confirmar:'BORRAR'`) |
| `crear` / `buscar` / `obtener` / `seguimiento` / `actualizar` | sí | admin/lider | ficha de actor territorial (REGISTROS), con scope |

Todas las respuestas son JSON: `{ ok: true, data: {...} }` o `{ ok: false, error: "...", code: "..." }`.

---

## Desarrollo local

```bash
# Servir localmente (Python)
python -m http.server 8765
# Abrir http://localhost:8765
```

Sin build, sin dependencias, sin frameworks. Edita HTML/CSS/JS y refresca el navegador.

---

## Licencia

Privado. Uso interno de la campaña Pedro Canales.