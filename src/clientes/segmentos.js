/* =============================================================================
   Segmentación de clientes: reglas puras, sin base de datos.

   Definición aprobada el 2026-11-11, sobre los 12 meses cerrados:
     1. Consumidor final ('222222222222') y 'Sin dato' quedan aparte: no son
        un cliente, son la venta sin identificar (~61 % de la venta en 2026).
     2. Atípicos: ticket promedio por encima del percentil 99 de los clientes
        identificados. Son instituciones y revendedores (comunidades, SAS):
        compran 0,7–1,2 M por ticket y torcerían la curva de los hogares.
     3. A, B, C por Pareto sobre el resto: A suma el primer 80 % de la venta,
        B el 15 % siguiente y C el último 5 %.
     4. Recencia al último día del período: activo ≤ 30 días, en riesgo
        31–90, dormido 91–180 y perdido más de 180.
   Un cliente con venta neta ≤ 0 (devolvió más de lo que compró) no entra.
   ============================================================================= */

export const CLIENTES_ANONIMOS = Object.freeze(new Set(["222222222222", "Sin dato"]));
export const CORTE_A = 0.8;
export const CORTE_B = 0.95;
export const PERCENTIL_ATIPICO = 0.99;

export const RECENCIAS = Object.freeze([
  { clave: "activo", hasta: 30 },
  { clave: "riesgo", hasta: 90 },
  { clave: "dormido", hasta: 180 },
  { clave: "perdido", hasta: Infinity },
]);

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const comoFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const comoTexto = (fecha) => fecha.toISOString().slice(0, 10);

/** "2026-10" si es un mes válido; si no, null. */
export const leerMes = (valor) => (MES.test(String(valor || "")) ? String(valor) : null);

/** Primer día del mes `mes` corrido `meses` meses. */
export function correrMes(mes, meses) {
  const fecha = comoFecha(`${mes}-01`);
  fecha.setUTCMonth(fecha.getUTCMonth() + meses);
  return comoTexto(fecha).slice(0, 7);
}

/**
 * Los 12 meses que terminan en `mes` (incluido).
 * @returns {{ mesDesde: string, mesHasta: string, desde: string, hasta: string }} mesHasta exclusivo
 */
export function ventanaAnual(mes) {
  const mesDesde = `${correrMes(mes, -11)}-01`;
  const mesHasta = `${correrMes(mes, 1)}-01`;
  const hasta = comoFecha(mesHasta);
  hasta.setUTCDate(0);
  return { mesDesde, mesHasta, desde: mesDesde, hasta: comoTexto(hasta) };
}

/** Último mes cerrado según el último día con ventas cargado. */
export function ultimoMesCerrado(ultimoDia) {
  const siguiente = comoFecha(ultimoDia);
  siguiente.setUTCDate(siguiente.getUTCDate() + 1);
  const mes = ultimoDia.slice(0, 7);
  return siguiente.getUTCDate() === 1 ? mes : correrMes(mes, -1);
}

/** Meses que se pueden pedir: los que tienen sus 12 meses cargados. */
export function mesesDisponibles(cobertura, ultimoCerrado) {
  if (!cobertura?.desde || !ultimoCerrado) return [];
  const primero = correrMes(cobertura.desde.slice(0, 7), 11);
  const ultimo = cobertura.hasta.slice(0, 7) < ultimoCerrado ? cobertura.hasta.slice(0, 7) : ultimoCerrado;
  const meses = [];
  for (let mes = ultimo; mes >= primero; mes = correrMes(mes, -1)) meses.push(mes);
  return meses;
}

export const diasDesde = (fecha, fin) => Math.round((comoFecha(fin) - comoFecha(fecha)) / 86_400_000);

export function recenciaDe(dias) {
  return RECENCIAS.find((r) => dias <= r.hasta).clave;
}

/** Percentil por rango más cercano (el valor que deja `p` de los datos a su izquierda). */
export function percentil(valores, p) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.max(0, Math.ceil(p * orden.length) - 1)];
}

/**
 * Asigna segmento y recencia.
 * @param {Array<{cliente, ventas, costo, tickets, ultima}>} filas una por cliente, numéricas
 * @param {string} fin último día del período (YYYY-MM-DD)
 */
export function segmentar(filas, fin) {
  const anonimo = { ventas: 0, costo: 0, tickets: 0 };
  let sinCompraNeta = 0;
  const identificados = [];
  for (const fila of filas) {
    if (CLIENTES_ANONIMOS.has(fila.cliente)) {
      anonimo.ventas += fila.ventas;
      anonimo.costo += fila.costo;
      anonimo.tickets += fila.tickets;
    } else if (fila.ventas > 0 && fila.tickets > 0) {
      identificados.push(fila);
    } else {
      sinCompraNeta += 1;
    }
  }

  const umbralAtipico = percentil(identificados.map((f) => f.ventas / f.tickets), PERCENTIL_ATIPICO);
  const esAtipico = (f) => umbralAtipico != null && f.ventas / f.tickets > umbralAtipico;

  const segmento = new Map();
  const resto = identificados.filter((f) => {
    if (!esAtipico(f)) return true;
    segmento.set(f.cliente, "atipico");
    return false;
  }).sort((a, b) => b.ventas - a.ventas || a.cliente.localeCompare(b.cliente));
  const total = resto.reduce((suma, f) => suma + f.ventas, 0);
  let acumulado = 0;
  for (const fila of resto) {
    // Se mira lo acumulado ANTES del cliente: el que cruza el 80 % todavía es A.
    const proporcion = total ? acumulado / total : 0;
    segmento.set(fila.cliente, proporcion < CORTE_A ? "A" : proporcion < CORTE_B ? "B" : "C");
    acumulado += fila.ventas;
  }

  const clientes = identificados.map((fila) => {
    const dias = diasDesde(fila.ultima, fin);
    return { ...fila, segmento: segmento.get(fila.cliente), recencia: recenciaDe(dias), dias };
  });
  return { clientes, anonimo, sinCompraNeta, umbralAtipico };
}
