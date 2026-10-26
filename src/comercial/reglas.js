/* =============================================================================
   Reglas puras de Ventas Comerciales (CFE) y Mayoristas (VMF)

   Fuente: el modelo `merkahorro_siesa.ventas_comerciales_*`, que se arma desde
   `fac_comercial` (ver docs/VENTAS_COMERCIALES_MODELO_ANALITICO.md en el repo
   del front). `ventas` = subtotal antes de impuestos; contribución = subtotal
   − costo. Las notas crédito (CNC) no entran.
   ============================================================================= */

export const CANALES = ["CFE", "VMF"];

/** Canal de `/filtros` y `/resumen`. Vacío = CFE (el panel abre en comercial). Inválido = null. */
export function leerCanal(valor) {
  const canal = String(valor ?? "").trim().toUpperCase() || "CFE";
  return CANALES.includes(canal) ? canal : null;
}

/** Lista `CFE,VMF` de `/integracion-pos`. Sin repetidos. Algún canal inválido o vacía = null. */
export function leerCanales(valor) {
  const canales = [...new Set(String(valor ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!canales.length || canales.some((c) => !CANALES.includes(c))) return null;
  return canales;
}

/**
 * La misma fecha `cantidad` años antes o después, sin saltar de mes: 29-feb
 * pasa a 28-feb. GEMELO de `desplazarAnio` en
 * Pagina-web_React/src/power_bi/commercial/CommercialSales.jsx, que usa esta
 * regla para emparejar la serie actual con la del año anterior. Si difieren,
 * el gráfico compara días que no corresponden.
 */
export function desplazarAnio(fecha, cantidad = -1) {
  const [anio, mes, dia] = String(fecha).split("-").map(Number);
  const anioDestino = anio + cantidad;
  const ultimoDia = new Date(Date.UTC(anioDestino, mes, 0)).getUTCDate();
  return `${anioDestino}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

export const periodoAnterior = ({ desde, hasta }) => ({
  desde: desplazarAnio(desde),
  hasta: desplazarAnio(hasta),
});

/** Bodega opcional: texto corto sin espacios alrededor, o null. */
export function leerBodega(valor) {
  const bodega = String(valor ?? "").trim();
  return bodega && bodega.length <= 20 ? bodega : null;
}

/**
 * ¿Por qué NO sumar CFE/VMF a una consulta POS? null = se puede sumar.
 *
 * - Unidad de negocio: `fac_comercial` no trae una homologación validada.
 * - Tienda: las bodegas comerciales no coinciden con las tiendas POS. La misma
 *   sede aparece con dos códigos (PV003 y 00301 son Girardota Parque), así que
 *   filtrar por el código POS dejaría ventas de la sede afuera. Antes de
 *   mostrar una suma parcial como si fuera la de la tienda, no se suma.
 *
 * Grupo, subgrupo, proveedor y marca sí: salen de `dimitems` igual en los dos
 * modelos.
 */
export function motivoExclusionPos(query) {
  if (String(query.unidadNegocio ?? "").trim()) {
    return "las ventas comerciales no tienen unidad de negocio homologada.";
  }
  if (String(query.tienda ?? query.sede ?? "").trim()) {
    return "las bodegas comerciales no están homologadas con las tiendas POS.";
  }
  return null;
}

/** Filtros de dimensión de producto compartidos con POS. */
export function dimensionesPos(query) {
  const leer = (clave) => String(query[clave] ?? "").trim() || null;
  return {
    grupo: leer("grupo"),
    subgrupo: leer("subgrupo"),
    proveedor: leer("proveedor"),
    marca: leer("marca"),
  };
}
