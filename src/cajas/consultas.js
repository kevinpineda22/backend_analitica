/* =============================================================================
   Consultas de Analítica de Cajas sobre `merkahorro_siesa.ventas_pdv_resumen_cajeras`

   El pool tiene UNA conexión (`max: 1`, ver config/db.js): cada ida y vuelta
   suma ~94 ms de red. Por eso /historico es una sola consulta.
   ============================================================================= */

const TABLA = "merkahorro_siesa.ventas_pdv_resumen_cajeras";
const jsonLista = (sql, orden) => `COALESCE((SELECT JSON_AGG(f ORDER BY ${orden}) FROM (${sql}) f), '[]'::json)`;

/** Sedes con ventas en los últimos 60 días: las cerradas (2024 tenía 11) no se ofrecen. */
export async function consultarFiltros(pool) {
  const { rows: [fila] } = await pool.query(`
    WITH c AS (SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta FROM ${TABLA})
    SELECT JSON_BUILD_OBJECT('desde', c.desde::text, 'hasta', c.hasta::text) AS periodo,
      ${jsonLista(`SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, MAX(fecha)::text AS "ultimoDia"
                   FROM ${TABLA}, c WHERE fecha > c.hasta - 60 GROUP BY bodega`, "f.nombre, f.codigo")} AS sedes
    FROM c`);
  return fila;
}

/**
 * Lo que pasó en un período, en UNA ida: totales, mapa día de la semana × hora,
 * cajeras y sedes.
 *
 * - Mapa: documentos promedio por día y cajeras simultáneas promedio (cajeras
 *   activas por franja, promediadas en la hora). Se divide por los días de ESE
 *   día de la semana con ventas, no por los del período.
 * - Horas de una cajera = franjas en que facturó ÷ 4.
 * - Devoluciones (notas con venta negativa) van aparte: una tasa alta en una
 *   cajera es lo primero que mira control interno.
 */
export async function consultarHistorico(pool, { desde, hasta, bodega }) {
  const params = [desde, hasta];
  let filtro = "fecha BETWEEN $1::date AND $2::date";
  if (bodega) {
    params.push(bodega);
    filtro += " AND bodega = $3";
  }
  const { rows: [fila] } = await pool.query(`
    WITH b AS (
      SELECT fecha, bodega, desc_bodega, franja, cajera, facturas + devoluciones AS documentos, devoluciones, venta
      FROM ${TABLA} WHERE ${filtro}
    ),
    franjas AS (
      SELECT fecha, franja, SUM(documentos) AS documentos, SUM(venta) AS venta, COUNT(*) AS cajeras
      FROM b GROUP BY fecha, franja
    ),
    dias AS (
      SELECT EXTRACT(ISODOW FROM fecha)::int AS dia, COUNT(DISTINCT fecha) AS n FROM b GROUP BY 1
    ),
    -- La sede donde más facturó cada cajera (casi todas trabajan en una sola).
    principal AS (
      SELECT DISTINCT ON (cajera) cajera, bodega
      FROM (SELECT cajera, bodega, SUM(documentos) AS documentos FROM b GROUP BY 1, 2) x
      ORDER BY cajera, documentos DESC
    )
    SELECT
      (SELECT JSON_BUILD_OBJECT(
         'documentos', COALESCE(SUM(documentos), 0), 'devoluciones', COALESCE(SUM(devoluciones), 0),
         'venta', COALESCE(SUM(venta), 0),
         'dias', COUNT(DISTINCT fecha), 'cajeras', COUNT(DISTINCT cajera)) FROM b) AS total,
      ${jsonLista(`
        SELECT x.dia AS "diaSemana", x.hora, x.documentos / d.n AS documentos, x.venta / d.n AS venta, x.cajeras
        FROM (SELECT EXTRACT(ISODOW FROM fecha)::int AS dia, EXTRACT(HOUR FROM franja)::int AS hora,
                     SUM(documentos) AS documentos, SUM(venta) AS venta, AVG(cajeras) AS cajeras
              FROM franjas GROUP BY 1, 2) x
        JOIN dias d ON d.dia = x.dia`, `f."diaSemana", f.hora`)} AS mapa,
      ${jsonLista(`
        SELECT b.cajera, p.bodega, SUM(b.documentos) AS documentos, SUM(b.devoluciones) AS devoluciones,
               SUM(b.venta) AS venta, COUNT(DISTINCT b.fecha) AS dias, COUNT(*) / 4.0 AS horas
        FROM b JOIN principal p ON p.cajera = b.cajera
        GROUP BY b.cajera, p.bodega`, "f.documentos DESC")} AS cajeras,
      ${jsonLista(`
        SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, SUM(documentos) AS documentos,
               SUM(venta) AS venta, COUNT(DISTINCT cajera) AS cajeras
        FROM b GROUP BY bodega`, "f.documentos DESC")} AS sedes`,
  params);
  return fila;
}
