import { numero } from "../http.js";
import { armarTotales, codigoProveedor } from "./reglas.js";

/* Postgres devuelve SUM/COUNT como texto. Acá se pasan a número y se arma la
   forma que consume el front. */

const MONTOS = ["compras", "devoluciones", "ajusteNeto", "unidades", "valor", "lineas"];

function numeros(fila) {
  const copia = { ...fila };
  for (const campo of MONTOS) if (campo in copia) copia[campo] = numero(copia[campo]);
  return copia;
}

const conTasa = (fila) => ({ ...fila, tasaDevolucion: fila.compras ? fila.devoluciones / fila.compras : null });

const conteo = (valor) => (valor == null ? null : numero(valor));

export function cuerpoPeriodo(fila, { conRankings }) {
  const cuerpo = {
    total: armarTotales(fila.porTipo, {
      entradas: conteo(fila.conteos.entradas),
      documentosDevolucion: conteo(fila.conteos.documentosDevolucion),
      proveedores: conteo(fila.conteos.proveedores),
    }),
    serie: (fila.serie || []).map(numeros),
  };
  if (conRankings) {
    const r = fila.rankings;
    cuerpo.proveedores = r.proveedores.map((p) => conTasa(numeros({ codigo: codigoProveedor(p.nit, p.sucursal), ...p })));
    cuerpo.productos = r.productos.map((p) => conTasa(numeros(p)));
    cuerpo.grupos = r.grupos.map((g) => conTasa(numeros(g)));
    cuerpo.bodegas = r.bodegas.map((b) => conTasa(numeros(b)));
    cuerpo.motivos = r.motivos.map(numeros);
  }
  return cuerpo;
}
