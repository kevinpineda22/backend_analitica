/* =============================================================================
   Rangos grandes de Ventas POS: meses completos del agregado mensual + días
   sueltos del diario.

   `ventas_pdv_resumen_item_mensual` (ver scripts/create_pos_rollups.sql en el
   repo del front) tiene ~10× menos filas que `ventas_pdv_resumen_item_diario`
   y sin los arreglos de tickets y clientes. Un período se parte en:

     [desde, mesDesde)   días del diario (la punta inicial, si no arranca en día 1)
     [mesDesde, mesHasta) meses completos del mensual
     [mesHasta, hasta]   días del diario (la punta final, si no termina a fin de mes)

   Sin ningún mes completo, mesDesde = mesHasta = hasta + 1: todo sale del
   diario y el mensual no aporta filas.
   ============================================================================= */

const sumarDias = (fecha, dias) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const primeroDelMesSiguiente = (fecha) => {
  const d = new Date(`${fecha.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/** Meses completos dentro de [desde, hasta]: `{ mesDesde, mesHasta }` (el segundo exclusivo). */
export function tramosMensuales(desde, hasta) {
  const mesDesde = desde.endsWith("-01") ? desde : primeroDelMesSiguiente(desde);
  const despues = sumarDias(hasta, 1);
  const mesHasta = despues.endsWith("-01") ? despues : `${hasta.slice(0, 7)}-01`;
  if (mesDesde >= mesHasta) return { mesDesde: despues, mesHasta: despues };
  return { mesDesde, mesHasta };
}

/**
 * Filas por ítem del período, del mensual y del diario, con las columnas
 * pedidas. Usa $1 desde, $2 hasta, $3 tienda, $4 mesDesde, $5 mesHasta;
 * `extra` agrega condiciones con parámetros propios (p. ej. la unidad en $6).
 *
 * `base` corre la numeración, para usar la fuente dos veces en una consulta
 * (período y año anterior). `columnasDiario` sirve cuando una columna se llama
 * distinto en cada tabla (`mes` contra `fecha`).
 */
export function fuenteItems(columnas, extra = "", { base = 0, columnasDiario = columnas } = {}) {
  const [desde, hasta, tienda, mesDesde, mesHasta] = [1, 2, 3, 4, 5].map((n) => `$${n + base}`);
  return `
    SELECT ${columnas} FROM merkahorro_siesa.ventas_pdv_resumen_item_mensual
    WHERE mes >= ${mesDesde}::date AND mes < ${mesHasta}::date
      AND (${tienda}::text IS NULL OR bodega = ${tienda}) ${extra}
    UNION ALL
    SELECT ${columnasDiario} FROM merkahorro_siesa.ventas_pdv_resumen_item_diario
    WHERE ((fecha >= ${desde}::date AND fecha < ${mesDesde}::date) OR (fecha >= ${mesHasta}::date AND fecha < ${hasta}::date + 1))
      AND (${tienda}::text IS NULL OR bodega = ${tienda}) ${extra}`;
}

/** Parámetros $1..$5 de `fuenteItems`. */
export function parametrosItems(desde, hasta, tienda) {
  const { mesDesde, mesHasta } = tramosMensuales(desde, hasta);
  return [desde, hasta, tienda || null, mesDesde, mesHasta];
}
