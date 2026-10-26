/* Rutas de Ventas POS, montadas en /api/analitica. */

import express from "express";
import { respuestaError, validarPeriodo } from "../http.js";
import {
  consultarAnalisisKpiDiario,
  consultarBodegas,
  consultarDetallesDiarios,
  consultarFiltros,
  consultarOperacionHoraria,
  consultarResumenDiario,
  consultarResumenItemsFiltrado,
  consultarTransaccionalCompleto,
  consultarTransaccionalRapido,
} from "./consultas.js";
import { elegirFuente, HEADER_FUENTE } from "./fuente.js";
import {
  CODIGOS_UNIDAD_NEGOCIO,
  cuerpoKpi,
  cuerpoResumen,
  normalizarNumerosBodega,
  UNIDADES_NEGOCIO,
} from "./respuesta.js";
import { metricas, parametros } from "./sql.js";

export function rutasPos(pool) {
  const router = express.Router();

  router.get("/filtros", async (_request, response) => {
    try {
      const rows = await consultarFiltros(pool);
      if (!rows.length || !rows[0].desde) {
        return response.status(404).json({ ok: false, error: "No hay ventas disponibles para analizar." });
      }

      const first = rows[0];
      return response.json({
        ok: true,
        data: {
          periodo: { desde: first.desde, hasta: first.hasta },
          tiendas: rows.map(({ codoc, nombre }) => ({ codoc, nombre })),
          grupos: first.grupos || [],
          subgrupos: first.subgrupos || [],
          proveedores: first.proveedores || [],
          marcas: first.marcas || [],
        },
      });
    } catch (error) {
      return respuestaError(response, error, "No fue posible cargar los filtros.");
    }
  });

  router.get("/bodegas", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;

    try {
      const rows = await consultarBodegas(pool, parametros(request.query, periodo.desde, periodo.hasta));
      response.json({ ok: true, data: rows.map(normalizarNumerosBodega) });
    } catch (error) {
      respuestaError(response, error, "No fue posible consultar los totales por bodega.");
    }
  });

  router.get("/operacion-horaria", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;

    const tienda = String(request.query.tienda || request.query.sede || "").trim() || null;
    try {
      const data = await consultarOperacionHoraria(pool, periodo.desde, periodo.hasta, tienda);
      response.set("X-Analytics-Source", "resumen-horario");
      return response.json({ ok: true, data: { periodo, ...data } });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar la operacion horaria.");
    }
  });

  router.get("/resumen", async (request, response) => {
    const periodo = validarPeriodo(request, response);
    if (!periodo) return;

    const metrica = String(request.query.metrica || "pesos");
    if (!metricas[metrica]) {
      return response.status(400).json({ ok: false, error: "Metrica no valida." });
    }

    const unidadNegocio = String(request.query.unidadNegocio || "").trim();
    if (unidadNegocio && !CODIGOS_UNIDAD_NEGOCIO.includes(unidadNegocio)) {
      return response.status(400).json({ ok: false, error: "Unidad de negocio no valida." });
    }

    const values = parametros(request.query, periodo.desde, periodo.hasta);
    const rapido = request.query.rapido === "1";
    const tienda = values[2];
    const fuente = elegirFuente({ metrica, rapido, conFiltros: values.slice(3).some(Boolean) });
    const campoValor = metrica === "contribucion" ? "contribucion" : "ventas";

    try {
      let data;
      if (fuente === "item-filtrado") {
        const fila = await consultarResumenItemsFiltrado(pool, values, metrica);
        data = cuerpoResumen({ periodo, metrica, ...fila, parcial: false });
      } else if (fuente === "diario-rapido") {
        const fila = await consultarResumenDiario(pool, periodo.desde, periodo.hasta, tienda, campoValor);
        data = cuerpoResumen({ periodo, metrica, ...fila, parcial: true });
      } else if (fuente === "diario-detalle") {
        const fila = await consultarResumenDiario(pool, periodo.desde, periodo.hasta, tienda, campoValor);
        const detalles = await consultarDetallesDiarios(pool, periodo.desde, periodo.hasta, tienda, campoValor);
        data = cuerpoResumen({ periodo, metrica, ...fila, ...detalles, parcial: false });
      } else if (fuente === "kpi-diario") {
        const analisis = await consultarAnalisisKpiDiario(pool, periodo.desde, periodo.hasta, tienda, metrica);
        data = cuerpoKpi({ periodo, metrica, analisis });
      } else if (rapido) {
        const fila = await consultarTransaccionalRapido(pool, values, metrica);
        data = cuerpoResumen({ periodo, metrica, ...fila, parcial: true });
      } else {
        const fila = await consultarTransaccionalCompleto(pool, values, metrica);
        data = cuerpoResumen({ periodo, metrica, ...fila, parcial: false });
      }

      response.set("X-Analytics-Source", HEADER_FUENTE[fuente]);
      return response.json({ ok: true, data });
    } catch (error) {
      return respuestaError(response, error, "No fue posible consultar la analitica.");
    }
  });

  router.get("/modelo", (_request, response) => {
    response.json({
      ok: true,
      data: {
        metricas: Object.keys(metricas),
        filtros: ["desde", "hasta", "tienda", "unidadNegocio", "grupo", "subgrupo", "proveedor", "marca"],
        unidadesNegocio: Object.entries(UNIDADES_NEGOCIO).map(([codigo, definicion]) => ({ codigo, ...definicion })),
      },
    });
  });

  return router;
}
