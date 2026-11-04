/* =============================================================================
   ¿De qué tabla sale un /resumen?

   Las tablas `ventas_pdv_resumen_*` (las refresca el workflow
   `postgrest_post.yml` del repo del front) responden en milisegundos; la
   transaccional `ventas_pdv_detalle` puede tardar segundos. Esta regla elige la
   más barata que tenga lo que la consulta necesita.

   - `negocio-filtrado`: el único filtro (además de la tienda) es la unidad
     de negocio. Sirve todas las métricas desde los resúmenes por unidad.
   - `item-filtrado`: hay filtro por dimensión y la métrica se puede sumar
     por ítem. Clientes y tickets NO: un mismo ticket o cliente aparece en
     varios ítems, y sumar los contaría dos veces.
   - `diario-rapido`: la primera carga del tablero (`rapido=1`) de pesos o
     contribución.
   - `diario-detalle`: pesos o contribución completos, con top 15.
   - `kpi-diario`: el resto de métricas sin filtros.
   - `transaccional`: lo que no tiene resumen (p. ej. tickets con filtro, o
     unidades con `rapido=1`).

   La contribución rápida salía de la transaccional (8–36 s sin CDN). Se pasó al
   resumen el 2026-10-26, después de verificar que coinciden al centavo en todo
   el histórico. Esa igualdad la sostiene la reconciliación diaria del workflow
   (`scripts/reconcile_powerbi_summary.js` en el repo del front): si el resumen
   se atrasa, la carga rápida y la completa mostrarían el mismo número, pero
   ese número estaría mal.
   ============================================================================= */

const SUMABLES_POR_ITEM = ["pesos", "contribucion", "unidades"];
const DIARIAS = ["pesos", "contribucion"];

/**
 * @param {boolean} conFiltros  Hay filtro de unidad, grupo, subgrupo, proveedor o marca.
 * @param {boolean} soloUnidad  El único de esos filtros es la unidad de negocio:
 *   sale de `negocio_diario` + `negocio_clientes` para CUALQUIER métrica
 *   (2026-11-04: Abarrotes en 2024 tardaba 83 s desde los arreglos por ítem).
 */
export function elegirFuente({ metrica, rapido, conFiltros, soloUnidad = false }) {
  if (soloUnidad) return "negocio-filtrado";
  if (conFiltros) {
    return SUMABLES_POR_ITEM.includes(metrica) ? "item-filtrado" : "transaccional";
  }
  if (rapido) return DIARIAS.includes(metrica) ? "diario-rapido" : "transaccional";
  if (DIARIAS.includes(metrica)) return "diario-detalle";
  return "kpi-diario";
}

/** Valor del header `X-Analytics-Source` (lo leen los diagnósticos, no el front). */
export const HEADER_FUENTE = {
  "negocio-filtrado": "resumen-negocio-filtrado",
  "item-filtrado": "resumen-item-filtrado",
  "diario-rapido": "resumen-diario",
  "diario-detalle": "resumen-diario",
  "kpi-diario": "resumen-diario-kpi",
  transaccional: "transaccional",
};
