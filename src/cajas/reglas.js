/* =============================================================================
   Reglas puras de Analítica de Cajas

   Fuente: `merkahorro_siesa.ventas_pdv_resumen_cajeras`, una fila por fecha,
   sede, franja de 15 minutos y cajera (ver docs/CAJAS_MODELO_ANALITICO.md en
   el repo del front). "Documentos" = facturas + devoluciones: las dos ocupan
   a la cajera.

   PRONÓSTICO POR MEZCLA (elegido con un backtest del 1-sep al 25-oct-2026,
   facturas por sede y hora):

     semanas = promedio de los 4 últimos mismos días de la semana con datos
     año     = mismo día de la semana hace 52 semanas × tendencia
     mezcla  = (semanas + año) / 2                          → error 14,8 %

   La misma FECHA del año pasado erraba un 36,5 %: cae en otro día de la semana.

   El pronóstico de un día usa solo lo que se sabía la víspera (o el último día
   cargado, si es futuro). Así un día pasado se puede comparar contra lo real
   sin hacer trampa.

   CAJERAS NECESARIAS = ⌈ esperado × (1 + margen) ÷ capacidad ⌉, mínimo 1 con
   la sede abierta. La capacidad es lo que de verdad atiende una cajera por
   franja cuando hay presión: el promedio en el 20 % de franjas más cargadas de
   las últimas 8 semanas de esa sede.
   ============================================================================= */

export const SEMANAS_REFERENCIA = 4;
export const DIAS_TENDENCIA = 28;
export const DIAS_CAPACIDAD = 56;
export const MARGEN = 0.15;
export const MAX_DIAS_PRONOSTICO = 14;
/* Una tendencia fuera de este rango no es "venimos vendiendo más": es una sede
   que abrió o cerró en la ventana. Ahí el año pasado no sirve y se usa solo
   el promedio de semanas. */
export const TENDENCIA_VALIDA = Object.freeze({ min: 0.5, max: 2 });

const DIA_MS = 86400000;
export const sumarDias = (fecha, dias) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
const restar = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);
/** 1 = lunes … 7 = domingo. */
export const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7;

/** Bodega obligatoria del pronóstico: texto corto, o null. */
export function leerBodega(valor) {
  const bodega = String(valor ?? "").trim();
  return bodega && bodega.length <= 20 ? bodega : null;
}

export const MAX_DIAS_HISTORICO = 366;

/** ¿El rango es aceptable para `/pronostico` o `/historico`? Devuelve el motivo si no. */
export function motivoRangoInvalido({ desde, hasta }, maximo = MAX_DIAS_PRONOSTICO) {
  if (restar(hasta, desde) + 1 > maximo) return `El periodo admite hasta ${maximo} dias.`;
  return null;
}

/** Hasta dónde sabía el pronóstico de `fecha`: la víspera, sin pasar del último día cargado. */
export const fechaCorte = (fecha, ultimoDia) => (sumarDias(fecha, -1) < ultimoDia ? sumarDias(fecha, -1) : ultimoDia);

/**
 * Ventanas de fechas que necesita el pronóstico de [desde, hasta] para traer
 * de la base en una sola consulta: lo reciente (semanas + tendencia) y lo de
 * hace un año.
 */
export function ventanasNecesarias({ desde, hasta }, ultimoDia) {
  const corteMin = fechaCorte(desde, ultimoDia);
  const corteMax = fechaCorte(hasta, ultimoDia);
  // Hasta 8 semanas atrás, por si alguno de los 4 mismos días no tuvo ventas.
  const recienteDesde = sumarDias(corteMin, -Math.max(SEMANAS_REFERENCIA * 14, DIAS_TENDENCIA));
  return {
    reciente: { desde: recienteDesde, hasta: hasta > corteMax ? hasta : corteMax },
    anioPasado: { desde: sumarDias(corteMin, -364 - DIAS_TENDENCIA), hasta: sumarDias(hasta, -364) },
  };
}

/** Índice `fecha → franja → { documentos, cajeras }` y total por fecha. */
export function indexar(filas) {
  const porFecha = new Map();
  for (const fila of filas) {
    let dia = porFecha.get(fila.fecha);
    if (!dia) porFecha.set(fila.fecha, (dia = { total: 0, franjas: new Map() }));
    const documentos = Number(fila.documentos || 0);
    dia.total += documentos;
    dia.franjas.set(fila.franja, { documentos, cajeras: Number(fila.cajeras || 0) });
  }
  return porFecha;
}

const totalEntre = (indice, desde, hasta) => {
  let total = 0;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) total += indice.get(f)?.total ?? 0;
  return total;
};

/** Ventas de las últimas 4 semanas ÷ las mismas 4 semanas del año pasado, o null si no sirve. */
export function tendencia(indice, corte) {
  const desde = sumarDias(corte, -(DIAS_TENDENCIA - 1));
  const actual = totalEntre(indice, desde, corte);
  const anterior = totalEntre(indice, sumarDias(desde, -364), sumarDias(corte, -364));
  if (!actual || !anterior) return null;
  const razon = actual / anterior;
  return razon >= TENDENCIA_VALIDA.min && razon <= TENDENCIA_VALIDA.max ? razon : null;
}

/** Los 4 últimos mismos días de la semana con ventas, hasta `corte` inclusive. */
export function semanasReferencia(indice, fecha, corte) {
  const fechas = [];
  let f = sumarDias(fecha, -7);
  while (f > corte) f = sumarDias(f, -7);
  for (let intentos = 0; fechas.length < SEMANAS_REFERENCIA && intentos < SEMANAS_REFERENCIA * 2; intentos += 1) {
    if (indice.get(f)?.total) fechas.push(f);
    f = sumarDias(f, -7);
  }
  return fechas;
}

export function cajerasNecesarias(esperado, capacidad, margen = MARGEN) {
  if (!(esperado > 0) || !(capacidad > 0)) return 0;
  return Math.max(1, Math.ceil((esperado * (1 + margen)) / capacidad));
}

const redondear = (valor, decimales = 1) => (valor == null ? null : Number(valor.toFixed(decimales)));

/**
 * Pronóstico de UNA sede, día por día y franja por franja.
 *
 * @param {{ desde: string, hasta: string }} periodo
 * @param {{ fecha: string, franja: string, documentos: number|string, cajeras: number|string }[]} filas
 * @param {{ ultimoDia: string, capacidad: number|null, margen?: number }} contexto
 */
export function pronosticar(periodo, filas, { ultimoDia, capacidad, margen = MARGEN }) {
  const indice = indexar(filas);
  const dias = [];
  for (let fecha = periodo.desde; fecha <= periodo.hasta; fecha = sumarDias(fecha, 1)) {
    const corte = fechaCorte(fecha, ultimoDia);
    const semanas = semanasReferencia(indice, fecha, corte);
    const fechaAnio = sumarDias(fecha, -364);
    const razon = tendencia(indice, corte);
    const anio = razon != null && indice.get(fechaAnio)?.total ? indice.get(fechaAnio) : null;
    const real = fecha <= ultimoDia ? indice.get(fecha) ?? null : null;

    // Las franjas del día: las que tuvieron ventas en alguna referencia o en lo real.
    const franjas = new Set();
    for (const f of semanas) for (const franja of indice.get(f).franjas.keys()) franjas.add(franja);
    if (anio) for (const franja of anio.franjas.keys()) franjas.add(franja);
    if (real) for (const franja of real.franjas.keys()) franjas.add(franja);

    const detalle = [...franjas].sort().map((franja) => {
      const porSemanas = semanas.length
        ? semanas.reduce((suma, f) => suma + (indice.get(f).franjas.get(franja)?.documentos ?? 0), 0) / semanas.length
        : null;
      const porAnio = anio ? (anio.franjas.get(franja)?.documentos ?? 0) * razon : null;
      const partes = [porSemanas, porAnio].filter((v) => v != null);
      const esperado = partes.length ? partes.reduce((a, b) => a + b, 0) / partes.length : null;
      const enReal = real?.franjas.get(franja);
      return {
        franja,
        esperado: redondear(esperado),
        semanas: redondear(porSemanas),
        anioPasado: redondear(porAnio),
        cajerasNecesarias: esperado == null ? null : cajerasNecesarias(esperado, capacidad, margen),
        real: real ? enReal?.documentos ?? 0 : null,
        cajerasReales: real ? enReal?.cajeras ?? 0 : null,
      };
    });

    const suma = (campo) => detalle.reduce((total, f) => total + (f[campo] ?? 0), 0);
    dias.push({
      fecha,
      diaSemana: diaSemana(fecha),
      metodo: anio && semanas.length ? "mezcla" : semanas.length ? "semanas" : anio ? "anio" : null,
      referencias: { semanas, anioPasado: anio ? fechaAnio : null, tendencia: redondear(razon, 3) },
      esperado: redondear(suma("esperado")),
      real: real ? real.total : null,
      picoCajerasNecesarias: Math.max(0, ...detalle.map((f) => f.cajerasNecesarias ?? 0)),
      picoCajerasReales: real ? Math.max(0, ...detalle.map((f) => f.cajerasReales ?? 0)) : null,
      franjas: detalle,
    });
  }
  return dias;
}
