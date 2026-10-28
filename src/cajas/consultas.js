/* =============================================================================
   Consultas de Analítica de Cajas sobre `merkahorro_siesa.ventas_pdv_resumen_cajeras`

   El pool tiene UNA conexión (`max: 1`, ver config/db.js): cada ida y vuelta
   suma ~94 ms de red. Por eso /historico es una sola consulta, y /pronostico
   son dos: la primera da el último día cargado de la sede, y de ahí salen las
   fechas que pide la segunda.
   ============================================================================= */

import { DIAS_CAPACIDAD } from "./reglas.js";

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
 * Último día cargado, nombre y capacidad de la sede.
 *
 * Capacidad = documentos por cajera en el 20 % de franjas con más documentos de
 * las últimas 8 semanas. En las franjas flojas una cajera está esperando
 * clientes y su "ritmo" no mide lo que puede atender.
 */
export async function consultarContexto(pool, bodega) {
  const { rows: [fila] } = await pool.query(`
    WITH u AS (SELECT MAX(fecha) AS ultimo, MAX(desc_bodega) AS nombre FROM ${TABLA} WHERE bodega = $1),
    f AS (
      SELECT t.fecha, t.franja, SUM(t.facturas + t.devoluciones) AS documentos, COUNT(*) AS cajeras
      FROM ${TABLA} t, u WHERE t.bodega = $1 AND t.fecha > u.ultimo - $2::int AND t.fecha <= u.ultimo
      GROUP BY t.fecha, t.franja
    ),
    r AS (SELECT *, PERCENT_RANK() OVER (ORDER BY documentos) AS rango FROM f)
    SELECT u.ultimo::text AS "ultimoDia", u.nombre,
           (SELECT AVG(documentos::numeric / cajeras) FROM r WHERE rango >= 0.8) AS capacidad,
           (SELECT COUNT(*) FROM r WHERE rango >= 0.8) AS "franjasCapacidad"
    FROM u`, [bodega, DIAS_CAPACIDAD]);
  return fila;
}

/** Documentos y cajeras activas por fecha y franja, en las dos ventanas del pronóstico. */
export async function consultarFranjas(pool, bodega, { reciente, anioPasado }) {
  const { rows } = await pool.query(`
    SELECT fecha::text AS fecha, to_char(franja, 'HH24:MI') AS franja,
           SUM(facturas + devoluciones) AS documentos, COUNT(*) AS cajeras
    FROM ${TABLA}
    WHERE bodega = $1
      AND ((fecha BETWEEN $2::date AND $3::date) OR (fecha BETWEEN $4::date AND $5::date))
    GROUP BY fecha, franja`,
  [bodega, reciente.desde, reciente.hasta, anioPasado.desde, anioPasado.hasta]);
  return rows;
}

/**
 * Lo que pasó en un período, en UNA ida: totales, mapa día de la semana × hora,
 * cajeras y sedes.
 *
 * - Mapa: documentos promedio por día y cajeras simultáneas promedio (cajeras
 *   activas por franja, promediadas en la hora). Se divide por los días de ESE
 *   día de la semana con ventas, no por los del período.
 * - Horas de una cajera = franjas en que facturó ÷ 4.
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
      SELECT fecha, bodega, desc_bodega, franja, cajera, facturas + devoluciones AS documentos, venta
      FROM ${TABLA} WHERE ${filtro}
    ),
    franjas AS (
      SELECT fecha, franja, SUM(documentos) AS documentos, COUNT(*) AS cajeras FROM b GROUP BY fecha, franja
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
         'documentos', COALESCE(SUM(documentos), 0), 'venta', COALESCE(SUM(venta), 0),
         'dias', COUNT(DISTINCT fecha), 'cajeras', COUNT(DISTINCT cajera)) FROM b) AS total,
      ${jsonLista(`
        SELECT x.dia AS "diaSemana", x.hora, x.documentos / d.n AS documentos, x.cajeras
        FROM (SELECT EXTRACT(ISODOW FROM fecha)::int AS dia, EXTRACT(HOUR FROM franja)::int AS hora,
                     SUM(documentos) AS documentos, AVG(cajeras) AS cajeras
              FROM franjas GROUP BY 1, 2) x
        JOIN dias d ON d.dia = x.dia`, `f."diaSemana", f.hora`)} AS mapa,
      ${jsonLista(`
        SELECT b.cajera, p.bodega, SUM(b.documentos) AS documentos, SUM(b.venta) AS venta,
               COUNT(DISTINCT b.fecha) AS dias, COUNT(*) / 4.0 AS horas
        FROM b JOIN principal p ON p.cajera = b.cajera
        GROUP BY b.cajera, p.bodega`, "f.documentos DESC")} AS cajeras,
      ${jsonLista(`
        SELECT bodega AS codigo, MAX(desc_bodega) AS nombre, SUM(documentos) AS documentos,
               SUM(venta) AS venta, COUNT(DISTINCT cajera) AS cajeras
        FROM b GROUP BY bodega`, "f.documentos DESC")} AS sedes`,
  params);
  return fila;
}
