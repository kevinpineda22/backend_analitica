/* Reglas del análisis por categoría (árbol de ventas). Sin base de datos. */

/** Dimensiones del agregado `ventas_pdv_resumen_dimension_mensual` y su columna en el diario. */
export const COLUMNA_DIMENSION = Object.freeze({
  unidad: "unidad_negocio",
  grupo: "grupo",
  subgrupo: "subgrupo",
  proveedor: "proveedor",
  marca: "marca",
});

export const DIMENSIONES = Object.freeze(Object.keys(COLUMNA_DIMENSION));

export const leerDimension = (valor) => (DIMENSIONES.includes(String(valor)) ? String(valor) : null);

/** Expresión SQL con el valor de la dimensión `$n` en una fila del diario. */
export function valorDimension(parametro) {
  const casos = Object.entries(COLUMNA_DIMENSION)
    .map(([dimension, columna]) => `WHEN '${dimension}' THEN ${columna}`)
    .join(" ");
  return `COALESCE(CASE ${parametro} ${casos} END, 'Sin dato')`;
}

/**
 * ¿El agregado mensual cubre los meses completos que se van a leer? Sin esto,
 * un agregado vacío o atrasado devolvería ceros que parecen datos.
 * @param {{ mesDesde: string, mesHasta: string }} tramo  mesHasta exclusivo
 * @param {{ desde: string|null, hasta: string|null }} cobertura  primer y último mes cargados
 */
export function tramoCubierto(tramo, cobertura) {
  if (tramo.mesDesde >= tramo.mesHasta) return true; // no lee meses: todo sale del diario
  if (!cobertura?.desde || !cobertura?.hasta) return false;
  const ultimoMes = new Date(`${tramo.mesHasta}T00:00:00Z`);
  ultimoMes.setUTCMonth(ultimoMes.getUTCMonth() - 1);
  return tramo.mesDesde >= cobertura.desde && ultimoMes.toISOString().slice(0, 10) <= cobertura.hasta;
}
