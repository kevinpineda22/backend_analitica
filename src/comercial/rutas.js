/* Rutas de Ventas Comerciales y Mayoristas, montadas en /api/analitica-comercial. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import { consultarFiltros, consultarIntegracionPos, consultarPeriodo } from "./consultas.js";
import {
  dimensionesPos, leerBodega, leerCanal, leerCanales, motivoExclusionPos, periodoAnterior,
} from "./reglas.js";
import { cuerpoIntegracion, cuerpoPeriodo } from "./respuesta.js";

const canalInvalido = (response) =>
  response.status(400).json({ ok: false, error: "El canal debe ser CFE o VMF." });

export function rutasComercial(pool) {
  const router = express.Router();

  router.get("/filtros", async (request, response) => {
    const canal = leerCanal(request.query.canal);
    if (!canal) return canalInvalido(response);

    try {
      const { periodo, bodegas } = await consultarFiltros(pool, canal);
      if (!periodo?.desde) {
        return response.status(404).json({ ok: false, error: "No hay ventas de este canal para analizar." });
      }
      return response.json({ ok: true, data: { canal, periodo, bodegas } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible cargar los filtros comerciales.");
    }
  });

  router.get("/resumen", async (request, response) => {
    const canal = leerCanal(request.query.canal);
    if (!canal) return canalInvalido(response);
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const bodega = leerBodega(request.query.bodega);

    try {
      const anterior = periodoAnterior(periodo);
      const [filaActual, filaAnterior] = await Promise.all([
        consultarPeriodo(pool, { canal, ...periodo, bodega, conRankings: true }),
        consultarPeriodo(pool, { canal, ...anterior, bodega, conRankings: false }),
      ]);
      return response.json({
        ok: true,
        data: {
          canal,
          bodega,
          periodo,
          periodoAnterior: anterior,
          actual: cuerpoPeriodo(filaActual, { conRankings: true }),
          anterior: cuerpoPeriodo(filaAnterior, { conRankings: false }),
        },
      });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar las ventas comerciales.");
    }
  });

  router.get("/integracion-pos", async (request, response) => {
    const canales = leerCanales(request.query.canales);
    if (!canales) {
      return response.status(400).json({ ok: false, error: "Indique los canales a sumar: CFE, VMF o CFE,VMF." });
    }
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;

    const motivo = motivoExclusionPos(request.query);
    if (motivo) return response.json({ ok: true, data: { canales, excluida: true, motivo } });

    try {
      const filas = await consultarIntegracionPos(pool, {
        canales, ...periodo, dimensiones: dimensionesPos(request.query),
      });
      return response.json({ ok: true, data: cuerpoIntegracion(canales, filas) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible sumar las ventas comerciales.");
    }
  });

  return router;
}
