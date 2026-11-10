import assert from "node:assert/strict";
import test from "node:test";
import { consultarDias, sqlCorte } from "../src/diarias/consultas.js";
import {
  diasEntre, leerTienda, lunesDe, sedeNormalizada, sumarDias, unAnioAntes, ventanasDelCorte,
} from "../src/diarias/reglas.js";
import { COLUMNAS_DIAS, cuerpoCorte, cuerpoDias } from "../src/diarias/respuesta.js";

const poolFalso = (rows = []) => {
  const llamadas = [];
  return { llamadas, query: async (sql, params) => { llamadas.push({ sql, params }); return { rows }; } };
};

test("sumar días cruza meses y años", () => {
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(sumarDias("2025-12-31", 1), "2026-01-01");
  assert.equal(diasEntre("2026-01-01", "2026-01-01"), 1);
  assert.equal(diasEntre("2025-01-01", "2025-12-31"), 365);
});

test("un año antes del 29 de febrero es el 28", () => {
  assert.equal(unAnioAntes("2024-02-29"), "2023-02-28");
  assert.equal(unAnioAntes("2026-11-08"), "2025-11-08");
});

test("la semana arranca el lunes, también si la fecha es domingo", () => {
  assert.equal(lunesDe("2026-11-08"), "2026-11-02"); // domingo
  assert.equal(lunesDe("2026-11-02"), "2026-11-02"); // lunes
  assert.equal(lunesDe("2026-11-04"), "2026-11-02");
});

test("día y semana contra el mismo día de la semana; mes y año por calendario", () => {
  const [dia, semana, mes, anio] = ventanasDelCorte("2026-11-08", "2024-01-01");
  assert.deepEqual(dia, { clave: "dia", desde: "2026-11-08", hasta: "2026-11-08", anterior: { desde: "2025-11-09", hasta: "2025-11-09" } });
  assert.equal(new Date("2025-11-09T00:00:00Z").getUTCDay(), new Date("2026-11-08T00:00:00Z").getUTCDay());
  assert.deepEqual(semana.anterior, { desde: "2025-11-03", hasta: "2025-11-09" });
  assert.deepEqual(mes, { clave: "mes", desde: "2026-11-01", hasta: "2026-11-08", anterior: { desde: "2025-11-01", hasta: "2025-11-08" } });
  assert.deepEqual(anio.anterior, { desde: "2025-01-01", hasta: "2025-11-08" });
});

test("sin año anterior en los datos, la ventana no compara", () => {
  const ventanas = ventanasDelCorte("2024-06-10", "2024-01-01");
  assert.ok(ventanas.every((ventana) => ventana.anterior === null));
});

test("los códigos viejos de sede se suman al nuevo", () => {
  const expresion = sedeNormalizada();
  assert.match(expresion, /WHEN 'PV005' THEN '00501'/);
  assert.match(expresion, /WHEN 'PV002' THEN '00201'/);
});

test("el código de tienda raro se ignora", () => {
  assert.equal(leerTienda("PV001"), "PV001");
  assert.equal(leerTienda("1;DROP"), null);
  assert.equal(leerTienda(""), null);
});

test("el corte es una sola consulta con una columna por ventana, lado y medida", () => {
  const ventanas = ventanasDelCorte("2026-11-08", "2024-01-01");
  const { sql, valores } = sqlCorte("2026-11-08", ventanas);
  assert.equal((sql.match(/FILTER \(WHERE fecha BETWEEN/g) || []).length, 4 * 2 * 4 + 1);
  assert.match(sql, /"anio_anterior_tickets"/);
  // El rango leído arranca en la base más vieja (1-ene del año anterior).
  assert.ok(valores.includes("2025-01-01"));
  assert.equal(valores.at(-2), "2025-01-01");
  assert.equal(valores.at(-1), "2026-11-08");
  const usados = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(usados, valores.length);
});

test("sin año anterior el corte no pide columnas de comparación", () => {
  const ventanas = ventanasDelCorte("2024-03-10", "2024-01-01");
  const { sql } = sqlCorte("2024-03-10", ventanas);
  assert.doesNotMatch(sql, /_anterior_/);
});

test("cuerpoCorte arma bloques, deja anterior en null y descarta sedes muertas", () => {
  const ventanas = ventanasDelCorte("2026-11-08", "2024-01-01").map((v) => (v.clave === "anio" ? v : { ...v, anterior: null }));
  const fila = (codigo, nombre, ventas, recientes) => ({
    codigo, nombre, dias_recientes: recientes,
    dia_actual_ventas: ventas, dia_actual_tickets: 10,
    semana_actual_ventas: ventas, mes_actual_ventas: ventas,
    anio_actual_ventas: ventas, anio_anterior_ventas: ventas ? 50 : null,
  });
  const cuerpo = cuerpoCorte({
    fecha: "2026-11-08",
    cobertura: { desde: "2024-01-01", hasta: "2026-11-08", actualizado: null },
    ventanas,
    filas: [fila("PV001", "Copacabana", 100, 20), fila("01001", "Guatapé", null, 0), fila("01101", "Carnes López", 0, 20)],
  });
  assert.deepEqual(cuerpo.sedes.map((s) => s.codigo), ["01101", "PV001"]);
  const copa = cuerpo.sedes.find((s) => s.codigo === "PV001");
  assert.deepEqual(copa.bloques.dia, { actual: { ventas: 100, contribucion: 0, unidades: 0, tickets: 10 }, anterior: null });
  assert.equal(copa.bloques.anio.anterior.ventas, 50);
  assert.equal(cuerpo.datos.hasta, "2026-11-08");
});

test("la serie diaria filtra por la sede unificada", async () => {
  const pool = poolFalso([{ fecha: "2026-11-08", ventas: "10.5", contribucion: 2, unidades: 3, tickets: 4, sedes: 8 }]);
  const filas = await consultarDias(pool, { desde: "2026-11-01", hasta: "2026-11-08", tienda: "00501" });
  assert.deepEqual(pool.llamadas[0].params, ["2026-11-01", "2026-11-08", "00501"]);
  assert.match(pool.llamadas[0].sql, /WHEN 'PV005' THEN '00501'/);
  const cuerpo = cuerpoDias({ periodo: { desde: "2026-11-01", hasta: "2026-11-08" }, tienda: "00501", filas });
  assert.deepEqual(cuerpo.columnas, COLUMNAS_DIAS);
  assert.deepEqual(cuerpo.filas[0], ["2026-11-08", 10.5, 2, 3, 4, 8]);
});
