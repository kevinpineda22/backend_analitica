/* =============================================================================
   Consultas de la segmentación de clientes.

   Lee `ventas_pdv_resumen_cliente_mensual` (scripts/create_pos_rollups.sql en
   el repo del front): venta, tickets y última compra por mes, sede y NIT. Un
   año de una sede o de todas son ~180 mil filas que se agrupan en ~33 mil
   clientes. Sobre el detalle, la misma cuenta tardaba 158 s.
   ============================================================================= */

import { sedeNormalizada } from "../diarias/reglas.js";

export const CLIENTES = "merkahorro_siesa.ventas_pdv_resumen_cliente_mensual";

/** Primer y último mes cargados. Lanza 42P01 si la tabla no está instalada. */
export async function consultarCobertura(pool) {
  const { rows } = await pool.query(`
    SELECT (SELECT MIN(mes)::text FROM ${CLIENTES}) AS desde,
           (SELECT MAX(mes)::text FROM ${CLIENTES}) AS hasta,
           (SELECT MAX(fecha)::text FROM merkahorro_siesa.ventas_pdv_resumen_diario) AS ultimo_dia`);
  return rows[0];
}

/** $1 mesDesde, $2 mesHasta (exclusivo), $3 tienda. */
export function sqlClientes() {
  const sede = sedeNormalizada();
  return `
    WITH base AS (
      SELECT cliente, ${sede} AS sede, mes, nombre, ventas, costo, tickets, ultima_compra
      FROM ${CLIENTES}
      WHERE mes >= $1::date AND mes < $2::date AND ($3::text IS NULL OR ${sede} = $3)
    ), por_cliente AS (
      SELECT cliente, MAX(nombre) AS nombre, SUM(ventas) AS ventas, SUM(costo) AS costo,
             SUM(tickets) AS tickets, MAX(ultima_compra) AS ultima,
             COUNT(DISTINCT mes) AS meses, COUNT(DISTINCT sede) AS sedes
      FROM base GROUP BY cliente
    ), principal AS (
      -- La sede donde más compró en el período.
      SELECT DISTINCT ON (cliente) cliente, sede
      FROM (SELECT cliente, sede, SUM(ventas) AS ventas FROM base GROUP BY 1, 2) x
      ORDER BY cliente, ventas DESC, sede
    )
    SELECT c.cliente, c.nombre, c.ventas::float8 AS ventas, c.costo::float8 AS costo,
           c.tickets::int AS tickets, c.ultima::text AS ultima, c.meses::int AS meses,
           c.sedes::int AS sedes, p.sede AS sede_principal
    FROM por_cliente c JOIN principal p USING (cliente)`;
}

export async function consultarClientes(pool, { mesDesde, mesHasta, tienda }) {
  const { rows } = await pool.query(sqlClientes(), [mesDesde, mesHasta, tienda || null]);
  return rows;
}
