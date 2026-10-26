/* =============================================================================
   Middleware de acceso a la analítica

   `ANALITICA_AUTH` decide qué pasa con quien no puede ver el módulo:

     off      — nadie mira nada (solo para emergencias).
     report   — pasa todo, pero se registra quién habría sido rechazado.
                Es el modo de la transición: se despliega el front que manda el
                token, se mira el log unos días, y recién ahí se pasa a enforce.
     enforce  — 401 sin token o con token inválido, 403 sin permiso, 503 si
                Supabase no contesta (cerrar ante la duda: son ventas y márgenes).

   En `report` un fallo de Supabase NO frena: el modo existe para no romper nada.
   ============================================================================= */

import { ErrorAuth } from "./supabaseAuth.js";
import { modoAuth, puedeVer, tokenDelHeader } from "./permisos.js";

const RECHAZOS = {
  sin_token: { status: 401, error: "Inicie sesion para consultar la analitica." },
  token_invalido: { status: 401, error: "Su sesion vencio. Inicie sesion de nuevo." },
  perfil_no_encontrado: { status: 403, error: "Su usuario no tiene un perfil asignado." },
  sin_permiso: { status: 403, error: "Su usuario no tiene acceso a este modulo." },
  no_disponible: { status: 503, error: "No fue posible validar su sesion. Intente de nuevo." },
};

/**
 * @param {string} rutaModulo Ruta del módulo en el front que habilita esta API.
 * @param {{ modo?: string, resolverAcceso: (token: string) => Promise<object>, log?: (msg: string) => void }} deps
 */
export function requiereModulo(rutaModulo, { modo, resolverAcceso, log = console.warn }) {
  const modoEfectivo = modoAuth(modo);

  return async function autorizar(request, response, next) {
    if (modoEfectivo === "off") return next();

    const rechazar = (motivo, detalle = "") => {
      const quien = request.usuario?.email || "anonimo";
      log(`[auth:${modoEfectivo}] ${motivo} ${request.method} ${request.originalUrl} usuario=${quien}${detalle ? ` (${detalle})` : ""}`);
      if (modoEfectivo === "report") return next();
      const { status, error } = RECHAZOS[motivo];
      return response.status(status).json({ ok: false, error });
    };

    const token = tokenDelHeader(request.headers.authorization);
    if (!token) return rechazar("sin_token");

    let acceso;
    try {
      acceso = await resolverAcceso(token);
    } catch (error) {
      const motivo = error instanceof ErrorAuth ? error.motivo : "no_disponible";
      return rechazar(motivo, error.message);
    }

    request.usuario = acceso;
    if (!puedeVer(acceso, rutaModulo)) return rechazar("sin_permiso", `ruta=${rutaModulo}`);
    return next();
  };
}
