/* =============================================================================
   Consultas de Analítica de Compras sobre `merkahorro_siesa.compras_resumen_*`

   TRES idas y vueltas por /resumen: totales del período actual, rankings, y
   totales del año anterior. Medido el 2026-10-26 (10 meses):
   - Cada ida y vuelta a la base cuesta ~94 ms solo de red, y el pool tiene UNA
     conexión (`max: 1`, ver config/db.js): un `Promise.all` corre igual en
     serie. Con 10 consultas sueltas, la red sola eran ~0,95 s.
   - Productos, grupos y motivos salen de UNA pasada por `item_diario` con
     GROUPING SETS: leerla tres veces costaba ~780 ms de servidor.
   - NO usar un CTE MATERIALIZED sobre `item_diario`: se probó y fue PEOR
     (10 meses 2,9 s, todo 5,5 s). Copiar 700 mil filas con texto cuesta más
     que agregarlas directo.
   - Proveedores activos sobre `documentos` (0,13 s) y no sobre `item_diario`
     (2,7 s con todo el histórico), salvo que haya filtro de grupo.
   ============================================================================= */

import { TIPOS, TIPOS_DEL_TABLERO } from "./reglas.js";

const T = "merkahorro_siesa";
const TABLAS = {
  diario: `${T}.compras_resumen_diario`,
  documentos: `${T}.compras_resumen_documentos`,
  item: `${T}.compras_resumen_item_diario`,
};
/* Qué filtros entiende cada tabla, en el MISMO orden en las tres: así los
   parámetros posicionales coinciden y una consulta puede leer varias tablas
   con una sola lista de parámetros (ver `mismosParametros`). */
const COLUMNAS = {
  diario: ["bodega"],
  documentos: ["bodega", "proveedor", "sucursal"],
  item: ["bodega", "proveedor", "sucursal", "grupo"],
};
const TOP = 10;

/** WHERE + parámetros para `tabla`, con período, tipos y los filtros que la tabla tiene. */
export function armarWhere(tabla, { desde, hasta, filtros, tipos = TIPOS_DEL_TABLERO }) {
  const params = [desde, hasta, tipos];
  const condiciones = ["fecha >= $1::date", "fecha <= $2::date", "tipo = ANY($3::text[])"];
  for (const columna of COLUMNAS[tabla]) {
    const valor = filtros[columna];
    if (valor == null) continue;
    params.push(valor);
    condiciones.push(`${columna} = $${params.length}`);
  }
  const sobrantes = Object.entries(filtros).filter(([c, v]) => v != null && !COLUMNAS[tabla].includes(c));
  if (sobrantes.length) {
    throw new Error(`La tabla ${tabla} no tiene ${sobrantes.map(([c]) => c).join(", ")}.`);
  }
  return { where: condiciones.join(" AND "), params };
}

/**
 * WHERE de varias tablas que comparten UNA lista de parámetros. Si alguna
 * numera distinto (no debería: ver COLUMNAS), es un error de programación y
 * se corta acá, antes de mandar a la base un filtro aplicado a otra columna.
 */
export function mismosParametros(tablas, opciones) {
  const armados = Object.fromEntries(tablas.map((tabla) => [tabla, armarWhere(tabla, opciones)]));
  const [primero, ...resto] = Object.values(armados);
  for (const otro of resto) {
    if (JSON.stringify(otro.params) !== JSON.stringify(primero.params)) {
      throw new Error(`Las tablas ${tablas.join(", ")} no comparten parametros con estos filtros.`);
    }
  }
  return { params: primero.params, where: Object.fromEntries(Object.entries(armados).map(([t, a]) => [t, a.where])) };
}

const sumaTipo = (tipo, alias = "") =>
  `COALESCE(SUM(${alias}subtotal) FILTER (WHERE ${alias}tipo = '${tipo}'), 0)`;
const jsonLista = (sql, orden) => `COALESCE((SELECT JSON_AGG(f ORDER BY ${orden}) FROM (${sql}) f), '[]'::json)`;

export async function consultarFiltros(pool) {
  const { rows: [fila] } = await pool.query(`
    SELECT
      (SELECT JSON_BUILD_OBJECT('desde', MIN(fecha)::text, 'hasta', MAX(fecha)::text)
         FROM ${TABLAS.diario} WHERE tipo = $1) AS periodo,
      ${jsonLista(`SELECT bodega AS codigo, MAX(desc_bodega) AS nombre FROM ${TABLAS.diario}
                   WHERE tipo = $1 GROUP BY bodega`, "f.nombre, f.codigo")} AS bodegas,
      ${jsonLista(`SELECT proveedor AS nit, sucursal, COALESCE(MAX(razon_social), proveedor) AS nombre
                   FROM ${TABLAS.documentos} WHERE tipo = $1 GROUP BY proveedor, sucursal`,
                  "f.nombre, f.nit, f.sucursal")} AS proveedores,
      COALESCE((SELECT JSON_AGG(g ORDER BY g) FROM (
        SELECT DISTINCT COALESCE(NULLIF(BTRIM("001-GRUPO"::text), ''), 'Sin grupo') AS g FROM ${T}.dimitems
      ) x), '[]'::json) AS grupos`, [TIPOS.compras]);
  return fila;
}

/* Conteos DISTINTOS del período (nunca sumados entre días). Con grupo no hay
   conteo de documentos posible; proveedores sí, desde el detalle por ítem. */
function sqlConteos(fuente, where) {
  if (fuente.documentos) {
    return `(SELECT JSON_BUILD_OBJECT(
        'entradas', COUNT(DISTINCT documento) FILTER (WHERE tipo = '${TIPOS.compras}'),
        'documentosDevolucion', COUNT(DISTINCT documento) FILTER (WHERE tipo = '${TIPOS.devoluciones}'))
      FROM ${TABLAS.documentos} WHERE ${where.documentos}) AS documentos,
      (SELECT COUNT(*) FROM (SELECT DISTINCT proveedor, sucursal FROM ${TABLAS.documentos}
        WHERE ${where.documentos} AND tipo = '${TIPOS.compras}') x) AS proveedores`;
  }
  return `NULL::json AS documentos,
      (SELECT COUNT(*) FROM (SELECT DISTINCT proveedor, sucursal FROM ${TABLAS.item}
        WHERE ${where.item} AND tipo = '${TIPOS.compras}') x) AS proveedores`;
}

/** Totales por tipo, serie diaria y conteos, en UNA ida. */
async function consultarTotales(pool, periodo, filtros, fuente, { conCobertura }) {
  const tablas = [...new Set([fuente.totales, fuente.documentos || "item"])];
  const { params, where } = mismosParametros(tablas, { ...periodo, filtros });
  const { rows: [fila] } = await pool.query(`
    WITH b AS (
      SELECT fecha, tipo, SUM(subtotal) AS subtotal, SUM(impuestos) AS impuestos, SUM(unidades) AS unidades
      FROM ${TABLAS[fuente.totales]} WHERE ${where[fuente.totales]} GROUP BY fecha, tipo
    )
    SELECT
      COALESCE((SELECT JSON_OBJECT_AGG(tipo, JSON_BUILD_OBJECT(
                  'subtotal', subtotal, 'impuestos', impuestos, 'unidades', unidades))
                FROM (SELECT tipo, SUM(subtotal) AS subtotal, SUM(impuestos) AS impuestos, SUM(unidades) AS unidades
                      FROM b GROUP BY tipo) t), '{}'::json) AS "porTipo",
      ${jsonLista(`SELECT fecha::text AS fecha,
          ${sumaTipo(TIPOS.compras)} AS compras, ${sumaTipo(TIPOS.devoluciones)} AS devoluciones,
          ${sumaTipo(TIPOS.ajusteMayor)} - ${sumaTipo(TIPOS.ajusteMenor)} AS "ajusteNeto"
        FROM b GROUP BY fecha`, "f.fecha")} AS serie,
      ${sqlConteos(fuente, where)}
      ${conCobertura ? `, (SELECT MIN(fecha)::text FROM ${TABLAS.diario} WHERE tipo = '${TIPOS.compras}') AS "coberturaDesde"` : ""}`,
  params);
  return {
    porTipo: fila.porTipo,
    serie: fila.serie,
    conteos: {
      entradas: fila.documentos?.entradas ?? null,
      documentosDevolucion: fila.documentos?.documentosDevolucion ?? null,
      proveedores: fila.proveedores,
    },
    coberturaDesde: fila.coberturaDesde ?? null,
  };
}

/**
 * La tabla más chica que tiene las columnas de este ranking y de los filtros.
 * `documentos` tiene proveedor y bodega (220 mil filas); `diario`, solo bodega
 * (18 mil); el grupo solo está en `item_diario` (1,3 M).
 */
const tablaRanking = (filtros, { necesitaProveedor }) => {
  if (filtros.grupo) return "item";
  if (necesitaProveedor || filtros.proveedor) return "documentos";
  return "diario";
};

/** Todos los rankings en UNA ida. */
async function consultarRankings(pool, periodo, filtros) {
  const tablaProveedores = tablaRanking(filtros, { necesitaProveedor: true });
  const tablaBodegas = tablaRanking(filtros, { necesitaProveedor: false });
  const { params, where } = mismosParametros(
    [...new Set([tablaProveedores, tablaBodegas, "item"])], { ...periodo, filtros },
  );
  const nombreBodega = (alias) => `(SELECT MAX(n.desc_bodega) FROM ${TABLAS.diario} n WHERE n.bodega = ${alias}.bodega)`;

  const { rows: [fila] } = await pool.query(`
    WITH g AS (
      -- Una sola pasada por item_diario para tres rankings.
      SELECT GROUPING(item) AS por_item, GROUPING(grupo) AS por_grupo, GROUPING(motivo) AS por_motivo,
             item, grupo, motivo, MAX(desc_item) AS desc_item, MAX(desc_motivo) AS desc_motivo,
             ${sumaTipo(TIPOS.compras)} AS compras, ${sumaTipo(TIPOS.devoluciones)} AS devoluciones,
             COALESCE(SUM(unidades) FILTER (WHERE tipo = '${TIPOS.compras}'), 0) AS unidades,
             COALESCE(SUM(lineas) FILTER (WHERE tipo = '${TIPOS.devoluciones}'), 0) AS lineas_devolucion
      FROM ${TABLAS.item}
      WHERE ${where.item} AND tipo IN ('${TIPOS.compras}', '${TIPOS.devoluciones}')
      GROUP BY GROUPING SETS ((item), (grupo), (motivo))
    )
    SELECT
      ${jsonLista(`SELECT proveedor AS nit, sucursal, COALESCE(MAX(razon_social), proveedor) AS nombre,
          ${sumaTipo(TIPOS.compras)} AS compras, ${sumaTipo(TIPOS.devoluciones)} AS devoluciones,
          ${sumaTipo(TIPOS.ajusteMayor)} - ${sumaTipo(TIPOS.ajusteMenor)} AS "ajusteNeto"
        FROM ${TABLAS[tablaProveedores]} WHERE ${where[tablaProveedores]}
        GROUP BY proveedor, sucursal ORDER BY 4 DESC LIMIT ${TOP}`, "f.compras DESC")} AS proveedores,
      ${jsonLista(`SELECT x.bodega AS codigo, COALESCE(${nombreBodega("x")}, x.bodega) AS nombre,
          ${sumaTipo(TIPOS.compras, "x.")} AS compras, ${sumaTipo(TIPOS.devoluciones, "x.")} AS devoluciones
        FROM ${TABLAS[tablaBodegas]} x WHERE ${where[tablaBodegas]} GROUP BY x.bodega`, "f.compras DESC")} AS bodegas,
      ${jsonLista(`SELECT item AS codigo, desc_item AS nombre, compras, devoluciones, unidades
        FROM g WHERE por_item = 0 ORDER BY compras DESC LIMIT ${TOP}`, "f.compras DESC")} AS productos,
      ${jsonLista(`SELECT grupo AS codigo, grupo AS nombre, compras, devoluciones
        FROM g WHERE por_grupo = 0 ORDER BY compras DESC LIMIT ${TOP}`, "f.compras DESC")} AS grupos,
      ${jsonLista(`SELECT NULLIF(motivo, '') AS codigo, COALESCE(desc_motivo, 'Sin motivo') AS nombre,
          devoluciones AS valor, lineas_devolucion AS lineas
        FROM g WHERE por_motivo = 0 AND lineas_devolucion > 0`, "f.valor DESC")} AS motivos`,
  params);
  return fila;
}

export async function consultarPeriodo(pool, { periodo, filtros, fuente, conRankings }) {
  const totales = await consultarTotales(pool, periodo, filtros, fuente, { conCobertura: conRankings });
  if (!conRankings) return totales;
  return { ...totales, rankings: await consultarRankings(pool, periodo, filtros) };
}
