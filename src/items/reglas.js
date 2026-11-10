/* Reglas del análisis por ítem: qué se acepta en la URL y con qué detalle se
   arma la evolución. Sin base de datos, para poder probarlas solas. */

/** Hasta este rango la evolución va día por día; más largo, mes por mes. */
export const DIAS_MAXIMOS_DIARIO = 62;

/** Con este tope de ítems elegidos, la evolución trae además una línea por ítem. */
export const ITEMS_MAXIMOS_POR_LINEA = 6;

const VALORES_MAXIMOS = 400;
const PATRON_ITEM = /^[\w.-]{1,30}$/;

/**
 * Lee una lista separada por `|` (los nombres de grupo o marca pueden traer
 * comas, nunca barras). Vacía devuelve null: "sin filtro", no "ninguno".
 * Va en un solo parámetro porque Express 4 (qs) convierte en objeto un arreglo
 * de más de 20 valores repetidos.
 */
export function leerLista(valor, patron = null) {
  const valores = [...new Set(String(valor ?? "").split("|").map((v) => v.trim()).filter(Boolean))]
    .filter((v) => !patron || patron.test(v))
    .slice(0, VALORES_MAXIMOS);
  return valores.length ? valores : null;
}

export function leerFiltros(query) {
  return {
    tienda: String(query.tienda || "").trim() || null,
    unidades: leerLista(query.unidades),
    grupos: leerLista(query.grupos),
    subgrupos: leerLista(query.subgrupos),
    proveedores: leerLista(query.proveedores),
    marcas: leerLista(query.marcas),
    items: leerLista(query.items, PATRON_ITEM),
  };
}

export function diasDelPeriodo({ desde, hasta }) {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;
}

export const granularidadDe = (periodo) => (diasDelPeriodo(periodo) <= DIAS_MAXIMOS_DIARIO ? "dia" : "mes");

export const conLineaPorItem = (items) => Boolean(items && items.length <= ITEMS_MAXIMOS_POR_LINEA);
