import assert from "node:assert/strict";
import test from "node:test";
import {
  consultarCombinaciones, cuerpoCombinaciones, leerDimensionPar, mesesAnteriores, mesesCompletos, sqlPares, sqlValores,
} from "../src/categorias/pares.js";

const poolFalso = () => {
  const llamadas = [];
  return { llamadas, query: async (sql, params) => { llamadas.push({ sql, params }); return { rows: [] }; } };
};

test("combinaciones solo por unidad y grupo", () => {
  assert.equal(leerDimensionPar("grupo"), "grupo");
  assert.equal(leerDimensionPar("marca"), null);
  assert.equal(leerDimensionPar("grupo'--"), null);
});

test("solo meses completos", () => {
  assert.deepEqual(mesesCompletos({ desde: "2026-10-01", hasta: "2026-10-31" }), { mesDesde: "2026-10-01", mesHasta: "2026-11-01" });
  assert.deepEqual(mesesCompletos({ desde: "2026-01-01", hasta: "2026-10-31" }), { mesDesde: "2026-01-01", mesHasta: "2026-11-01" });
  assert.equal(mesesCompletos({ desde: "2026-10-01", hasta: "2026-11-08" }), null);
  assert.equal(mesesCompletos({ desde: "2026-10-02", hasta: "2026-10-31" }), null);
  assert.equal(mesesCompletos({ desde: "2026-11-01", hasta: "2026-11-08" }), null);
});

test("el año anterior corre los meses, no la fecha final (febrero bisiesto)", () => {
  const previo = mesesAnteriores({ mesDesde: "2024-02-01", mesHasta: "2024-03-01" });
  assert.equal(previo.mesDesde, "2023-02-01");
  assert.equal(previo.mesHasta, "2023-03-01");
  assert.deepEqual(previo.periodo, { desde: "2023-02-01", hasta: "2023-02-28" });
});

test("los pares filtran por dimensión, meses y sede normalizada", () => {
  const sql = sqlPares(4);
  assert.match(sql, /dimension = \$8::text AND mes >= \$5::date AND mes < \$6::date/);
  assert.match(sql, /WHEN 'PV005' THEN '00501'/);
  assert.match(sql, /AND valor_a < valor_b GROUP BY valor_a, valor_b/);
});

test("los tickets de cada valor salen de la diagonal de los pares, no de la tabla por dimensión", () => {
  const sql = sqlValores();
  assert.match(sql, /FROM merkahorro_siesa\.ventas_pdv_resumen_par_mensual/);
  assert.match(sql, /valor_a = valor_b/);
  assert.doesNotMatch(sql, /dimension_mensual/);
});

test("con año anterior, pares y valores van con FULL JOIN y 8 parámetros", async () => {
  const pool = poolFalso();
  await consultarCombinaciones(pool, {
    tramo: { mesDesde: "2026-10-01", mesHasta: "2026-11-01" },
    tramoAnterior: { mesDesde: "2025-10-01", mesHasta: "2025-11-01" },
    tienda: "PV001",
    dimension: "grupo",
  });
  assert.equal(pool.llamadas.length, 2);
  for (const { sql, params } of pool.llamadas) {
    assert.deepEqual(params, ["2026-10-01", "2026-11-01", "PV001", "grupo", "2025-10-01", "2025-11-01", "PV001", "grupo"]);
    assert.match(sql, /FULL JOIN p USING/);
  }
});

test("el cuerpo ordena pares por tickets y deja null el anterior que no se pidió", () => {
  const cuerpo = cuerpoCombinaciones({
    periodo: { desde: "2026-10-01", hasta: "2026-10-31" },
    anterior: null,
    dimension: "grupo",
    totales: { actual: { tickets: "100" }, anterior: null },
    valores: [{ valor: "A", tickets: "10", tickets_anterior: null }, { valor: "B", tickets: "40", tickets_anterior: null }],
    pares: [{ valor_a: "A", valor_b: "B", tickets: "5", tickets_anterior: null }, { valor_a: "A", valor_b: "C", tickets: "9", tickets_anterior: null }],
  });
  assert.deepEqual(cuerpo.tickets, { actual: 100, anterior: null });
  assert.deepEqual(cuerpo.valores.map((v) => v[0]), ["B", "A"]);
  assert.deepEqual(cuerpo.pares[0], ["A", "C", 9, null]);
});
