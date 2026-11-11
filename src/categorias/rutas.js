/* Rutas del análisis por categoría (árbol de ventas), montadas en /api/analitica-categorias. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import { periodoAnterior } from "../items/consultas.js";
import { leerTienda } from "../diarias/reglas.js";
import { tramosMensuales } from "../pos/tramos.js";
import { consultarCoberturaMensual, consultarPorValor, consultarTotales } from "./consultas.js";
import {
  consultarCombinaciones, consultarCoberturaPares, cuerpoCombinaciones, leerDimensionPar, mesesAnteriores, mesesCompletos,
} from "./pares.js";
import { leerDimension, tramoCubierto } from "./reglas.js";
import { cuerpoCategorias } from "./respuesta.js";

const EN_PREPARACION = "Los datos por categoria todavia se estan preparando. Intente mas tarde.";

export function rutasCategorias(pool) {
  const router = express.Router();

  /* Todas las categorías de una dimensión con sus tickets, y los totales de la
     sede como base de la penetración. El árbol de una categoría lo arma la
     pantalla con estas filas. */
  router.get("/lista", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const dimension = leerDimension(request.query.dimension || "grupo");
    if (!dimension) return response.status(400).json({ ok: false, error: "Dimension no valida." });
    const tienda = leerTienda(request.query.tienda);
    const anterior = request.query.anterior === "1" ? periodoAnterior(periodo) : null;

    try {
      const cobertura = await consultarCoberturaMensual(pool);
      const cubierto = [periodo, anterior].filter(Boolean)
        .every((rango) => tramoCubierto(tramosMensuales(rango.desde, rango.hasta), cobertura));
      if (!cubierto) return response.status(503).json({ ok: false, error: EN_PREPARACION });

      const filas = await consultarPorValor(pool, { periodo, anterior, tienda, dimension });
      const totales = await consultarTotales(pool, { periodo, anterior, tienda });
      return response.json({ ok: true, data: cuerpoCategorias({ periodo, anterior, dimension, totales, filas }) });
    } catch (error) {
      // 42P01: el agregado todavía no se instaló (orden de despliegue).
      if (error?.code === "42P01") return response.status(503).json({ ok: false, error: EN_PREPARACION });
      return respuestaError(response, error, "No fue posible consultar las categorias.");
    }
  });

  /* Combinaciones: pares de valores comprados en el mismo ticket. Solo meses
     completos (el agregado no tiene días). */
  router.get("/pares", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    const dimension = leerDimensionPar(request.query.dimension || "grupo");
    if (!dimension) return response.status(400).json({ ok: false, error: "Dimension no valida para combinaciones." });
    const tramo = mesesCompletos(periodo);
    if (!tramo) return response.status(400).json({ ok: false, error: "Las combinaciones se consultan por meses completos." });
    const tienda = leerTienda(request.query.tienda);
    const previo = request.query.anterior === "1" ? mesesAnteriores(tramo) : null;

    try {
      const cobertura = await consultarCoberturaPares(pool);
      const cubierto = [tramo, previo].filter(Boolean).every((meses) => tramoCubierto(meses, cobertura));
      if (!cubierto) return response.status(503).json({ ok: false, error: EN_PREPARACION });

      const { pares, valores } = await consultarCombinaciones(pool, { tramo, tramoAnterior: previo, tienda, dimension });
      const totales = await consultarTotales(pool, { periodo, anterior: previo?.periodo ?? null, tienda });
      return response.json({
        ok: true,
        data: cuerpoCombinaciones({ periodo, anterior: previo?.periodo ?? null, dimension, totales, pares, valores }),
      });
    } catch (error) {
      if (error?.code === "42P01") return response.status(503).json({ ok: false, error: EN_PREPARACION });
      return respuestaError(response, error, "No fue posible consultar las combinaciones.");
    }
  });

  return router;
}
