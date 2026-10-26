import { numero } from "../http.js";

export const UNIDADES_NEGOCIO = {
  "001": { nombre: "Abarrotes", unidad: "UND" },
  "002": { nombre: "Fruver", unidad: "KL" },
  "003": { nombre: "Carnes", unidad: "KL" },
};

export const CODIGOS_UNIDAD_NEGOCIO = Object.keys(UNIDADES_NEGOCIO);

/** Postgres devuelve SUM/COUNT como string: se pasan a número. */
export function normalizarValores(rows) {
  return (rows || []).map((row) => ({
    ...row,
    valor: numero(row.valor),
    ...(row.contribucion == null ? {} : { contribucion: numero(row.contribucion) }),
  }));
}

/** Las tres unidades de negocio siempre presentes, aunque no hayan vendido. */
export function unidadesNegocio(filas) {
  const porCodigo = new Map((filas || []).map((row) => [row.codigo, row]));
  return Object.entries(UNIDADES_NEGOCIO).map(([codigo, definicion]) => {
    const row = porCodigo.get(codigo) || {};
    const cantidad = numero(row.cantidad);
    const tickets = numero(row.tickets);
    return {
      codigo,
      ...definicion,
      ventas: numero(row.ventas),
      cantidad,
      tickets,
      promedio: tickets ? cantidad / tickets : 0,
    };
  });
}

/**
 * Cuerpo de `/resumen` con totales. El orden de las claves es el que el front
 * conoce desde siempre; `valorAnterior`/`variacion` van fijos porque la
 * comparación la arma el front con una segunda llamada.
 */
export function cuerpoResumen({
  periodo, metrica, serie, sedes,
  grupos, subgrupos, proveedores, marcas, productos,
  total, negocios, parcial,
}) {
  return {
    periodo,
    metrica,
    serie: normalizarValores(serie),
    sedes: normalizarValores(sedes),
    grupos: normalizarValores(grupos),
    subgrupos: normalizarValores(subgrupos),
    proveedores: normalizarValores(proveedores),
    marcas: normalizarValores(marcas),
    productos: normalizarValores(productos),
    valorActual: numero(total.valorActual),
    valorAnterior: 0,
    variacion: null,
    totalVentas: numero(total.totalVentas),
    totalContribucion: numero(total.totalContribucion),
    totalUnidades: numero(total.totalUnidades),
    totalImpuestos: numero(total.totalImpuestos),
    transacciones: numero(total.transacciones),
    clientesActivos: numero(total.clientesActivos),
    unidadesNegocio: unidadesNegocio(negocios),
    parcial,
  };
}

/** Cuerpo de `/resumen` para unidades/clientes/tickets/ticket promedio sin filtros: sin totales. */
export function cuerpoKpi({ periodo, metrica, analisis }) {
  return {
    periodo,
    metrica,
    serie: normalizarValores(analisis.serie),
    sedes: normalizarValores(analisis.sedes),
    grupos: normalizarValores(analisis.grupos),
    subgrupos: [],
    proveedores: [],
    marcas: [],
    productos: normalizarValores(analisis.productos),
    valorActual: numero(analisis.valorActual),
    valorAnterior: 0,
    variacion: null,
    parcial: false,
  };
}

export function normalizarNumerosBodega(row) {
  return {
    ...row,
    numDocumentos: numero(row.numDocumentos),
    totalCantidad: numero(row.totalCantidad),
    totalBruto: numero(row.totalBruto),
    totalImpuestos: numero(row.totalImpuestos),
    totalNeto: numero(row.totalNeto),
  };
}
