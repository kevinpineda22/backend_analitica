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
 */
export function fuenteItems(columnas, extra = "") {
  return `
    SELECT ${columnas} FROM merkahorro_siesa.ventas_pdv_resumen_item_mensual
    WHERE mes >= $4::date AND mes < $5::date
      AND ($3::text IS NULL OR bodega = $3) ${extra}
    UNION ALL
    SELECT ${columnas} FROM merkahorro_siesa.ventas_pdv_resumen_item_diario
    WHERE ((fecha >= $1::date AND fecha < $4::date) OR (fecha >= $5::date AND fecha < $2::date + 1))
      AND ($3::text IS NULL OR bodega = $3) ${extra}`;
}

/** Parámetros $1..$5 de `fuenteItems`. */
export function parametrosItems(desde, hasta, tienda) {
  const { mesDesde, mesHasta } = tramosMensuales(desde, hasta);
  return [desde, hasta, tienda || null, mesDesde, mesHasta];
}
