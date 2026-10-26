import { numero } from "../http.js";

/* Postgres devuelve SUM/COUNT como texto (numeric/bigint). Acá se pasan a
   número, y se garantiza que cada lista exista aunque la consulta no la trajo. */

const CAMPOS_TOTAL = ["ventas", "contribucion", "documentos", "clientes", "unidades", "pesoKg"];
const CAMPOS_FILA = ["ventas", "documentos", "unidades", "contribucion"];

export function normalizarTotal(total) {
  return Object.fromEntries(CAMPOS_TOTAL.map((campo) => [campo, numero(total?.[campo])]));
}

export function normalizarFilas(filas) {
  return (filas || []).map((fila) => {
    const copia = { ...fila };
    for (const campo of CAMPOS_FILA) {
      if (campo in copia) copia[campo] = numero(copia[campo]);
    }
    return copia;
  });
}

/** `actual` completo (con rankings) o `anterior` (solo total y serie). */
export function cuerpoPeriodo(fila, { conRankings }) {
  const cuerpo = {
    total: normalizarTotal(fila?.total),
    serie: normalizarFilas(fila?.serie),
  };
  if (conRankings) {
    for (const lista of ["bodegas", "vendedores", "clientes", "productos"]) {
      cuerpo[lista] = normalizarFilas(fila?.[lista]);
    }
  }
  return cuerpo;
}

/** Respuesta de `/integracion-pos`: totales calculados desde la serie diaria. */
export function cuerpoIntegracion(canales, filas) {
  const serie = normalizarFilas(filas);
  return {
    canales,
    ventas: serie.reduce((suma, fila) => suma + fila.ventas, 0),
    contribucion: serie.reduce((suma, fila) => suma + fila.contribucion, 0),
    serie,
  };
}
