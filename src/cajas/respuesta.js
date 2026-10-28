import { numero } from "../http.js";

/* Postgres devuelve SUM/COUNT/AVG como texto. Acá se pasan a número y se arma
   la forma que consume el front. */

const decimales = (valor, n = 1) => Number(numero(valor).toFixed(n));

export function cuerpoHistorico(fila) {
  return {
    total: {
      documentos: numero(fila.total.documentos),
      devoluciones: numero(fila.total.devoluciones),
      venta: numero(fila.total.venta),
      dias: numero(fila.total.dias),
      cajeras: numero(fila.total.cajeras),
    },
    mapa: fila.mapa.map((c) => ({
      diaSemana: c.diaSemana,
      hora: c.hora,
      documentos: decimales(c.documentos),
      venta: Math.round(numero(c.venta)),
      cajeras: decimales(c.cajeras),
    })),
    cajeras: fila.cajeras.map((c) => {
      const horas = numero(c.horas);
      const documentos = numero(c.documentos);
      return {
        cajera: c.cajera,
        bodega: c.bodega,
        documentos,
        devoluciones: numero(c.devoluciones),
        venta: numero(c.venta),
        dias: numero(c.dias),
        horas,
        documentosPorHora: horas ? decimales(documentos / horas) : null,
      };
    }),
    sedes: fila.sedes.map((s) => ({
      codigo: s.codigo,
      nombre: s.nombre,
      documentos: numero(s.documentos),
      venta: numero(s.venta),
      cajeras: numero(s.cajeras),
    })),
  };
}
