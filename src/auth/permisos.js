/* =============================================================================
   ¿Quién puede ver la analítica?

   La MISMA regla que aplica el front en `RutaProtegida.jsx` para abrir la
   pantalla. Si el backend dejara pasar menos, el tablero se abriría y daría 403;
   si dejara pasar más, la pantalla protegida sería decoración.

   GEMELOS — si cambia uno, cambia el otro:
     - `cubre()`            ↔ Pagina-web_React/src/config/autorizacionRutas.js
     - `ROLES_ADMIN`        ↔ Pagina-web_React/src/power_bi/analyticsModules.js
     - el orden de rutas    ↔ Pagina-web_React/src/pages/admin/Login.jsx

   Pasa quien cumpla una de estas, en este orden:
     1. Rol `admin` o `super_admin` (solo para rutas de módulos analíticos, que
        son las únicas que este backend protege).
     2. Una ruta asignada que cubra la del módulo. Las rutas asignadas son
        `profiles.personal_routes` y, SOLO si están vacías, las del rol en
        `role_permissions.permissions`: las personales PISAN las del rol.
     3. La ruta es el `redirect` de su rol (la pantalla de inicio del usuario).
   ============================================================================= */

export const ROLES_ADMIN = ["admin", "super_admin"];

export const MODOS_AUTH = ["off", "report", "enforce"];

/** Compara por SEGMENTO: `/power-bi` cubre `/power-bi/x`, no `/power-bix`. Sensible a mayúsculas. */
export const cubre = (permiso, actual) =>
  actual === permiso || actual.startsWith(permiso + "/");

/**
 * Modo de `ANALITICA_AUTH`. Sin valor = `report` (nada se bloquea, pero queda
 * en el log quién llega sin token). Un valor desconocido = `enforce`: un typo en
 * una variable de seguridad tiene que cerrar, no abrir.
 */
export function modoAuth(valor) {
  const modo = String(valor ?? "").trim().toLowerCase();
  if (!modo) return "report";
  return MODOS_AUTH.includes(modo) ? modo : "enforce";
}

/** Token del header `Authorization: Bearer <token>`. Estricto: cualquier otra forma es null. */
export function tokenDelHeader(header) {
  if (typeof header !== "string") return null;
  const m = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/** Las rutas guardadas en Supabase son objetos `{ path }`; se aceptan también strings. */
export function pathsDe(rutas) {
  if (!Array.isArray(rutas)) return [];
  return rutas
    .map((ruta) => (typeof ruta === "string" ? ruta : ruta?.path))
    .filter((path) => typeof path === "string" && path);
}

export const esAdmin = (role) => ROLES_ADMIN.includes(String(role || "").toLowerCase());

/**
 * @param {{ role?: string, rutasPersonales?: unknown[], rutasRol?: unknown[], redirect?: string|null }} acceso
 * @param {string} ruta Ruta del módulo en el front (p. ej. `/power-bi`).
 */
export function puedeVer(acceso, ruta) {
  if (!acceso) return false;
  if (esAdmin(acceso.role)) return true;

  const personales = pathsDe(acceso.rutasPersonales);
  const asignadas = personales.length ? personales : pathsDe(acceso.rutasRol);
  if (asignadas.some((path) => cubre(path, ruta))) return true;

  return acceso.redirect === ruta;
}

/** Vencimiento (ms) declarado en el JWT, sin verificarlo. Solo sirve para no cachear de más. */
export function vencimientoDelToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
