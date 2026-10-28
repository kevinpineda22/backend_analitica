/* Rutas de Analítica de Cajas, montadas en /api/analitica-cajas. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import { consultarFiltros, consultarHistorico } from "./consultas.js";
import { leerBodega, motivoRangoInvalido } from "./reglas.js";
import { cuerpoHistorico } from "./respuesta.js";

export function rutasCajas(pool) {
  const router = express.Router();

  router.get("/filtros", async (_request, response) => {
    try {
      const datos = await consultarFiltros(pool);
      if (!datos?.periodo?.desde) {
        return response.status(404).json({ ok: false, error: "No hay ventas de cajas para analizar." });
      }
      return response.json({ ok: true, data: datos });
    } catch (error) {
      return respuestaError(response, error, "No fue posible cargar los filtros de cajas.");
    }
  });

  router.get("/historico", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const motivo = motivoRangoInvalido(periodo);
    if (motivo) return response.status(400).json({ ok: false, error: motivo });
    const bodega = leerBodega(request.query.bodega);

    try {
      const fila = await consultarHistorico(pool, { ...periodo, bodega });
      return response.json({ ok: true, data: { periodo, bodega, ...cuerpoHistorico(fila) } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar el historico de cajas.");
    }
  });

  return router;
}
