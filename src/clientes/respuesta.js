/* Arma la respuesta de /segmentos: filas compactas (arreglos) porque son
   ~33 mil clientes; la pantalla arma la matriz y la lista con ellas. */

import { segmentar } from "./segmentos.js";

export const COLUMNAS = Object.freeze([
  "cliente", "nombre", "segmento", "recencia", "ventas", "costo", "tickets",
  "meses", "ultima", "dias", "sedePrincipal", "sedes", "segmentoAnterior",
]);

const redondear = (valor) => Math.round(valor);

export function cuerpoSegmentos({ mes, ventana, anterior, filas, filasAnteriores, mesesDisponibles }) {
  const actual = segmentar(filas, ventana.hasta);
  // El segmento del mismo cliente 12 meses antes: null = no compró (o fue anónimo).
  const previo = filasAnteriores ? segmentar(filasAnteriores, anterior.hasta) : null;
  const segmentoAnterior = new Map(previo ? previo.clientes.map((c) => [c.cliente, c.segmento]) : []);

  const clientes = actual.clientes.map((c) => [
    c.cliente, c.nombre || "", c.segmento, c.recencia, redondear(c.ventas), redondear(c.costo), c.tickets,
    c.meses, c.ultima, c.dias, c.sede_principal, c.sedes, previo ? segmentoAnterior.get(c.cliente) ?? null : undefined,
  ].map((valor) => (valor === undefined ? null : valor)));

  const resumenAnterior = previo && {
    periodo: { desde: anterior.desde, hasta: anterior.hasta },
    porSegmento: contarPorSegmento(previo.clientes),
    anonimo: previo.anonimo,
  };

  return {
    mes,
    periodo: { desde: ventana.desde, hasta: ventana.hasta },
    mesesDisponibles,
    umbralAtipico: actual.umbralAtipico == null ? null : redondear(actual.umbralAtipico),
    anonimo: { ventas: redondear(actual.anonimo.ventas), costo: redondear(actual.anonimo.costo), tickets: actual.anonimo.tickets },
    sinCompraNeta: actual.sinCompraNeta,
    anterior: resumenAnterior || null,
    columnas: COLUMNAS,
    clientes,
  };
}

function contarPorSegmento(clientes) {
  const resultado = {};
  for (const c of clientes) {
    const actual = resultado[c.segmento] || { clientes: 0, ventas: 0 };
    actual.clientes += 1;
    actual.ventas += c.ventas;
    resultado[c.segmento] = actual;
  }
  for (const clave of Object.keys(resultado)) resultado[clave].ventas = redondear(resultado[clave].ventas);
  return resultado;
}
