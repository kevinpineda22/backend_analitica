/* Rutas del informe de ventas diarias, montadas en /api/analitica-diaria. */

import express from "express";
import { fechaValida, respuestaError, validarPeriodo } from "../http.js";
import { consultarCobertura, consultarCorte, consultarDias } from "./consultas.js";
import { DIAS_MAXIMOS_SERIE, diasEntre, leerTienda, ventanasDelCorte } from "./reglas.js";
import { cuerpoCorte, cuerpoDias } from "./respuesta.js";

export function rutasDiarias(pool) {
  const router = express.Router();

  /* Día, semana, mes y año hasta `fecha`, por sede, con su año anterior.
     Sin `fecha`, el último día con datos. */
  router.get("/corte", async (request, response) => {
    const pedida = String(request.query.fecha || "");
    if (pedida && !fechaValida(pedida)) {
      return response.status(400).json({ ok: false, error: "La fecha no es valida." });
    }

    try {
      const cobertura = await consultarCobertura(pool);
      if (!cobertura?.hasta) {
        return response.status(404).json({ ok: false, error: "No hay ventas disponibles para analizar." });
      }
      const fecha = pedida || cobertura.hasta;
      if (fecha < cobertura.desde || fecha > cobertura.hasta) {
        return response.status(400).json({ ok: false, error: "La fecha esta fuera de los datos disponibles." });
      }
      const ventanas = ventanasDelCorte(fecha, cobertura.desde);
      const filas = await consultarCorte(pool, { fecha, ventanas });
      return response.json({ ok: true, data: cuerpoCorte({ fecha, cobertura, ventanas, filas }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar el corte diario.");
    }
  });

  /* Totales por día de un rango, de todas las sedes o de una. */
  router.get("/dias", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;
    if (diasEntre(periodo.desde, periodo.hasta) > DIAS_MAXIMOS_SERIE) {
      return response.status(400).json({ ok: false, error: "El rango maximo es de tres anios." });
    }
    const tienda = leerTienda(request.query.tienda);

    try {
      const filas = await consultarDias(pool, { ...periodo, tienda });
      return response.json({ ok: true, data: cuerpoDias({ periodo, tienda, filas }) });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar las ventas por dia.");
    }
  });

  return router;
}
