/* =============================================================================
   Reglas puras de Analítica de Cajas

   Fuente: `merkahorro_siesa.ventas_pdv_resumen_cajeras`, una fila por fecha,
   sede, franja de 15 minutos, caja y cajera (ver docs/CAJAS_MODELO_ANALITICO.md
   en el repo del front). "Documentos" = facturas + devoluciones: las dos
   ocupan la caja.

   La caja sale del tipo de documento de SIESA (P03 → caja 03, Z01 → caja 01).
   Lo que no se puede identificar queda en SIN_CAJA, sobre todo los PFA…PFO de
   enero a mayo de 2024: por caja, los datos arrancan en junio de 2024.

   Esta API analiza cómo se comportan las cajas. La programación de cajeras es
   de otro panel: acá no se pronostica ni se recomienda cuántas poner.
   ============================================================================= */

export const MAX_DIAS_HISTORICO = 366;
export const SIN_CAJA = "SIN_CAJA";
/** Desde cuándo la caja se identifica en (casi) todos los documentos. */
export const CAJAS_DESDE = "2024-06-01";

const DIA_MS = 86400000;
const restar = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);

/** Bodega opcional: texto corto, o null. */
export function leerBodega(valor) {
  const bodega = String(valor ?? "").trim();
  return bodega && bodega.length <= 20 ? bodega : null;
}

/**
 * Caja opcional: "3", "03" → "03"; "SIN_CAJA" tal cual. Solo tiene sentido
 * con una sede (la caja 3 existe en casi todas), así que sin bodega es null.
 */
export function leerCaja(valor, bodega) {
  if (!bodega) return null;
  const caja = String(valor ?? "").trim().toUpperCase();
  if (caja === SIN_CAJA) return SIN_CAJA;
  return /^\d{1,2}$/.test(caja) ? caja.padStart(2, "0") : null;
}

/** ¿El rango es aceptable para `/historico`? Devuelve el motivo si no. */
export function motivoRangoInvalido({ desde, hasta }, maximo = MAX_DIAS_HISTORICO) {
  if (restar(hasta, desde) + 1 > maximo) return `El periodo admite hasta ${maximo} dias.`;
  return null;
}
