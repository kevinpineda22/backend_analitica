/* =============================================================================
   Quién es el dueño de un token, según Supabase

   Se habla con la API REST de Supabase con `fetch`, con la anon key y el token
   DEL USUARIO. No hace falta la service key: el perfil se lee con los mismos
   permisos (RLS) con que lo lee el front al iniciar sesión, y esta API no
   puede ver nada que el propio usuario no pueda ver.

   `GET /auth/v1/user` es la verificación: Supabase valida firma y vencimiento.
   No se decodifica el JWT con un secreto local, así que sirve igual con las
   claves de firma nuevas (asimétricas) que con el secreto viejo.

   Una respuesta por token se guarda hasta 60 s (o hasta que el token venza, lo
   que llegue antes): un tablero dispara varias llamadas al abrir, y no tiene
   sentido preguntarle a Supabase cuatro veces lo mismo.
   ============================================================================= */

import { vencimientoDelToken } from "./permisos.js";

export class ErrorAuth extends Error {
  /** @param {"token_invalido"|"perfil_no_encontrado"|"no_disponible"} motivo */
  constructor(motivo, mensaje) {
    super(mensaje);
    this.motivo = motivo;
  }
}

const TTL_MS = 60_000;
const MAX_ENTRADAS = 500;

export function crearResolverAcceso({
  url,
  anonKey,
  fetchImpl = globalThis.fetch,
  ahora = Date.now,
} = {}) {
  const cache = new Map();
  const base = String(url || "").replace(/\/$/, "");

  async function pedir(ruta, token) {
    let respuesta;
    try {
      respuesta = await fetchImpl(`${base}${ruta}`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new ErrorAuth("no_disponible", `Supabase no respondio: ${error.message}`);
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ErrorAuth("token_invalido", "El token no es valido o vencio.");
    }
    if (!respuesta.ok) {
      throw new ErrorAuth("no_disponible", `Supabase respondio ${respuesta.status} en ${ruta.split("?")[0]}.`);
    }
    return respuesta.json();
  }

  async function resolver(token) {
    const usuario = await pedir("/auth/v1/user", token);
    if (!usuario?.id) throw new ErrorAuth("token_invalido", "El token no tiene usuario.");

    const perfiles = await pedir(
      `/rest/v1/profiles?select=role,personal_routes&user_id=eq.${encodeURIComponent(usuario.id)}`,
      token,
    );
    const perfil = perfiles?.[0];
    if (!perfil) throw new ErrorAuth("perfil_no_encontrado", "El usuario no tiene perfil.");

    let rol = null;
    if (perfil.role) {
      const filas = await pedir(
        `/rest/v1/role_permissions?select=permissions,redirect&role=eq.${encodeURIComponent(perfil.role)}`,
        token,
      );
      rol = filas?.[0] || null;
    }

    return {
      userId: usuario.id,
      email: usuario.email || null,
      role: perfil.role || null,
      rutasPersonales: perfil.personal_routes || [],
      rutasRol: rol?.permissions || [],
      redirect: rol?.redirect || null,
    };
  }

  return async function resolverAcceso(token) {
    if (!base || !anonKey) {
      throw new ErrorAuth("no_disponible", "Faltan SUPABASE_URL o SUPABASE_ANON_KEY.");
    }

    const momento = ahora();
    const guardado = cache.get(token);
    if (guardado && guardado.expira > momento) return guardado.acceso;

    const acceso = await resolver(token);
    const vence = vencimientoDelToken(token);
    const expira = Math.min(momento + TTL_MS, vence ?? Infinity);
    if (cache.size >= MAX_ENTRADAS) cache.delete(cache.keys().next().value);
    cache.set(token, { acceso, expira });
    return acceso;
  };
}
