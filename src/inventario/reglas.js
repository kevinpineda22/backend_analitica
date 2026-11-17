/* Reglas puras de la pestaña Inventario. */

/** Días de venta para los días de inventario: 4 semanas exactas, sin sesgo de día de la semana. */
export const DIAS_VENTA = 28;

export const leerFecha = (valor) => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || "")) ? String(valor) : null);

const sumarDias = (fecha, dias) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * La venta que se compara con una foto: los 28 días que terminan el día
 * anterior a la foto (la foto se toma de madrugada, con ese día cerrado), o
 * el último día con ventas cargadas si es anterior.
 */
export function ventanaVenta(fechaFoto, ultimoDiaVenta) {
  const diaAnterior = sumarDias(fechaFoto, -1);
  const hasta = ultimoDiaVenta && ultimoDiaVenta < diaAnterior ? ultimoDiaVenta : diaAnterior;
  return { desde: sumarDias(hasta, -(DIAS_VENTA - 1)), hasta, dias: DIAS_VENTA };
}

const redondear = (valor, decimales = 0) => {
  const factor = 10 ** decimales;
  return Math.round((Number(valor) || 0) * factor) / factor;
};

export const COLUMNAS = Object.freeze([
  "sede", "item", "existencia", "pos", "valor", "costoTotal", "ventas", "costoVenta", "unidades", "ultima",
]);
export const COLUMNAS_ITEM = Object.freeze(["item", "descripcion", "grupo", "subgrupo", "proveedor", "marca", "unidad"]);

/** Respuesta compacta: filas como arreglos y el maestro de ítems una sola vez. */
export function cuerpoInventario({ foto, fotos, ventana, filas, items, serie, nombres, residuo }) {
  return {
    fecha: foto.fecha,
    tomadoEn: foto.tomadoEn,
    fechas: fotos.map((f) => f.fecha),
    ventana,
    residuo: redondear(residuo?.residuo),
    posPendiente: redondear(residuo?.pos, 3),
    sedes: Object.fromEntries(nombres.map((n) => [n.sede, n.nombre])),
    columnas: COLUMNAS,
    filas: filas.map((f) => [
      f.sede, f.item, redondear(f.existencia, 3), redondear(f.pos, 3), redondear(f.valor), redondear(f.costo_total),
      redondear(f.ventas), redondear(f.costo_venta), redondear(f.unidades, 3), f.ultima,
    ]),
    columnasItem: COLUMNAS_ITEM,
    items: items.map((i) => COLUMNAS_ITEM.map((c) => i[c] ?? null)),
    serie: serie.map((s) => [s.fecha, s.sede, redondear(s.valor)]),
  };
}
