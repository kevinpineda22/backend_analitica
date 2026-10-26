/* =============================================================================
   API de analítica — punto de entrada

   Vercel detecta este archivo como la app Express (exporta `default`). No crear
   `index.js`, `server.js` ni `app.js` dentro de `src/`: Vercel podría tomar uno
   de esos como entrada en lugar de este.

   Los datos salen de las tablas `merkahorro_siesa.ventas_pdv_resumen_*`, que
   refresca el workflow `postgrest_post.yml` del repo Pagina-web_React.
   ============================================================================= */

import "dotenv/config";
import process from "node:process";
import cors from "cors";
import express from "express";
import { requiereModulo } from "./src/auth/middleware.js";
import { modoAuth } from "./src/auth/permisos.js";
import { crearResolverAcceso } from "./src/auth/supabaseAuth.js";
import { origenesPermitidos, originPermitido } from "./src/config/cors.js";
import { pool, postgresConfigurado } from "./src/config/db.js";
import { respuestaError } from "./src/http.js";
import { rutasPos } from "./src/pos/rutas.js";

const allowedOrigins = origenesPermitidos(process.env.POWER_BI_ALLOWED_ORIGINS);
const modo = modoAuth(process.env.ANALITICA_AUTH);
const resolverAcceso = crearResolverAcceso({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
});

console.log(`[auth] ANALITICA_AUTH=${modo}`);

export const app = express();

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    try {
      callback(null, originPermitido(origin, allowedOrigins));
    } catch {
      callback(null, false);
    }
  },
}));
app.use(express.json({ limit: "32kb" }));

/* `private`, NUNCA `public`: con datos detrás de un token, una respuesta
   guardada en el CDN de Vercel se le serviría a cualquiera sin pasar por el
   middleware de acceso. */
app.use("/api/analitica", (_request, response, next) => {
  response.set("Cache-Control", "private, max-age=60");
  next();
});

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    servicio: "API de analitica",
    configuracion: {
      postgres: postgresConfigurado,
      cors: allowedOrigins.length > 0,
    },
  });
});

app.get(["/api", "/api/salud"], async (_request, response) => {
  try {
    const result = await pool.query("SELECT NOW() AS ahora");
    response.json({
      ok: true,
      data: {
        servicio: "API de analitica",
        ahora: result.rows[0].ahora,
      },
    });
  } catch (error) {
    respuestaError(response, error, "PostgreSQL no esta disponible.");
  }
});

app.use(
  "/api/analitica",
  requiereModulo("/power-bi", { modo, resolverAcceso }),
  rutasPos(pool),
);

app.use((_request, response) => {
  response.status(404).json({ ok: false, error: "Ruta no encontrada." });
});

export default app;
