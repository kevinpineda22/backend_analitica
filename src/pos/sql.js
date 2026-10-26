/* Fragmentos SQL de Ventas POS sobre la tabla transaccional
   `merkahorro_siesa.ventas_pdv_detalle`.

   Venta = subtotal antes de impuestos (`valor_bruto - vlr_tot_dscto`).
   Contribución = venta - costo. Un ticket es (cia, bodega, tipo, consecutivo). */

export const ventaSubtotal = "COALESCE(SUM(COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0)), 0)";
export const contribucion = `COALESCE(SUM(
  COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0) - COALESCE(v.costo, 0)
), 0)`;

export const metricas = {
  pesos: ventaSubtotal,
  contribucion,
  unidades: "COALESCE(SUM(v.cantidad), 0)",
  clientes: "COUNT(DISTINCT NULLIF(BTRIM(v.nit_tercero), ''))::bigint",
  tickets: "COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint",
  ticket_promedio: `COALESCE(
    SUM(COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0)) /
    NULLIF(COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto)), 0),
    0
  )`,
};

/* El ítem llega como número con ceros (`000123.00`) o como texto. Se normaliza
   igual de los dos lados para que el JOIN con `dimitems` encuentre la fila. */
const itemDimension = `CASE
  WHEN BTRIM(item::text) ~ '^[0-9]+([.][0]+)?$'
    THEN COALESCE(NULLIF(LTRIM(SPLIT_PART(BTRIM(item::text), '.', 1), '0'), ''), '0')
  ELSE UPPER(BTRIM(item::text))
END`;

const itemVenta = `CASE
  WHEN BTRIM(v.id_item::text) ~ '^[0-9]+([.][0]+)?$'
    THEN COALESCE(NULLIF(LTRIM(SPLIT_PART(BTRIM(v.id_item::text), '.', 1), '0'), ''), '0')
  ELSE UPPER(BTRIM(v.id_item::text))
END`;

/** CTE `ventas` filtrada por los 8 parámetros de `parametros()`. */
export const cteFiltrado = `WITH dimensiones_item AS (
  SELECT ${itemDimension} AS item,
        COALESCE(NULLIF(BTRIM(MAX("001-GRUPO"::text)), ''), 'Sin grupo') AS grupo,
        COALESCE(NULLIF(BTRIM(MAX("002-SUBGRUPO"::text)), ''), 'Sin subgrupo') AS subgrupo,
        COALESCE(NULLIF(BTRIM(MAX("003-PROVEEDOR"::text)), ''), 'Sin proveedor') AS proveedor,
        COALESCE(NULLIF(BTRIM(MAX("004-MARCA"::text)), ''), 'Sin marca') AS marca
  FROM merkahorro_siesa.dimitems
  WHERE NULLIF(BTRIM(item::text), '') IS NOT NULL
  GROUP BY 1
), ventas AS (
  SELECT v.*, d.grupo, d.subgrupo, d.proveedor, d.marca
  FROM merkahorro_siesa.ventas_pdv_detalle v
  LEFT JOIN dimensiones_item d ON d.item = ${itemVenta}
  WHERE v.fecha_docto >= $1::date
    AND v.fecha_docto < $2::date + 1
    AND ($3::text IS NULL OR v.bodega::text = $3)
    AND ($4::text IS NULL OR BTRIM(v.unidad_de_negocio) = $4)
    AND ($5::text IS NULL OR d.grupo = $5)
    AND ($6::text IS NULL OR d.subgrupo = $6)
    AND ($7::text IS NULL OR d.proveedor = $7)
    AND ($8::text IS NULL OR d.marca = $8)
)`;

/** Parámetros posicionales $1..$8 de `cteFiltrado` y de las consultas resumidas. */
export function parametros(query, desde, hasta) {
  return [
    desde,
    hasta,
    String(query.tienda || query.sede || "").trim() || null,
    String(query.unidadNegocio || "").trim() || null,
    String(query.grupo || "").trim() || null,
    String(query.subgrupo || "").trim() || null,
    String(query.proveedor || "").trim() || null,
    String(query.marca || "").trim() || null,
  ];
}
