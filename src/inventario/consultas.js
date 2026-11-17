/* =============================================================================
   Consultas del inventario por bodega.

   Lee la foto diaria `inventario_bodega_diario` (la toma
   scripts/refresh_inventario_bodegas.js en el repo del front, ítem por ítem
   desde SIESA) y la cruza con la venta de los 28 días anteriores a la foto
   (`ventas_pdv_resumen_item_diario`) para los días de inventario.

   Valor del inventario = existencia × costo promedio unitario. SIESA también
   guarda un costo total, que puede quedar con saldo aunque la existencia sea
   0 (en PV002, −341 M el 2026-11-17): ese residuo contable no es mercancía y
   se informa aparte.
   ============================================================================= */

import { sedeNormalizada } from "../diarias/reglas.js";

const ESQUEMA = "merkahorro_siesa";
export const INVENTARIO = `${ESQUEMA}.inventario_bodega_diario`;
export const FOTOS = `${ESQUEMA}.inventario_bodega_fotos`;
const VENTAS = `${ESQUEMA}.ventas_pdv_resumen_item_diario`;

/** Fotos guardadas, de la más nueva a la más vieja. Lanza 42P01 sin instalar. */
export async function consultarFotos(pool) {
  const { rows } = await pool.query(`
    SELECT fecha::text AS fecha, tomado_en AS "tomadoEn", items, filas
    FROM ${FOTOS} ORDER BY fecha DESC LIMIT 400`);
  return rows;
}

/** Último día con ventas cargadas. */
export async function consultarUltimaVenta(pool) {
  const { rows } = await pool.query(`SELECT MAX(fecha)::text AS fecha FROM ${ESQUEMA}.ventas_pdv_resumen_diario`);
  return rows[0]?.fecha ?? null;
}

/**
 * $1 fecha de la foto, $2 primer día de venta, $3 último día de venta, $4 sede o NULL.
 * Una fila por (sede, ítem) que tenga inventario o haya vendido en la ventana:
 * lo vendido sin existencia también importa (agotados).
 */
export function sqlInventario() {
  const sedeInv = sedeNormalizada("bodega");
  return `
    WITH inv AS (
      SELECT ${sedeInv} AS sede, item,
             SUM(existencia) AS existencia, SUM(pos) AS pos,
             SUM(existencia * costo_unitario) AS valor, SUM(costo_total) AS costo_total
      FROM ${INVENTARIO}
      WHERE fecha = $1::date AND ($4::text IS NULL OR ${sedeInv} = $4)
      GROUP BY 1, 2
    ), venta AS (
      SELECT ${sedeNormalizada("bodega")} AS sede, item,
             SUM(ventas) AS ventas, SUM(costo) AS costo, SUM(unidades) AS unidades, MAX(fecha) AS ultima
      FROM ${VENTAS}
      WHERE fecha >= $2::date AND fecha <= $3::date AND ($4::text IS NULL OR ${sedeNormalizada("bodega")} = $4)
      GROUP BY 1, 2
    )
    SELECT COALESCE(i.sede, v.sede) AS sede, COALESCE(i.item, v.item) AS item,
           COALESCE(i.existencia, 0)::float8 AS existencia, COALESCE(i.pos, 0)::float8 AS pos,
           COALESCE(i.valor, 0)::float8 AS valor, COALESCE(i.costo_total, 0)::float8 AS costo_total,
           COALESCE(v.ventas, 0)::float8 AS ventas, COALESCE(v.costo, 0)::float8 AS costo_venta,
           COALESCE(v.unidades, 0)::float8 AS unidades, v.ultima::text AS ultima
    FROM inv i FULL JOIN venta v ON v.sede = i.sede AND v.item = i.item
    -- Sin existencia ni venta no dice nada: son ~50 mil filas de residuo
    -- contable en códigos viejos (va aparte, en consultarResiduo).
    WHERE COALESCE(i.existencia, 0) <> 0 OR COALESCE(v.ventas, 0) <> 0 OR COALESCE(v.unidades, 0) <> 0`;
}

export async function consultarInventario(pool, { fecha, ventaDesde, ventaHasta, tienda }) {
  const { rows } = await pool.query(sqlInventario(), [fecha, ventaDesde, ventaHasta, tienda || null]);
  return rows;
}

/**
 * Descripción y clasificación de los ítems, con los mismos nombres de grupo,
 * subgrupo, proveedor y marca que las ventas. El maestro guarda el código con
 * ceros a la izquierda ('0003856'); inventario y ventas, sin.
 */
export async function consultarItems(pool, items) {
  if (!items.length) return [];
  const { rows } = await pool.query(`
    SELECT LTRIM(BTRIM(item::text), '0') AS item,
           BTRIM(MAX(descripcion)) AS descripcion,
           NULLIF(BTRIM(MAX("001-GRUPO")), '') AS grupo,
           NULLIF(BTRIM(MAX("002-SUBGRUPO")), '') AS subgrupo,
           NULLIF(BTRIM(MAX("003-PROVEEDOR")), '') AS proveedor,
           NULLIF(BTRIM(MAX("004-MARCA")), '') AS marca,
           NULLIF(BTRIM(MAX(idunimedidainv)), '') AS unidad
    FROM ${ESQUEMA}.dimitems
    WHERE LTRIM(BTRIM(item::text), '0') = ANY($1::text[])
    GROUP BY 1`, [items]);
  return rows;
}

/** Valor del inventario por foto y sede, para la evolución. */
export async function consultarSerie(pool, { tienda }) {
  const sede = sedeNormalizada("bodega");
  const { rows } = await pool.query(`
    SELECT fecha::text AS fecha, ${sede} AS sede, SUM(existencia * costo_unitario)::float8 AS valor
    FROM ${INVENTARIO}
    WHERE ($1::text IS NULL OR ${sede} = $1)
    GROUP BY 1, 2 ORDER BY 1`, [tienda || null]);
  return rows;
}

/**
 * Nombre de cada bodega. Las tiendas salen de las ventas POS; el almacén, las
 * averías y el acopio no venden en caja y salen de compras (o de comercial).
 */
export async function consultarNombresSede(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (bodega) bodega AS sede, nombre FROM (
      SELECT bodega, 1 AS prioridad, MAX(BTRIM(desc_bodega)) AS nombre FROM ${ESQUEMA}.ventas_pdv_resumen_diario GROUP BY bodega
      UNION ALL SELECT bodega, 2, MAX(BTRIM(desc_bodega)) FROM ${ESQUEMA}.compras_resumen_diario GROUP BY bodega
      UNION ALL SELECT bodega, 3, MAX(BTRIM(desc_bodega)) FROM ${ESQUEMA}.ventas_comerciales_bodega_diario GROUP BY bodega
    ) x
    WHERE NULLIF(nombre, '') IS NOT NULL
    ORDER BY bodega, prioridad`);
  return rows;
}

/**
 * Residuo contable: costo que SIESA guarda en bodegas sin existencia (el
 * costo total menos existencia × costo unitario). No es mercancía; se informa.
 */
export async function consultarResiduo(pool, { fecha, tienda }) {
  const sede = sedeNormalizada("bodega");
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(costo_total - existencia * costo_unitario), 0)::float8 AS residuo,
           COALESCE(SUM(pos) FILTER (WHERE existencia <> 0), 0)::float8 AS pos
    FROM ${INVENTARIO}
    WHERE fecha = $1::date AND ($2::text IS NULL OR ${sede} = $2)`, [fecha, tienda || null]);
  return rows[0];
}
