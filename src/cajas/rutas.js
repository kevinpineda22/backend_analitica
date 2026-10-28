/* Rutas de Analítica de Cajas, montadas en /api/analitica-cajas. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import { consultarContexto, consultarFiltros, consultarFranjas, consultarHistorico } from "./consultas.js";
import {
  DIAS_CAPACIDAD, MARGEN, MAX_DIAS_HISTORICO, leerBodega, motivoRangoInvalido, pronosticar, ventanasNecesarias,
} from "./reglas.js";
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
    const motivo = motivoRangoInvalido(periodo, MAX_DIAS_HISTORICO);
    if (motivo) return response.status(400).json({ ok: false, error: motivo });
    const bodega = leerBodega(request.query.bodega);

    try {
      const fila = await consultarHistorico(pool, { ...periodo, bodega });
      return response.json({ ok: true, data: { periodo, bodega, ...cuerpoHistorico(fila) } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar el historico de cajas.");
    }
  });

  /* Una sede por pedido: el programador arma los turnos sede por sede, y así
     la respuesta no pasa de ~14 días × 56 franjas. */
  router.get("/pronostico", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const motivo = motivoRangoInvalido(periodo);
    if (motivo) return response.status(400).json({ ok: false, error: motivo });
    const bodega = leerBodega(request.query.bodega);
    if (!bodega) return response.status(400).json({ ok: false, error: "Indique la sede." });

    try {
      const contexto = await consultarContexto(pool, bodega);
      if (!contexto?.ultimoDia) {
        return response.status(404).json({ ok: false, error: "La sede no tiene ventas para pronosticar." });
      }
      const capacidad = contexto.capacidad == null ? null : Number(contexto.capacidad);
      const filas = await consultarFranjas(pool, bodega, ventanasNecesarias(periodo, contexto.ultimoDia));
      return response.json({
        ok: true,
        data: {
          periodo,
          bodega,
          nombre: contexto.nombre,
          ultimoDia: contexto.ultimoDia,
          capacidad: {
            documentosPorCajeraFranja: capacidad == null ? null : Number(capacidad.toFixed(2)),
            franjasMedidas: Number(contexto.franjasCapacidad || 0),
            ventanaDias: DIAS_CAPACIDAD,
            margen: MARGEN,
          },
          dias: pronosticar(periodo, filas, { ultimoDia: contexto.ultimoDia, capacidad }),
        },
      });
    } catch (error) {
      return respuestaError(response, error, "No fue posible calcular el pronostico de cajas.");
    }
  });

  return router;
}
