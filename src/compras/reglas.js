/* =============================================================================
   Reglas puras de Analítica de Compras

   Fuente: `merkahorro_siesa.compras_resumen_*` (ver
   docs/COMPRAS_MODELO_ANALITICO.md en el repo del front). El modelo guarda
   todos los tipos de documento con el monto en POSITIVO, como viene de SIESA;
   acá se decide qué cuenta y con qué signo:

     compras        = CEA (entradas de mercancía)
     devoluciones   = CDP
     ajuste de costo = CAE (llegó más caro) − CAS (llegó más barato)
     compras netas  = CEA − CDP + CAE − CAS

   DSE (otras compras) y los suministros (CAL, DSS…) quedan fuera del total:
   no son mercancía para la venta.

   El "menor costo" (CAS) se muestra: esta pantalla es interna, de compras. Al
   proveedor NUNCA (regla del portal de proveedores).
   ============================================================================= */

export const TIPOS = Object.freeze({ compras: "CEA", devoluciones: "CDP", ajusteMayor: "CAE", ajusteMenor: "CAS" });

export const TIPOS_DEL_TABLERO = Object.values(TIPOS);

const texto = (valor, maximo = 60) => {
  const limpio = String(valor ?? "").trim();
  return limpio && limpio.length <= maximo ? limpio : null;
};

/** Filtros opcionales. Un valor vacío o absurdo es null (= sin filtro). */
export function leerFiltros(query) {
  return {
    bodega: texto(query.bodega, 20),
    proveedor: texto(query.proveedor, 20),
    sucursal: query.proveedor ? texto(query.sucursal, 10) : null,
    grupo: texto(query.grupo, 80),
  };
}

/**
 * De qué tabla sale cada pieza según los filtros:
 * - Totales y serie: del diario (rápido) si no hay proveedor ni grupo, porque
 *   el diario solo tiene fecha, tipo y bodega. Si no, del resumen por ítem.
 * - Documentos (entradas, devoluciones): de la tabla de documentos. Con filtro
 *   de grupo NO se pueden contar: un documento trae ítems de varios grupos, y
 *   decir "N entradas del grupo X" sería inventar. Va null.
 */
export function fuentes(filtros) {
  const porItem = Boolean(filtros.proveedor || filtros.grupo);
  return {
    totales: porItem ? "item" : "diario",
    documentos: filtros.grupo ? null : "documentos",
  };
}

const n = (valor) => Number(valor || 0);

/** Totales del tablero a partir de las sumas por tipo (`{ CEA: {...}, CDP: {...} }`). */
export function armarTotales(porTipo, extras = {}) {
  const de = (tipo, campo = "subtotal") => n(porTipo?.[tipo]?.[campo]);
  const compras = de(TIPOS.compras);
  const devoluciones = de(TIPOS.devoluciones);
  const ajusteMayor = de(TIPOS.ajusteMayor);
  const ajusteMenor = de(TIPOS.ajusteMenor);
  return {
    compras,
    devoluciones,
    ajusteMayor,
    ajusteMenor,
    ajusteNeto: ajusteMayor - ajusteMenor,
    comprasNetas: compras - devoluciones + ajusteMayor - ajusteMenor,
    tasaDevolucion: compras ? devoluciones / compras : null,
    impuestos: de(TIPOS.compras, "impuestos"),
    unidades: de(TIPOS.compras, "unidades"),
    entradas: extras.entradas ?? null,
    documentosDevolucion: extras.documentosDevolucion ?? null,
    proveedores: extras.proveedores ?? null,
  };
}

/**
 * ¿El "año anterior" cae entero dentro de los datos?
 *
 * La cobertura arranca el primer día del MES del primer registro, no el primer
 * día con compras: los datos empiezan el 2025-01-02 porque el 1 de enero es
 * feriado y no hubo entradas, y comparar contra ese día dejaba a todo 2026
 * "sin base". La réplica se carga por meses.
 */
export function anteriorCompleto(anterior, primerDiaConDatos) {
  if (!primerDiaConDatos) return false;
  return anterior.desde >= `${String(primerDiaConDatos).slice(0, 7)}-01`;
}

/** Clave de un proveedor en el tablero: NIT y sucursal, porque son cuentas distintas en SIESA. */
export const codigoProveedor = (nit, sucursal) => (sucursal ? `${nit}-${sucursal}` : nit);
