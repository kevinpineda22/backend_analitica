/* Armado de la respuesta del análisis por categoría. */

export const COLUMNAS_CATEGORIAS = Object.freeze([
  "valor", "ventas", "costo", "contribucion", "unidades", "tickets",
  "ventasAnterior", "costoAnterior", "contribucionAnterior", "unidadesAnterior", "ticketsAnterior",
]);

const CAMPOS = [
  "valor", "ventas", "costo", "contribucion", "unidades", "tickets",
  "ventas_anterior", "costo_anterior", "contribucion_anterior", "unidades_anterior", "tickets_anterior",
];

const numeroONulo = (valor) => (valor == null ? null : Number(valor));

const medidas = (fila) => (fila ? {
  ventas: Number(fila.ventas || 0),
  costo: Number(fila.costo || 0),
  contribucion: Number(fila.contribucion || 0),
  unidades: Number(fila.unidades || 0),
  tickets: Number(fila.tickets || 0),
} : null);

/** Filas como arreglos (un año de marcas son ~1.100 filas). Sin año anterior, esas columnas van null. */
export function cuerpoCategorias({ periodo, anterior, dimension, totales, filas }) {
  return {
    periodo,
    anterior,
    dimension,
    totales: { actual: medidas(totales.actual), anterior: anterior ? medidas(totales.anterior) : null },
    columnas: COLUMNAS_CATEGORIAS,
    filas: filas
      .map((fila) => CAMPOS.map((campo, indice) => (indice === 0 ? fila[campo] : numeroONulo(fila[campo]))))
      .sort((a, b) => b[1] - a[1]),
  };
}
