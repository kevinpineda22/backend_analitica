/* =============================================================================
   Combinaciones: qué categorías se llevan en el MISMO ticket.

   Lee `ventas_pdv_resumen_par_mensual` (scripts/create_pos_rollups.sql en el
   repo del front): por mes y sede, los tickets que llevaron los dos valores
   de un par (valor_a < valor_b). Solo meses completos: un par no se puede
   reconstruir de las puntas sin desarmar los tickets del diario entero.

   Los tickets de cada valor salen de la DIAGONAL de la misma tabla
   (valor_a = valor_b), armada con el mismo filtro que los pares; NO de
   `ventas_pdv_resumen_dimension_mensual`, que incluye SIN_UNIDAD. Los de la
   sede, de `ventas_pdv_resumen_diario`. Con eso la pantalla calcula la
   confianza (de los tickets con A, cuántos llevaron B) y el lift (cuántas
   veces más que un ticket cualquiera).
   ============================================================================= */

import { sedeNormalizada } from "../diarias/reglas.js";
import { tramosMensuales } from "../pos/tramos.js";

export const PARES = "merkahorro_siesa.ventas_pdv_resumen_par_mensual";

/** Subgrupo y marca no están: multiplicaban la tabla por 25 y por 70. */
export const DIMENSIONES_PAR = Object.freeze(["unidad", "grupo"]);

export const leerDimensionPar = (valor) => (DIMENSIONES_PAR.includes(String(valor)) ? String(valor) : null);

const correrAnio = (fecha) => `${Number(fecha.slice(0, 4)) - 1}${fecha.slice(4)}`;
const diaAnterior = (fecha) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Los meses del período si es de meses completos; null si tiene días sueltos.
 * @returns {{ mesDesde: string, mesHasta: string } | null} mesHasta exclusivo
 */
export function mesesCompletos({ desde, hasta }) {
  const tramo = tramosMensuales(desde, hasta);
  if (tramo.mesDesde >= tramo.mesHasta) return null;
  return tramo.mesDesde === desde && diaAnterior(tramo.mesHasta) === hasta ? tramo : null;
}

/**
 * Los mismos meses un año antes. Se corre el primero de cada mes (no la fecha
 * final), así un febrero bisiesto no se convierte en "28-feb + 1 día".
 */
export function mesesAnteriores(tramo) {
  const mesDesde = correrAnio(tramo.mesDesde);
  const mesHasta = correrAnio(tramo.mesHasta);
  return { mesDesde, mesHasta, periodo: { desde: mesDesde, hasta: diaAnterior(mesHasta) } };
}

/** Primer y último mes con pares. Lanza 42P01 si la tabla no está instalada. */
export async function consultarCoberturaPares(pool) {
  const { rows } = await pool.query(`SELECT MIN(mes)::text AS desde, MAX(mes)::text AS hasta FROM ${PARES}`);
  return rows[0];
}

/* $1 mesDesde, $2 mesHasta, $3 tienda, $4 dimensión (más `base`). */
const filtro = (base) => {
  const [mesDesde, mesHasta, tienda, dimension] = [1, 2, 3, 4].map((n) => `$${n + base}`);
  return `dimension = ${dimension}::text AND mes >= ${mesDesde}::date AND mes < ${mesHasta}::date
      AND (${tienda}::text IS NULL OR ${sedeNormalizada()} = ${tienda})`;
};

export const sqlPares = (base = 0) => `
    SELECT valor_a, valor_b, SUM(tickets) AS tickets FROM ${PARES}
    WHERE ${filtro(base)} AND valor_a < valor_b GROUP BY valor_a, valor_b`;

export const sqlValores = (base = 0) => `
    SELECT valor_a AS valor, SUM(tickets) AS tickets FROM ${PARES}
    WHERE ${filtro(base)} AND valor_a = valor_b GROUP BY valor_a`;

const parametros = (tramo, tienda, dimension) => [tramo.mesDesde, tramo.mesHasta, tienda || null, dimension];

/**
 * Pares y tickets por valor del período, con el año anterior si se pide.
 * FULL JOIN: un par que existía el año pasado y este no, vuelve con 0.
 */
export async function consultarCombinaciones(pool, { tramo, tramoAnterior, tienda, dimension }) {
  const actual = parametros(tramo, tienda, dimension);
  if (!tramoAnterior) {
    const [pares, valores] = await Promise.all([
      pool.query(`SELECT valor_a, valor_b, tickets::float8, NULL::float8 AS tickets_anterior FROM (${sqlPares()}) a`, actual),
      pool.query(`SELECT valor, tickets::float8, NULL::float8 AS tickets_anterior FROM (${sqlValores()}) a`, actual),
    ]);
    return { pares: pares.rows, valores: valores.rows };
  }
  const ambos = [...actual, ...parametros(tramoAnterior, tienda, dimension)];
  const [pares, valores] = await Promise.all([
    pool.query(`
      WITH a AS (${sqlPares()}), p AS (${sqlPares(4)})
      SELECT valor_a, valor_b, COALESCE(a.tickets, 0)::float8 AS tickets, COALESCE(p.tickets, 0)::float8 AS tickets_anterior
      FROM a FULL JOIN p USING (valor_a, valor_b)`, ambos),
    pool.query(`
      WITH a AS (${sqlValores()}), p AS (${sqlValores(4)})
      SELECT valor, COALESCE(a.tickets, 0)::float8 AS tickets, COALESCE(p.tickets, 0)::float8 AS tickets_anterior
      FROM a FULL JOIN p USING (valor)`, ambos),
  ]);
  return { pares: pares.rows, valores: valores.rows };
}

const numeroONulo = (valor) => (valor == null ? null : Number(valor));

/** Arreglos en lugar de objetos: un año de grupos son ~1.800 pares. */
export function cuerpoCombinaciones({ periodo, anterior, dimension, totales, pares, valores }) {
  return {
    periodo,
    anterior,
    dimension,
    tickets: {
      actual: Number(totales.actual?.tickets || 0),
      anterior: anterior ? Number(totales.anterior?.tickets || 0) : null,
    },
    columnasValores: ["valor", "tickets", "ticketsAnterior"],
    valores: valores
      .map((fila) => [fila.valor, Number(fila.tickets || 0), numeroONulo(fila.tickets_anterior)])
      .sort((a, b) => b[1] - a[1]),
    columnasPares: ["valorA", "valorB", "tickets", "ticketsAnterior"],
    pares: pares
      .map((fila) => [fila.valor_a, fila.valor_b, Number(fila.tickets || 0), numeroONulo(fila.tickets_anterior)])
      .sort((a, b) => b[2] - a[2]),
  };
}
