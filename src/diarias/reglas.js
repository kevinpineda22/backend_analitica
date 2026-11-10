/* Reglas del informe de ventas diarias: qué período se compara contra cuál.
   Sin base de datos, para probarlas solas. */

/**
 * Sedes que cambiaron de código. El código viejo se suma al nuevo: sin esto,
 * comparar contra 2024 parte Carnes Barbosa (PV005 → 00501, 2024-07-31) y
 * Villahermosa (PV002 → 00201, 2024-01-13) en dos sedes sin historia.
 */
export const SEDES_EQUIVALENTES = Object.freeze({ PV005: "00501", PV002: "00201" });

/** Expresión SQL con el código de sede ya unificado. */
export function sedeNormalizada(columna = "bodega") {
  const casos = Object.entries(SEDES_EQUIVALENTES)
    .map(([viejo, nuevo]) => `WHEN '${viejo}' THEN '${nuevo}'`)
    .join(" ");
  return `(CASE ${columna} ${casos} ELSE ${columna} END)`;
}

/** Un año en semanas exactas: el mismo día de la semana del año anterior. */
export const DIAS_SEMANA_EQUIVALENTE = 364;

/** Tope de días para la serie diaria (tres años). */
export const DIAS_MAXIMOS_SERIE = 1100;

/** Días hacia atrás para saber si una sede está operando. */
export const DIAS_RECIENTES = 28;

const comoFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const comoTexto = (fecha) => fecha.toISOString().slice(0, 10);

export function sumarDias(fecha, dias) {
  const resultado = comoFecha(fecha);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return comoTexto(resultado);
}

export const diasEntre = (desde, hasta) => Math.round((comoFecha(hasta) - comoFecha(desde)) / 86_400_000) + 1;

/** La misma fecha un año antes. El 29 de febrero cae en el 28. */
export function unAnioAntes(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anio - 1, mes, 0)).getUTCDate();
  return `${anio - 1}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

/** Lunes de la semana de `fecha` (semanas de lunes a domingo). */
export function lunesDe(fecha) {
  const diaSemana = comoFecha(fecha).getUTCDay();
  return sumarDias(fecha, -((diaSemana + 6) % 7));
}

/**
 * Los cuatro cortes del informe hasta `fecha`, cada uno con su base del año
 * anterior. Día y semana van contra los mismos días de la semana (domingo
 * contra domingo); mes y año, contra las mismas fechas del calendario. Si la
 * base cae antes del primer dato, `anterior` es null: no se compara.
 */
export function ventanasDelCorte(fecha, datosDesde) {
  const porSemana = (desde) => ({
    desde: sumarDias(desde, -DIAS_SEMANA_EQUIVALENTE),
    hasta: sumarDias(fecha, -DIAS_SEMANA_EQUIVALENTE),
  });
  const porCalendario = (desde) => ({ desde: unAnioAntes(desde), hasta: unAnioAntes(fecha) });
  const ventana = (clave, desde, anterior) => ({
    clave, desde, hasta: fecha, anterior: anterior.desde >= datosDesde ? anterior : null,
  });
  const lunes = lunesDe(fecha);
  const primeroDelMes = `${fecha.slice(0, 7)}-01`;
  const primeroDelAnio = `${fecha.slice(0, 4)}-01-01`;
  return [
    ventana("dia", fecha, porSemana(fecha)),
    ventana("semana", lunes, porSemana(lunes)),
    ventana("mes", primeroDelMes, porCalendario(primeroDelMes)),
    ventana("anio", primeroDelAnio, porCalendario(primeroDelAnio)),
  ];
}

/** Código de sede del query, o null si no parece uno. */
export function leerTienda(valor) {
  const texto = String(valor || "").trim();
  return /^[\w-]{1,12}$/.test(texto) ? texto : null;
}
