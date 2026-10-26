/* =============================================================================
   Consultas de Ventas Comerciales sobre `merkahorro_siesa.ventas_comerciales_*`

   Qué se puede sumar y qué no (ver el modelo en el repo del front):
   - `ventas`, `contribucion`, unidades y peso se suman entre días y bodegas.
   - Facturas: una factura tiene UNA fecha y UN vendedor y UN cliente, así que
     sumar `documentos` por día, por vendedor o por cliente está bien. Entre
     bodegas NO: una factura multibodega aparece en cada bodega que la atendió.
     Por eso, con filtro de bodega, se cuenta sobre `factura_bodegas` (una fila
     por factura y bodega).
   - Clientes: NUNCA sumar entre días. Un cliente que compró tres días seguidos
     es un cliente, no tres. Siempre `COUNT(DISTINCT cliente)`.
   ============================================================================= */

const TOP = 10;
const T = "merkahorro_siesa";

export async function consultarFiltros(pool, canal) {
  const [periodo, bodegas] = await Promise.all([
    pool.query(`SELECT MIN(fecha)::text AS desde, MAX(fecha)::text AS hasta
      FROM ${T}.ventas_comerciales_resumen_diario WHERE canal = $1`, [canal]),
    pool.query(`SELECT bodega AS codigo, MAX(desc_bodega) AS nombre
      FROM ${T}.ventas_comerciales_bodega_diario WHERE canal = $1
      GROUP BY bodega ORDER BY MAX(desc_bodega), bodega`, [canal]),
  ]);
  return { periodo: periodo.rows[0], bodegas: bodegas.rows };
}

const rankings = (conRankings, sql) => (conRankings ? sql : "");

/** Período completo sin filtro de bodega: sale de los resúmenes diarios. */
async function consultarSinBodega(pool, { canal, desde, hasta, conRankings }) {
  const result = await pool.query(`
    WITH d AS (
      SELECT * FROM ${T}.ventas_comerciales_resumen_diario
      WHERE canal = $1 AND fecha >= $2::date AND fecha <= $3::date
    )
    SELECT JSON_BUILD_OBJECT(
             'ventas', COALESCE((SELECT SUM(ventas) FROM d), 0),
             'contribucion', COALESCE((SELECT SUM(contribucion) FROM d), 0),
             'documentos', COALESCE((SELECT SUM(documentos) FROM d), 0),
             'clientes', (SELECT COUNT(DISTINCT cliente) FROM ${T}.ventas_comerciales_cliente_diario
                          WHERE canal = $1 AND fecha >= $2::date AND fecha <= $3::date),
             'unidades', COALESCE((SELECT SUM(unidades_inventario) FROM d), 0),
             'pesoKg', COALESCE((SELECT SUM(peso_kg) FROM d), 0)
           ) AS total,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.fecha) FROM (
             SELECT fecha::text AS fecha, ventas, documentos FROM d
           ) f), '[]'::json) AS serie
           ${rankings(conRankings, `,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT bodega AS codigo, MAX(desc_bodega) AS nombre,
                    SUM(ventas) AS ventas, SUM(documentos_atendidos) AS documentos
             FROM ${T}.ventas_comerciales_bodega_diario
             WHERE canal = $1 AND fecha >= $2::date AND fecha <= $3::date
             GROUP BY bodega
           ) f), '[]'::json) AS bodegas,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT codigo_vendedor AS codigo, COALESCE(MAX(nombre_vendedor), codigo_vendedor) AS nombre,
                    SUM(ventas) AS ventas, SUM(documentos) AS documentos
             FROM ${T}.ventas_comerciales_vendedor_diario
             WHERE canal = $1 AND fecha >= $2::date AND fecha <= $3::date
             GROUP BY codigo_vendedor ORDER BY SUM(ventas) DESC LIMIT ${TOP}
           ) f), '[]'::json) AS vendedores,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT cliente AS codigo, COALESCE(MAX(razon_social), cliente) AS nombre,
                    SUM(ventas) AS ventas, SUM(documentos) AS documentos
             FROM ${T}.ventas_comerciales_cliente_diario
             WHERE canal = $1 AND fecha >= $2::date AND fecha <= $3::date
             GROUP BY cliente ORDER BY SUM(ventas) DESC LIMIT ${TOP}
           ) f), '[]'::json) AS clientes,
           ${productos("canal = $1 AND fecha >= $2::date AND fecha <= $3::date")}`)}`,
  [canal, desde, hasta]);
  return result.rows[0];
}

/** Período con filtro de bodega: una fila por factura atendida, para no contar doble. */
async function consultarConBodega(pool, { canal, desde, hasta, bodega, conRankings }) {
  const result = await pool.query(`
    WITH fb AS (
      SELECT fb.fecha, fb.bodega, fb.desc_bodega, fb.subtotal, fb.contribucion,
             fb.unidades_inventario, fb.peso_kg,
             f.cliente, f.razon_social, f.codigo_vendedor, f.nombre_vendedor
      FROM ${T}.ventas_comerciales_factura_bodegas fb
      JOIN ${T}.ventas_comerciales_facturas f
        USING (compania, co, canal, nro_documento)
      WHERE fb.canal = $1 AND fb.fecha >= $2::date AND fb.fecha <= $3::date AND fb.bodega = $4
    )
    SELECT JSON_BUILD_OBJECT(
             'ventas', COALESCE(SUM(subtotal), 0),
             'contribucion', COALESCE(SUM(contribucion), 0),
             'documentos', COUNT(*),
             'clientes', COUNT(DISTINCT cliente),
             'unidades', COALESCE(SUM(unidades_inventario), 0),
             'pesoKg', COALESCE(SUM(peso_kg), 0)
           ) AS total,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.fecha) FROM (
             SELECT fecha::text AS fecha, SUM(subtotal) AS ventas, COUNT(*) AS documentos
             FROM fb GROUP BY fecha
           ) f), '[]'::json) AS serie
           ${rankings(conRankings, `,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, SUM(subtotal) AS ventas, COUNT(*) AS documentos
             FROM fb GROUP BY bodega
           ) f), '[]'::json) AS bodegas,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT codigo_vendedor AS codigo, COALESCE(MAX(nombre_vendedor), codigo_vendedor) AS nombre,
                    SUM(subtotal) AS ventas, COUNT(*) AS documentos
             FROM fb GROUP BY codigo_vendedor ORDER BY SUM(subtotal) DESC LIMIT ${TOP}
           ) f), '[]'::json) AS vendedores,
           COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT cliente AS codigo, COALESCE(MAX(razon_social), cliente) AS nombre,
                    SUM(subtotal) AS ventas, COUNT(*) AS documentos
             FROM fb GROUP BY cliente ORDER BY SUM(subtotal) DESC LIMIT ${TOP}
           ) f), '[]'::json) AS clientes,
           ${productos("canal = $1 AND fecha >= $2::date AND fecha <= $3::date AND bodega = $4")}`)}
    FROM fb`,
  [canal, desde, hasta, bodega]);
  return result.rows[0];
}

/* `documentos` por producto suma días y bodegas: una factura que despachó el
   mismo ítem desde dos bodegas cuenta dos veces. Es raro y solo afecta el
   "N facturas" de esa fila; la venta del producto es exacta. */
function productos(filtro) {
  return `COALESCE((SELECT JSON_AGG(f ORDER BY f.ventas DESC) FROM (
             SELECT item AS codigo, MAX(desc_item) AS nombre, SUM(ventas) AS ventas,
                    SUM(documentos) AS documentos, SUM(unidades_inventario) AS unidades
             FROM ${T}.ventas_comerciales_item_diario
             WHERE ${filtro}
             GROUP BY item ORDER BY SUM(ventas) DESC LIMIT ${TOP}
           ) f), '[]'::json) AS productos`;
}

export function consultarPeriodo(pool, parametros) {
  return parametros.bodega
    ? consultarConBodega(pool, parametros)
    : consultarSinBodega(pool, parametros);
}

/**
 * Venta y contribución diaria de los canales pedidos, para sumarlas a POS.
 * Con filtros de producto sale del resumen por ítem; sin filtros, del diario.
 */
export async function consultarIntegracionPos(pool, { canales, desde, hasta, dimensiones }) {
  const conDimensiones = Object.values(dimensiones).some(Boolean);
  const result = conDimensiones
    ? await pool.query(`
        SELECT fecha::text AS fecha, SUM(ventas) AS ventas, SUM(contribucion) AS contribucion
        FROM ${T}.ventas_comerciales_item_diario
        WHERE canal = ANY($1::text[]) AND fecha >= $2::date AND fecha <= $3::date
          AND ($4::text IS NULL OR grupo = $4)
          AND ($5::text IS NULL OR subgrupo = $5)
          AND ($6::text IS NULL OR proveedor = $6)
          AND ($7::text IS NULL OR marca = $7)
        GROUP BY fecha ORDER BY fecha`,
      [canales, desde, hasta, dimensiones.grupo, dimensiones.subgrupo, dimensiones.proveedor, dimensiones.marca])
    : await pool.query(`
        SELECT fecha::text AS fecha, SUM(ventas) AS ventas, SUM(contribucion) AS contribucion
        FROM ${T}.ventas_comerciales_resumen_diario
        WHERE canal = ANY($1::text[]) AND fecha >= $2::date AND fecha <= $3::date
        GROUP BY fecha ORDER BY fecha`,
      [canales, desde, hasta]);
  return result.rows;
}
