/* =============================================================================
   Consultas del análisis por categoría.

   Un ticket es de un solo día y de una sola sede, así que los tickets de un
   grupo (o marca, proveedor…) se SUMAN entre meses y sedes. Lo que no se suma
   es entre valores: un ticket lleva varios grupos.

   Cada período se parte como en pos/tramos.js:
     meses completos  → `ventas_pdv_resumen_dimension_mensual` (scripts/create_pos_rollups.sql
                        en el repo del front), ~10 mil filas por mes;
     puntas           → en vivo desde `ventas_pdv_resumen_item_diario`, desarmando
                        `documentos` solo de esos días.
   ============================================================================= */

import { sedeNormalizada } from "../diarias/reglas.js";
import { tramosMensuales } from "../pos/tramos.js";
import { valorDimension } from "./reglas.js";

const DIARIO = "merkahorro_siesa.ventas_pdv_resumen_item_diario";
export const MENSUAL = "merkahorro_siesa.ventas_pdv_resumen_dimension_mensual";

/** Primer y último mes cargados en el agregado. Lanza 42P01 si no está instalado. */
export async function consultarCoberturaMensual(pool) {
  const { rows } = await pool.query(`SELECT MIN(mes)::text AS desde, MAX(mes)::text AS hasta FROM ${MENSUAL}`);
  return rows[0];
}

/** $1 desde, $2 hasta, $3 tienda, $4 mesDesde, $5 mesHasta, $6 dimensión. */
export function parametrosPeriodo({ desde, hasta }, tienda, dimension) {
  const { mesDesde, mesHasta } = tramosMensuales(desde, hasta);
  return [desde, hasta, tienda || null, mesDesde, mesHasta, dimension];
}

/** Medidas por valor de la dimensión en un período, con la numeración corrida `base`. */
export function sqlPorValor(base = 0) {
  const [desde, hasta, tienda, mesDesde, mesHasta, dimension] = [1, 2, 3, 4, 5, 6].map((n) => `$${n + base}`);
  const sede = sedeNormalizada();
  const enSede = `(${tienda}::text IS NULL OR ${sede} = ${tienda})`;
  const puntas = `((fecha >= ${desde}::date AND fecha < ${mesDesde}::date) OR (fecha >= ${mesHasta}::date AND fecha < ${hasta}::date + 1))`;
  const valor = valorDimension(`${dimension}::text`);
  return `
    SELECT valor, SUM(ventas) AS ventas, SUM(costo) AS costo, SUM(contribucion) AS contribucion,
           SUM(unidades) AS unidades, SUM(tickets) AS tickets
    FROM (
      SELECT valor, ventas, costo, contribucion, unidades, tickets
      FROM ${MENSUAL}
      WHERE dimension = ${dimension}::text AND mes >= ${mesDesde}::date AND mes < ${mesHasta}::date AND ${enSede}
      UNION ALL
      SELECT ${valor}, ventas, costo, contribucion, unidades, 0
      FROM ${DIARIO}
      WHERE ${puntas} AND ${enSede}
      UNION ALL
      SELECT ${valor}, 0, 0, 0, 0, COUNT(DISTINCT (bodega, fecha, d.documento))
      FROM ${DIARIO} CROSS JOIN LATERAL UNNEST(documentos) AS d(documento)
      WHERE ${puntas} AND ${enSede}
      GROUP BY 1
    ) f
    GROUP BY valor`;
}

/**
 * Una fila por valor con el período y, si se pide, el año anterior. FULL JOIN:
 * un grupo que vendía el año pasado y este no, aparece con ceros.
 */
export async function consultarPorValor(pool, { periodo, anterior, tienda, dimension }) {
  const actual = parametrosPeriodo(periodo, tienda, dimension);
  if (!anterior) {
    const { rows } = await pool.query(`
      SELECT valor, ventas::float8, costo::float8, contribucion::float8, unidades::float8, tickets::float8,
             NULL::float8 AS ventas_anterior, NULL::float8 AS costo_anterior, NULL::float8 AS contribucion_anterior,
             NULL::float8 AS unidades_anterior, NULL::float8 AS tickets_anterior
      FROM (${sqlPorValor()}) a`, actual);
    return rows;
  }
  const { rows } = await pool.query(`
    WITH a AS (${sqlPorValor()}), p AS (${sqlPorValor(6)})
    SELECT valor,
           COALESCE(a.ventas, 0)::float8 AS ventas, COALESCE(a.costo, 0)::float8 AS costo,
           COALESCE(a.contribucion, 0)::float8 AS contribucion, COALESCE(a.unidades, 0)::float8 AS unidades,
           COALESCE(a.tickets, 0)::float8 AS tickets,
           COALESCE(p.ventas, 0)::float8 AS ventas_anterior, COALESCE(p.costo, 0)::float8 AS costo_anterior,
           COALESCE(p.contribucion, 0)::float8 AS contribucion_anterior,
           COALESCE(p.unidades, 0)::float8 AS unidades_anterior, COALESCE(p.tickets, 0)::float8 AS tickets_anterior
    FROM a FULL JOIN p USING (valor)`, [...actual, ...parametrosPeriodo(anterior, tienda, dimension)]);
  return rows;
}

/** Totales de la sede (o de todas) en un período: la base de la penetración. */
export async function consultarTotales(pool, { periodo, anterior, tienda }) {
  const sede = sedeNormalizada();
  const total = (d, h) => `SELECT COALESCE(SUM(ventas), 0)::float8 AS ventas, COALESCE(SUM(costo), 0)::float8 AS costo,
      COALESCE(SUM(contribucion), 0)::float8 AS contribucion, COALESCE(SUM(unidades), 0)::float8 AS unidades,
      COALESCE(SUM(tickets), 0)::float8 AS tickets
    FROM merkahorro_siesa.ventas_pdv_resumen_diario
    WHERE fecha BETWEEN ${d}::date AND ${h}::date AND ($3::text IS NULL OR ${sede} = $3)`;
  const { rows } = await pool.query(`
    SELECT (SELECT ROW_TO_JSON(x) FROM (${total("$1", "$2")}) x) AS actual,
           ${anterior ? `(SELECT ROW_TO_JSON(x) FROM (${total("$4", "$5")}) x)` : "NULL::json"} AS anterior`,
  anterior
    ? [periodo.desde, periodo.hasta, tienda || null, anterior.desde, anterior.hasta]
    : [periodo.desde, periodo.hasta, tienda || null]);
  return rows[0];
}
