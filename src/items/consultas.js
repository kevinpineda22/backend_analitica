/* Consultas del análisis por ítem. Salen de los meses completos del agregado
   mensual y de los días sueltos del diario (ver pos/tramos.js): la lista
   completa de un año con su año anterior tarda menos de un segundo. */

import { desplazarAnio } from "../comercial/reglas.js";
import { fuenteItems, parametrosItems } from "../pos/tramos.js";

const COLUMNAS = "item, desc_item, unidad_negocio, grupo, subgrupo, proveedor, marca, ventas, costo, contribucion, unidades";

const agregadoPorItem = (base = 0) => `
  SELECT item, MAX(desc_item) AS nombre, MAX(unidad_negocio) AS unidad, MAX(grupo) AS grupo,
         MAX(subgrupo) AS subgrupo, MAX(proveedor) AS proveedor, MAX(marca) AS marca,
         SUM(ventas) AS ventas, SUM(costo) AS costo, SUM(contribucion) AS contribucion, SUM(unidades) AS unidades
  FROM (${fuenteItems(COLUMNAS, "", { base })}) f
  GROUP BY item`;

/**
 * Una fila por ítem con sus medidas del período y del año anterior.
 *
 * FULL JOIN a propósito: un ítem que se vendía el año pasado y este año no,
 * también aparece (con ventas 0). Es justo lo que hay que poder ver.
 */
export async function consultarListaItems(pool, { desde, hasta, tienda, anterior }) {
  const params = parametrosItems(desde, hasta, tienda);
  if (!anterior) {
    const { rows } = await pool.query(`
      SELECT item, nombre, unidad, grupo, subgrupo, proveedor, marca,
             ROUND(ventas)::float8 AS ventas, ROUND(costo)::float8 AS costo,
             ROUND(contribucion)::float8 AS contribucion, ROUND(unidades, 2)::float8 AS unidades,
             NULL::float8 AS ventas_anterior, NULL::float8 AS contribucion_anterior, NULL::float8 AS unidades_anterior
      FROM (${agregadoPorItem()}) actual`, params);
    return rows;
  }

  const { rows } = await pool.query(`
    WITH actual AS (${agregadoPorItem()}),
         previo AS (${agregadoPorItem(5)})
    SELECT item,
           COALESCE(a.nombre, p.nombre) AS nombre, COALESCE(a.unidad, p.unidad) AS unidad,
           COALESCE(a.grupo, p.grupo) AS grupo, COALESCE(a.subgrupo, p.subgrupo) AS subgrupo,
           COALESCE(a.proveedor, p.proveedor) AS proveedor, COALESCE(a.marca, p.marca) AS marca,
           ROUND(COALESCE(a.ventas, 0))::float8 AS ventas, ROUND(COALESCE(a.costo, 0))::float8 AS costo,
           ROUND(COALESCE(a.contribucion, 0))::float8 AS contribucion,
           ROUND(COALESCE(a.unidades, 0), 2)::float8 AS unidades,
           ROUND(COALESCE(p.ventas, 0))::float8 AS ventas_anterior,
           ROUND(COALESCE(p.contribucion, 0))::float8 AS contribucion_anterior,
           ROUND(COALESCE(p.unidades, 0), 2)::float8 AS unidades_anterior
    FROM actual a FULL JOIN previo p USING (item)`,
  [...params, ...parametrosItems(anterior.desde, anterior.hasta, tienda)]);
  return rows;
}

export const periodoAnterior = ({ desde, hasta }) => ({ desde: desplazarAnio(desde), hasta: desplazarAnio(hasta) });

/**
 * Evolución y reparto por sede de una selección de ítems.
 *
 * Con GROUPING SETS en una sola consulta: el backend tiene una conexión y cada
 * ida y vuelta a la base cuesta ~100 ms. Por día lee solo el diario (el mensual
 * no tiene días); por mes, los meses completos del mensual más las puntas.
 */
export async function consultarEvolucionItems(pool, { desde, hasta, granularidad, lineaPorItem, filtros }) {
  const { tienda, unidades, grupos, subgrupos, proveedores, marcas, items } = filtros;
  const [d, h, t, mesDesde, mesHasta] = parametrosItems(desde, hasta, tienda);
  const manana = new Date(`${hasta}T00:00:00Z`);
  manana.setUTCDate(manana.getUTCDate() + 1);
  const sinMeses = manana.toISOString().slice(0, 10);
  const porDia = granularidad === "dia";

  const condiciones = `
      AND ($6::text[] IS NULL OR unidad_negocio = ANY($6))
      AND ($7::text[] IS NULL OR grupo = ANY($7))
      AND ($8::text[] IS NULL OR subgrupo = ANY($8))
      AND ($9::text[] IS NULL OR proveedor = ANY($9))
      AND ($10::text[] IS NULL OR marca = ANY($10))
      AND ($11::text[] IS NULL OR item = ANY($11))`;
  const medidas = "bodega, item, ventas, unidades, contribucion";
  const fuente = fuenteItems(`mes AS periodo, ${medidas}`, condiciones, {
    columnasDiario: `${porDia ? "fecha" : "date_trunc('month', fecha)::date"} AS periodo, ${medidas}`,
  });

  // Postgres rechaza GROUPING(item) y `item` suelto si no está en ningún conjunto.
  const columnasItem = lineaPorItem ? "item, GROUPING(item) AS sin_item" : "NULL::text AS item, 1 AS sin_item";

  const { rows } = await pool.query(`
    SELECT periodo, bodega, ${columnasItem},
           GROUPING(periodo) AS sin_periodo,
           ROUND(SUM(ventas))::float8 AS ventas, ROUND(SUM(unidades), 2)::float8 AS unidades,
           ROUND(SUM(contribucion))::float8 AS contribucion
    FROM (${fuente}) f
    GROUP BY GROUPING SETS ((periodo), (bodega)${lineaPorItem ? ", (periodo, item)" : ""})`,
  [d, h, t, porDia ? sinMeses : mesDesde, porDia ? sinMeses : mesHasta,
    unidades, grupos, subgrupos, proveedores, marcas, items]);
  return rows;
}
