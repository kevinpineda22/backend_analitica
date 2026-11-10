/* Armado de las respuestas del informe de ventas diarias. */

import { MEDIDAS } from "./consultas.js";

const medidasDe = (fila, prefijo) => Object.fromEntries(
  MEDIDAS.map((medida) => [medida, Number(fila[`${prefijo}_${medida}`] || 0)]),
);

const sinMovimiento = (sede) => !sede.diasRecientes
  && Object.values(sede.bloques).every(({ actual, anterior }) => !actual.ventas && !anterior?.ventas);

/**
 * El corte por sede. `anterior` es null en una ventana sin año anterior en
 * los datos; en una sede sin ventas ese período, sus medidas son 0. Se
 * descartan las sedes sin un peso en ninguna ventana (cerradas hace tiempo).
 */
export function cuerpoCorte({ fecha, cobertura, ventanas, filas }) {
  const sedes = filas
    .map((fila) => ({
      codigo: fila.codigo,
      nombre: fila.nombre,
      diasRecientes: Number(fila.dias_recientes || 0),
      bloques: Object.fromEntries(ventanas.map((ventana) => [ventana.clave, {
        actual: medidasDe(fila, `${ventana.clave}_actual`),
        anterior: ventana.anterior ? medidasDe(fila, `${ventana.clave}_anterior`) : null,
      }])),
    }))
    .filter((sede) => !sinMovimiento(sede))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));

  return {
    fecha,
    datos: { desde: cobertura.desde, hasta: cobertura.hasta, actualizado: cobertura.actualizado ?? null },
    ventanas: ventanas.map(({ clave, desde, hasta, anterior }) => ({ clave, desde, hasta, anterior })),
    sedes,
  };
}

export const COLUMNAS_DIAS = Object.freeze(["fecha", ...MEDIDAS, "sedes"]);

/** Serie diaria como arreglo de arreglos (1.100 días son ~60 KB así). */
export function cuerpoDias({ periodo, tienda, filas }) {
  return {
    periodo,
    tienda: tienda || null,
    columnas: COLUMNAS_DIAS,
    filas: filas.map((fila) => COLUMNAS_DIAS.map((columna) => (columna === "fecha" ? fila.fecha : Number(fila[columna] || 0)))),
  };
}
