/* Rutas del análisis por ítem, montadas en /api/analitica-items. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import { consultarEvolucionItems, consultarListaItems, periodoAnterior } from "./consultas.js";
import { conLineaPorItem, granularidadDe, leerFiltros } from "./reglas.js";
import { cuerpoEvolucion, cuerpoLista } from "./respuesta.js";

export function rutasItems(pool) {
  const router = express.Router();

  /* La lista completa del período y la sede. Los filtros por grupo, marca o
     ítem los aplica la pantalla sobre estas filas: cambiar de grupo es
     instantáneo y no vuelve a la base. */
  router.get("/lista", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const { tienda } = leerFiltros(request.query);
    const anterior = request.query.anterior === "1" ? periodoAnterior(periodo) : null;

    try {
      const filas = await consultarListaItems(pool, { ...periodo, tienda, anterior });
      return response.json({ ok: true, data: cuerpoLista({ periodo, anterior, filas }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar la lista de items.");
    }
  });

  router.get("/evolucion", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const filtros = leerFiltros(request.query);
    const granularidad = granularidadDe(periodo);

    try {
      const filas = await consultarEvolucionItems(pool, {
        ...periodo, filtros, granularidad, lineaPorItem: conLineaPorItem(filtros.items),
      });
      return response.json({ ok: true, data: cuerpoEvolucion({ periodo, granularidad, filas }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar la evolucion de los items.");
    }
  });

  return router;
}
