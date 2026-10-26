const ORIGENES_POR_DEFECTO = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://merkahorro.com",
  "https://www.merkahorro.com",
];

/** Lista de orígenes desde `POWER_BI_ALLOWED_ORIGINS` (separada por comas). */
export function origenesPermitidos(valor) {
  return (valor || ORIGENES_POR_DEFECTO.join(","))
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * ¿El origen está en la lista? Acepta `*` y comodines de subdominio (`*.vercel.app`).
 *
 * Sin origen pasa: curl, Postman y llamadas servidor a servidor no lo mandan.
 * CORS no es control de acceso — solo frena navegadores. El acceso lo decide la
 * autenticación (`src/auth/`).
 */
export function originPermitido(origin, permitidos) {
  if (!origin) return true;
  const normalizedOrigin = origin.replace(/\/$/, "");
  return permitidos.some((allowedOrigin) => {
    if (allowedOrigin === "*") return true;
    if (!allowedOrigin.startsWith("*.")) return normalizedOrigin === allowedOrigin;
    const hostname = new URL(normalizedOrigin).hostname;
    const suffix = allowedOrigin.slice(1);
    return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
  });
}
