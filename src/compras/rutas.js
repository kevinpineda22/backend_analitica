/* Rutas de Analítica de Compras, montadas en /api/analitica-compras. */

import express from "express";
import { periodoAnterior } from "../comercial/reglas.js";
import { respuestaError, validarPeriodo } from "../http.js";
import { consultarFiltros, consultarPeriodo } from "./consultas.js";
import { anteriorCompleto, fuentes, leerFiltros } from "./reglas.js";
import { cuerpoPeriodo } from "./respuesta.js";

export function rutasCompras(pool) {
  const router = express.Router();

  router.get("/filtros", async (_request, response) => {
    try {
      const datos = await consultarFiltros(pool);
      if (!datos.periodo?.desde) {
        return response.status(404).json({ ok: false, error: "No hay compras para analizar." });
      }
      return response.json({ ok: true, data: datos });
    } catch (error) {
      return respuestaError(response, error, "No fue posible cargar los filtros de compras.");
    }
  });

  router.get("/resumen", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const filtros = leerFiltros(request.query);
    const fuente = fuentes(filtros);

    try {
      const anterior = periodoAnterior(periodo);
      const filaActual = await consultarPeriodo(pool, { periodo, filtros, fuente, conRankings: true });
      const filaAnterior = await consultarPeriodo(pool, { periodo: anterior, filtros, fuente, conRankings: false });
      return response.json({
        ok: true,
        data: {
          periodo,
          periodoAnterior: anterior,
          // Los datos arrancan en 2025: antes de eso el "año anterior" daría
          // cero y se leería como un crecimiento enorme.
          anteriorCompleto: anteriorCompleto(anterior, filaActual.coberturaDesde),
          filtros,
          actual: cuerpoPeriodo(filaActual, { conRankings: true }),
          anterior: cuerpoPeriodo(filaAnterior, { conRankings: false }),
        },
      });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar las compras.");
    }
  });

  return router;
}
