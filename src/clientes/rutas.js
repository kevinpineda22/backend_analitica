/* Rutas de la segmentación de clientes, montadas en /api/analitica-clientes. */

import express from "express";
import { respuestaError } from "../http.js";
import { leerTienda } from "../diarias/reglas.js";
import { consultarClientes, consultarCobertura } from "./consultas.js";
import { cuerpoSegmentos } from "./respuesta.js";
import { correrMes, leerMes, mesesDisponibles, ultimoMesCerrado, ventanaAnual } from "./segmentos.js";

const EN_PREPARACION = "Los datos por cliente todavia se estan preparando. Intente mas tarde.";

export function rutasClientes(pool) {
  const router = express.Router();

  /* Los clientes identificados de los 12 meses que terminan en `mes` (por
     defecto, el último cerrado), con su segmento y el de 12 meses antes. */
  router.get("/segmentos", async (request, response) => {
    const pedido = request.query.mes;
    if (pedido && !leerMes(pedido)) return response.status(400).json({ ok: false, error: "El mes no es valido." });
    const tienda = leerTienda(request.query.tienda);

    try {
      const cobertura = await consultarCobertura(pool);
      if (!cobertura?.desde || !cobertura?.ultimo_dia) return response.status(503).json({ ok: false, error: EN_PREPARACION });
      const disponibles = mesesDisponibles(cobertura, ultimoMesCerrado(cobertura.ultimo_dia));
      if (!disponibles.length) return response.status(503).json({ ok: false, error: EN_PREPARACION });
      const mes = pedido || disponibles[0];
      if (!disponibles.includes(mes)) {
        return response.status(400).json({ ok: false, error: "El mes no tiene sus 12 meses cerrados y cargados." });
      }

      const ventana = ventanaAnual(mes);
      const mesAnterior = correrMes(mes, -12);
      const anterior = disponibles.includes(mesAnterior) ? ventanaAnual(mesAnterior) : null;
      const [filas, filasAnteriores] = await Promise.all([
        consultarClientes(pool, { ...ventana, tienda }),
        anterior ? consultarClientes(pool, { ...anterior, tienda }) : null,
      ]);
      return response.json({
        ok: true,
        data: cuerpoSegmentos({ mes, ventana, anterior, filas, filasAnteriores, mesesDisponibles: disponibles }),
      });
    } catch (error) {
      // 42P01: el agregado todavía no se instaló (orden de despliegue).
      if (error?.code === "42P01") return response.status(503).json({ ok: false, error: EN_PREPARACION });
      return respuestaError(response, error, "No fue posible consultar los clientes.");
    }
  });

  return router;
}
