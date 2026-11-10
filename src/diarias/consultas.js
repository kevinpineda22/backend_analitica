/* Consultas del informe de ventas diarias. Todas leen
   `ventas_pdv_resumen_diario` (una fila por fecha y sede, PK fecha+bodega):
   dos años completos son ~7 mil filas y responden en menos de 100 ms. */

import { DIAS_RECIENTES, sedeNormalizada, sumarDias } from "./reglas.js";

const TABLA = "merkahorro_siesa.ventas_pdv_resumen_diario";

export const MEDIDAS = Object.freeze(["ventas", "contribucion", "unidades", "tickets"]);

/** Primer y último día con ventas, y cuándo se actualizó la tabla. */
export async function consultarCobertura(pool) {
  const { rows } = await pool.query(`SELECT MIN(fecha)::text AS desde, MAX(fecha)::text AS hasta,
      MAX(actualizado_en) AS actualizado
    FROM ${TABLA}`);
  return rows[0];
}

/**
 * Arma la consulta del corte: por sede, una columna por ventana, lado
 * (actual / anterior) y medida, todas en UNA pasada con FILTER. Devuelve el
 * SQL y sus parámetros para poder probarlo sin base.
 */
export function sqlCorte(fecha, ventanas) {
  const valores = [];
  const parametro = (valor) => {
    valores.push(valor);
    return `$${valores.length}::date`;
  };
  const columnas = [];
  const limites = [fecha, sumarDias(fecha, -DIAS_RECIENTES)];

  ventanas.forEach((ventana) => {
    const lados = [["actual", ventana], ...(ventana.anterior ? [["anterior", ventana.anterior]] : [])];
    lados.forEach(([lado, rango]) => {
      limites.push(rango.desde, rango.hasta);
      const filtro = `fecha BETWEEN ${parametro(rango.desde)} AND ${parametro(rango.hasta)}`;
      MEDIDAS.forEach((medida) => {
        columnas.push(`SUM(${medida}) FILTER (WHERE ${filtro})::float8 AS "${ventana.clave}_${lado}_${medida}"`);
      });
    });
  });

  const recientes = `fecha BETWEEN ${parametro(sumarDias(fecha, -DIAS_RECIENTES))} AND ${parametro(sumarDias(fecha, -1))}`;
  const inicio = parametro(limites.reduce((menor, valor) => (valor < menor ? valor : menor)));
  const fin = parametro(fecha);
  const sede = sedeNormalizada();

  const sql = `SELECT ${sede} AS codigo,
      (ARRAY_AGG(desc_bodega ORDER BY fecha DESC))[1] AS nombre,
      COUNT(*) FILTER (WHERE ${recientes} AND ventas <> 0)::int AS dias_recientes,
      ${columnas.join(",\n      ")}
    FROM ${TABLA}
    WHERE fecha BETWEEN ${inicio} AND ${fin}
    GROUP BY ${sede}`;
  return { sql, valores };
}

export async function consultarCorte(pool, { fecha, ventanas }) {
  const { sql, valores } = sqlCorte(fecha, ventanas);
  const { rows } = await pool.query(sql, valores);
  return rows;
}

/** Totales por día del rango; con `tienda`, solo esa sede (código unificado). */
export async function consultarDias(pool, { desde, hasta, tienda }) {
  const { rows } = await pool.query(`SELECT fecha::text AS fecha,
      SUM(ventas)::float8 AS ventas,
      SUM(contribucion)::float8 AS contribucion,
      SUM(unidades)::float8 AS unidades,
      SUM(tickets)::float8 AS tickets,
      COUNT(*) FILTER (WHERE ventas <> 0)::int AS sedes
    FROM ${TABLA}
    WHERE fecha BETWEEN $1::date AND $2::date
      AND ($3::text IS NULL OR ${sedeNormalizada()} = $3)
    GROUP BY fecha
    ORDER BY fecha`, [desde, hasta, tienda || null]);
  return rows;
}
