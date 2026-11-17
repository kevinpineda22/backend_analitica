/* Rutas del inventario por bodega, montadas en /api/analitica-inventario. */

import express from "express";
import { respuestaError } from "../http.js";
import { leerTienda } from "../diarias/reglas.js";
import {
  consultarFotos, consultarInventario, consultarItems, consultarNombresSede, consultarResiduo, consultarSerie,
  consultarUltimaVenta,
} from "./consultas.js";
import { cuerpoInventario, leerFecha, ventanaVenta } from "./reglas.js";

const EN_PREPARACION = "El inventario por sede todavia se esta preparando. Intente mas tarde.";

export function rutasInventario(pool) {
  const router = express.Router();

  /* La foto del inventario de `fecha` (por defecto, la última) con la venta de
     los 28 días anteriores, por sede e ítem. */
  router.get("/foto", async (request, response) => {
    const pedida = request.query.fecha;
    if (pedida && !leerFecha(pedida)) return response.status(400).json({ ok: false, error: "La fecha no es valida." });
    const tienda = leerTienda(request.query.tienda);

    try {
      const fotos = await consultarFotos(pool);
      if (!fotos.length) return response.status(503).json({ ok: false, error: EN_PREPARACION });
      const foto = pedida ? fotos.find((f) => f.fecha === pedida) : fotos[0];
      if (!foto) return response.status(400).json({ ok: false, error: "No hay foto del inventario de esa fecha." });

      const ventana = ventanaVenta(foto.fecha, await consultarUltimaVenta(pool));
      const [filas, serie, nombres, residuo] = await Promise.all([
        consultarInventario(pool, { fecha: foto.fecha, ventaDesde: ventana.desde, ventaHasta: ventana.hasta, tienda }),
        consultarSerie(pool, { tienda }),
        consultarNombresSede(pool),
        consultarResiduo(pool, { fecha: foto.fecha, tienda }),
      ]);
      const items = await consultarItems(pool, [...new Set(filas.map((f) => f.item))]);
      return response.json({ ok: true, data: cuerpoInventario({ foto, fotos, ventana, filas, items, serie, nombres, residuo }) });
    } catch (error) {
      // 42P01: las tablas de la foto todavía no se instalaron (orden de despliegue).
      if (error?.code === "42P01") return response.status(503).json({ ok: false, error: EN_PREPARACION });
      return respuestaError(response, error, "No fue posible consultar el inventario.");
    }
  });

  return router;
}
