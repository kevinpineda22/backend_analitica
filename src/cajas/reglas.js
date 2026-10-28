/* =============================================================================
   Reglas puras de Analítica de Cajas

   Fuente: `merkahorro_siesa.ventas_pdv_resumen_cajeras`, una fila por fecha,
   sede, franja de 15 minutos y cajera (ver docs/CAJAS_MODELO_ANALITICO.md en
   el repo del front). "Documentos" = facturas + devoluciones: las dos ocupan
   a la cajera.

   Esta API analiza cómo se comportan las cajas. La programación de cajeras es
   de otro panel: acá no se pronostica ni se recomienda cuántas poner.
   ============================================================================= */

export const MAX_DIAS_HISTORICO = 366;

const DIA_MS = 86400000;
const restar = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);

/** Bodega opcional: texto corto, o null. */
export function leerBodega(valor) {
  const bodega = String(valor ?? "").trim();
  return bodega && bodega.length <= 20 ? bodega : null;
}

/** ¿El rango es aceptable para `/historico`? Devuelve el motivo si no. */
export function motivoRangoInvalido({ desde, hasta }, maximo = MAX_DIAS_HISTORICO) {
  if (restar(hasta, desde) + 1 > maximo) return `El periodo admite hasta ${maximo} dias.`;
  return null;
}
