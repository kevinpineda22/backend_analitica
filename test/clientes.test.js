import assert from "node:assert/strict";
import test from "node:test";
import { consultarClientes } from "../src/clientes/consultas.js";
import { COLUMNAS, cuerpoSegmentos } from "../src/clientes/respuesta.js";
import {
  correrMes, leerMes, mesesDisponibles, percentil, recenciaDe, segmentar, ultimoMesCerrado, ventanaAnual,
} from "../src/clientes/segmentos.js";

const fila = (cliente, ventas, tickets, ultima = "2026-10-20", extra = {}) => ({
  cliente, nombre: `Cliente ${cliente}`, ventas, costo: ventas * 0.8, tickets, ultima, meses: 1, sedes: 1, sede_principal: "001", ...extra,
});

test("el mes se valida y se corre", () => {
  assert.equal(leerMes("2026-10"), "2026-10");
  assert.equal(leerMes("2026-13"), null);
  assert.equal(leerMes("2026-10-01"), null);
  assert.equal(leerMes("2026-10'--"), null);
  assert.equal(correrMes("2026-01", -1), "2025-12");
  assert.equal(correrMes("2026-10", -12), "2025-10");
});

test("la ventana son los 12 meses que terminan en el mes pedido", () => {
  assert.deepEqual(ventanaAnual("2026-10"), { mesDesde: "2025-11-01", mesHasta: "2026-11-01", desde: "2025-11-01", hasta: "2026-10-31" });
  assert.equal(ventanaAnual("2024-02").hasta, "2024-02-29");
});

test("último mes cerrado y meses que se pueden pedir", () => {
  assert.equal(ultimoMesCerrado("2026-11-10"), "2026-10");
  assert.equal(ultimoMesCerrado("2026-10-31"), "2026-10");
  const meses = mesesDisponibles({ desde: "2024-01-01", hasta: "2026-11-01" }, "2026-10");
  assert.equal(meses[0], "2026-10");
  assert.equal(meses.at(-1), "2024-12"); // el primero con sus 12 meses cargados
  assert.deepEqual(mesesDisponibles({ desde: "2026-01-01", hasta: "2026-10-01" }, "2026-10"), []);
});

test("recencia por días desde la última compra", () => {
  assert.equal(recenciaDe(0), "activo");
  assert.equal(recenciaDe(30), "activo");
  assert.equal(recenciaDe(31), "riesgo");
  assert.equal(recenciaDe(90), "riesgo");
  assert.equal(recenciaDe(180), "dormido");
  assert.equal(recenciaDe(181), "perdido");
});

test("percentil por rango más cercano", () => {
  const cien = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentil(cien, 0.99), 99);
  assert.equal(percentil([5], 0.99), 5);
  assert.equal(percentil([], 0.99), null);
});

test("consumidor final aparte, atípicos por ticket y Pareto 80/15/5", () => {
  // 100 hogares con ticket de 10 mil y un comprador institucional de 1 M por ticket.
  const hogares = Array.from({ length: 100 }, (_, i) => fila(`H${String(i).padStart(3, "0")}`, (100 - i) * 10_000, 100 - i));
  const filas = [
    ...hogares,
    fila("INST", 5_000_000, 5),
    fila("222222222222", 90_000_000, 9_000),
    fila("Sin dato", 1_000, 1),
    fila("DEV", -50_000, 1),
  ];
  const { clientes, anonimo, sinCompraNeta, umbralAtipico } = segmentar(filas, "2026-10-31");

  assert.equal(anonimo.ventas, 90_001_000);
  assert.equal(anonimo.tickets, 9_001);
  assert.equal(sinCompraNeta, 1);
  assert.equal(clientes.length, 101);
  assert.equal(umbralAtipico, 10_000);
  assert.equal(clientes.find((c) => c.cliente === "INST").segmento, "atipico");

  const porSegmento = (s) => clientes.filter((c) => c.segmento === s);
  const total = hogares.reduce((suma, h) => suma + h.ventas, 0);
  const suma = (lista) => lista.reduce((s, c) => s + c.ventas, 0);
  // A: lo acumulado antes de cada uno no llega al 80 %; el que cruza todavía es A.
  assert.ok(suma(porSegmento("A")) >= 0.8 * total);
  assert.ok(suma(porSegmento("A")) - porSegmento("A").at(-1).ventas < 0.8 * total);
  assert.ok(suma(porSegmento("A")) + suma(porSegmento("B")) >= 0.95 * total);
  assert.equal(porSegmento("A").length + porSegmento("B").length + porSegmento("C").length, 100);
  assert.equal(clientes.find((c) => c.cliente === "H000").segmento, "A");
  assert.equal(clientes.find((c) => c.cliente === "H099").segmento, "C");
});

test("la recencia se mide al último día del período", () => {
  const { clientes } = segmentar([fila("X", 1000, 1, "2026-06-01"), fila("Y", 1000, 1, "2026-10-31")], "2026-10-31");
  assert.equal(clientes.find((c) => c.cliente === "X").recencia, "dormido");
  assert.equal(clientes.find((c) => c.cliente === "X").dias, 152);
  assert.equal(clientes.find((c) => c.cliente === "Y").recencia, "activo");
});

test("la respuesta trae el segmento de 12 meses antes", () => {
  const cuerpo = cuerpoSegmentos({
    mes: "2026-10",
    ventana: ventanaAnual("2026-10"),
    anterior: ventanaAnual("2025-10"),
    filas: [fila("A1", 900, 3), fila("N1", 100, 1)],
    filasAnteriores: [fila("A1", 500, 2, "2025-10-01")],
    mesesDisponibles: ["2026-10", "2025-10"],
  });
  const col = (nombre) => COLUMNAS.indexOf(nombre);
  const a1 = cuerpo.clientes.find((c) => c[col("cliente")] === "A1");
  const n1 = cuerpo.clientes.find((c) => c[col("cliente")] === "N1");
  assert.equal(a1[col("segmentoAnterior")], "A");
  assert.equal(n1[col("segmentoAnterior")], null);
  assert.equal(cuerpo.anterior.porSegmento.A.clientes, 1);
  assert.equal(cuerpo.periodo.hasta, "2026-10-31");

  const sinAnterior = cuerpoSegmentos({
    mes: "2026-10", ventana: ventanaAnual("2026-10"), anterior: null, filas: [fila("A1", 900, 3)], filasAnteriores: null, mesesDisponibles: [],
  });
  assert.equal(sinAnterior.anterior, null);
  assert.equal(sinAnterior.clientes[0][col("segmentoAnterior")], null);
});

test("la consulta filtra por meses y sede con parámetros", async () => {
  const llamadas = [];
  const pool = { query: async (sql, params) => { llamadas.push({ sql, params }); return { rows: [] }; } };
  await consultarClientes(pool, { mesDesde: "2025-11-01", mesHasta: "2026-11-01", tienda: "001" });
  assert.deepEqual(llamadas[0].params, ["2025-11-01", "2026-11-01", "001"]);
  assert.match(llamadas[0].sql, /ventas_pdv_resumen_cliente_mensual/);
  await consultarClientes(pool, { mesDesde: "2025-11-01", mesHasta: "2026-11-01" });
  assert.equal(llamadas[1].params[2], null);
});
