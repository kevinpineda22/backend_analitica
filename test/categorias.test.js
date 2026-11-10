import assert from "node:assert/strict";
import test from "node:test";
import { consultarPorValor, consultarTotales, parametrosPeriodo, sqlPorValor } from "../src/categorias/consultas.js";
import { leerDimension, tramoCubierto, valorDimension } from "../src/categorias/reglas.js";
import { COLUMNAS_CATEGORIAS, cuerpoCategorias } from "../src/categorias/respuesta.js";

const poolFalso = (rows = []) => {
  const llamadas = [];
  return { llamadas, query: async (sql, params) => { llamadas.push({ sql, params }); return { rows }; } };
};

test("solo las cinco dimensiones del agregado", () => {
  assert.equal(leerDimension("marca"), "marca");
  assert.equal(leerDimension("item"), null);
  assert.equal(leerDimension("grupo; DROP"), null);
});

test("el valor de la dimensión sale de su columna y nunca es nulo", () => {
  const expresion = valorDimension("$6::text");
  assert.match(expresion, /WHEN 'unidad' THEN unidad_negocio/);
  assert.match(expresion, /^COALESCE\(CASE \$6::text .* END, 'Sin dato'\)$/);
});

test("un período parte en meses del agregado y puntas del diario", () => {
  assert.deepEqual(parametrosPeriodo({ desde: "2026-01-01", hasta: "2026-11-08" }, null, "grupo"),
    ["2026-01-01", "2026-11-08", null, "2026-01-01", "2026-11-01", "grupo"]);
});

test("la cobertura del agregado tiene que incluir todos los meses que se leen", () => {
  const cobertura = { desde: "2024-01-01", hasta: "2026-11-01" };
  assert.equal(tramoCubierto({ mesDesde: "2026-01-01", mesHasta: "2026-11-01" }, cobertura), true);
  assert.equal(tramoCubierto({ mesDesde: "2026-01-01", mesHasta: "2026-12-01" }, { ...cobertura, hasta: "2026-10-01" }), false);
  assert.equal(tramoCubierto({ mesDesde: "2023-12-01", mesHasta: "2024-02-01" }, cobertura), false);
  // Agregado vacío: solo se acepta si no hay que leer ningún mes.
  assert.equal(tramoCubierto({ mesDesde: "2026-01-01", mesHasta: "2026-02-01" }, { desde: null, hasta: null }), false);
  assert.equal(tramoCubierto({ mesDesde: "2026-11-09", mesHasta: "2026-11-09" }, { desde: null, hasta: null }), true);
});

test("las puntas cuentan tickets por sede, fecha y documento", () => {
  const sql = sqlPorValor();
  assert.match(sql, /COUNT\(DISTINCT \(bodega, fecha, d\.documento\)\)/);
  assert.match(sql, /dimension = \$6::text AND mes >= \$4::date AND mes < \$5::date/);
  // Sumar las medidas desde las filas, no desde el UNNEST (multiplicaría la venta).
  assert.match(sql, /SELECT COALESCE\(CASE \$6::text[^]*?, ventas, costo, contribucion, unidades, 0\s+FROM merkahorro_siesa\.ventas_pdv_resumen_item_diario\s+WHERE/);
});

test("con año anterior la segunda fuente usa $7..$12", async () => {
  const pool = poolFalso();
  await consultarPorValor(pool, {
    periodo: { desde: "2026-01-01", hasta: "2026-11-08" },
    anterior: { desde: "2025-01-01", hasta: "2025-11-08" },
    tienda: "PV001",
    dimension: "marca",
  });
  const { sql, params } = pool.llamadas[0];
  assert.equal(params.length, 12);
  assert.deepEqual(params.slice(6), ["2025-01-01", "2025-11-08", "PV001", "2025-01-01", "2025-11-01", "marca"]);
  assert.match(sql, /\$12::text/);
  assert.match(sql, /FULL JOIN p USING \(valor\)/);
});

test("los totales sin año anterior no piden sus parámetros", async () => {
  const pool = poolFalso([{ actual: { ventas: 1 }, anterior: null }]);
  await consultarTotales(pool, { periodo: { desde: "2026-11-01", hasta: "2026-11-08" }, anterior: null, tienda: null });
  assert.equal(pool.llamadas[0].params.length, 3);
  assert.doesNotMatch(pool.llamadas[0].sql, /\$4/);
});

test("cuerpoCategorias ordena por venta y deja null el anterior que no se pidió", () => {
  const cuerpo = cuerpoCategorias({
    periodo: { desde: "2026-11-01", hasta: "2026-11-08" },
    anterior: null,
    dimension: "grupo",
    totales: { actual: { ventas: "30", costo: 0, contribucion: 0, unidades: 0, tickets: "5" }, anterior: null },
    filas: [
      { valor: "B", ventas: 10, costo: 1, contribucion: 9, unidades: 1, tickets: 2, ventas_anterior: null },
      { valor: "A", ventas: 20, costo: 2, contribucion: 18, unidades: 2, tickets: 3, ventas_anterior: null },
    ],
  });
  assert.deepEqual(cuerpo.columnas, COLUMNAS_CATEGORIAS);
  assert.deepEqual(cuerpo.filas.map((f) => f[0]), ["A", "B"]);
  assert.equal(cuerpo.filas[0][6], null);
  assert.deepEqual(cuerpo.totales.actual, { ventas: 30, costo: 0, contribucion: 0, unidades: 0, tickets: 5 });
  assert.equal(cuerpo.totales.anterior, null);
});
