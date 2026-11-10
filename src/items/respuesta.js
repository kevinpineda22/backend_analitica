/* Armado de las respuestas del análisis por ítem. */

const n = (valor) => Number(valor || 0);

/** Sin año anterior, null: un dato que no existe no es 0. */
const nulo = (valor) => (valor == null ? null : Number(valor));

/* La lista viaja como arreglo de arreglos: con 13 mil ítems, repetir los
   nombres de las columnas en cada fila casi duplica la respuesta. */
export const COLUMNAS_LISTA = [
  "item", "nombre", "unidad", "grupo", "subgrupo", "proveedor", "marca",
  "ventas", "costo", "contribucion", "unidades",
  "ventasAnterior", "contribucionAnterior", "unidadesAnterior",
];

export function cuerpoLista({ periodo, anterior, filas }) {
  return {
    periodo,
    anterior,
    columnas: COLUMNAS_LISTA,
    filas: filas.map((f) => [
      f.item, f.nombre, f.unidad, f.grupo, f.subgrupo, f.proveedor, f.marca,
      n(f.ventas), n(f.costo), n(f.contribucion), n(f.unidades),
      nulo(f.ventas_anterior), nulo(f.contribucion_anterior), nulo(f.unidades_anterior),
    ]),
  };
}

const medidas = (f) => ({ ventas: n(f.ventas), unidades: n(f.unidades), contribucion: n(f.contribucion) });
const fecha = (valor) => (valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10));

/** Separa las filas de GROUPING SETS: por período, por sede y por período e ítem. */
export function cuerpoEvolucion({ periodo, granularidad, filas }) {
  const serie = [];
  const sedes = [];
  const porItem = [];
  for (const fila of filas) {
    if (Number(fila.sin_periodo) === 0 && Number(fila.sin_item) === 0) {
      porItem.push({ periodo: fecha(fila.periodo), item: fila.item, ...medidas(fila) });
    } else if (Number(fila.sin_periodo) === 0) {
      serie.push({ periodo: fecha(fila.periodo), ...medidas(fila) });
    } else {
      sedes.push({ codigo: fila.bodega, ...medidas(fila) });
    }
  }
  serie.sort((a, b) => a.periodo.localeCompare(b.periodo));
  sedes.sort((a, b) => b.ventas - a.ventas);
  porItem.sort((a, b) => a.periodo.localeCompare(b.periodo));
  return { periodo, granularidad, serie, sedes, porItem };
}
