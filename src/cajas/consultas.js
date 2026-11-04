/* =============================================================================
   Consultas de Analítica de Cajas sobre `merkahorro_siesa.ventas_pdv_resumen_cajeras`

   El pool tiene UNA conexión (`max: 1`, ver config/db.js): cada ida y vuelta
   suma ~94 ms de red. Por eso /historico es una sola consulta.

   Una fila es (fecha, sede, franja, caja, cajera): una cajera que cambia de
   caja dentro de un cuarto de hora tiene dos filas. Por eso cajeras y horas se
   cuentan DISTINTAS, nunca con COUNT(*).
   ============================================================================= */

import { CAJAS_DESDE, SIN_CAJA } from "./reglas.js";

const TABLA = "merkahorro_siesa.ventas_pdv_resumen_cajeras";
const jsonLista = (sql, orden) => `COALESCE((SELECT JSON_AGG(f ORDER BY ${orden}) FROM (${sql}) f), '[]'::json)`;

/**
 * Sedes con ventas en los últimos 60 días (las cerradas de 2024 no se
 * ofrecen), cada una con sus cajas de esos mismos días.
 */
export async function consultarFiltros(pool) {
  const { rows: [fila] } = await pool.query(`
    WITH c AS (SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta FROM ${TABLA})
    SELECT JSON_BUILD_OBJECT('desde', c.desde::text, 'hasta', c.hasta::text) AS periodo,
      $1::text AS "cajasDesde",
      ${jsonLista(`SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, MAX(fecha)::text AS "ultimoDia",
                          ARRAY_AGG(DISTINCT caja ORDER BY caja) FILTER (WHERE caja <> $2) AS cajas
                   FROM ${TABLA}, c WHERE fecha > c.hasta - 60 GROUP BY bodega`, "f.nombre, f.codigo")} AS sedes
    FROM c`, [CAJAS_DESDE, SIN_CAJA]);
  return fila;
}

/**
 * Lo que pasó en un período, en UNA ida: totales, mapa día de la semana × hora,
 * cajas, cajeras y sedes.
 *
 * - Mapa: documentos promedio por día y cajeras simultáneas promedio (cajeras
 *   activas por franja, promediadas en la hora). Se divide por los días de ESE
 *   día de la semana con ventas, no por los del período.
 * - Horas de una caja o cajera = cuartos de hora en que facturó ÷ 4.
 * - Hora pico de una caja: la hora del día en que más facturó en el período.
 * - Devoluciones (notas con venta negativa) van aparte: una tasa alta en una
 *   cajera es lo primero que mira control interno.
 */
export async function consultarHistorico(pool, { desde, hasta, bodega, caja }) {
  const params = [desde, hasta];
  let filtro = "fecha BETWEEN $1::date AND $2::date";
  if (bodega) {
    params.push(bodega);
    filtro += ` AND bodega = $${params.length}`;
  }
  if (caja) {
    params.push(caja);
    filtro += ` AND caja = $${params.length}`;
  }
  const { rows: [fila] } = await pool.query(`
    WITH b AS (
      SELECT fecha, bodega, desc_bodega, franja, caja, cajera, facturas + devoluciones AS documentos, devoluciones, venta
      FROM ${TABLA} WHERE ${filtro}
    ),
    franjas AS (
      SELECT fecha, franja, SUM(documentos) AS documentos, SUM(venta) AS venta, COUNT(DISTINCT (bodega, cajera)) AS cajeras
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
    ),
    pico_caja AS (
      SELECT DISTINCT ON (bodega, caja) bodega, caja, hora, documentos
      FROM (SELECT bodega, caja, EXTRACT(HOUR FROM franja)::int AS hora, SUM(documentos) AS documentos
            FROM b GROUP BY 1, 2, 3) x
      ORDER BY bodega, caja, documentos DESC
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
        SELECT b.bodega, MAX(b.desc_bodega) AS "nombreSede", b.caja,
               SUM(b.documentos) AS documentos, SUM(b.devoluciones) AS devoluciones, SUM(b.venta) AS venta,
               COUNT(DISTINCT b.fecha) AS dias, COUNT(DISTINCT (b.fecha, b.franja)) / 4.0 AS horas,
               COUNT(DISTINCT b.cajera) AS cajeras, p.hora AS "horaPico", p.documentos AS "documentosPico"
        FROM b JOIN pico_caja p ON p.bodega = b.bodega AND p.caja = b.caja
        GROUP BY b.bodega, b.caja, p.hora, p.documentos`, "f.documentos DESC")} AS cajas,
      ${jsonLista(`
        SELECT b.cajera, p.bodega, SUM(b.documentos) AS documentos, SUM(b.devoluciones) AS devoluciones,
               SUM(b.venta) AS venta, COUNT(DISTINCT b.fecha) AS dias,
               COUNT(DISTINCT (b.fecha, b.franja)) / 4.0 AS horas
        FROM b JOIN principal p ON p.cajera = b.cajera
        GROUP BY b.cajera, p.bodega`, "f.documentos DESC")} AS cajeras,
      ${jsonLista(`
        SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, SUM(documentos) AS documentos,
               SUM(venta) AS venta, COUNT(DISTINCT cajera) AS cajeras
        FROM b GROUP BY bodega`, "f.documentos DESC")} AS sedes`,
  params);
  return fila;
}
