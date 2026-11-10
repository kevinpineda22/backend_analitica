import assert from "node:assert/strict";
import test from "node:test";
import { consultarEvolucionItems, consultarListaItems, periodoAnterior } from "../src/items/consultas.js";
import { conLineaPorItem, diasDelPeriodo, granularidadDe, leerFiltros, leerLista } from "../src/items/reglas.js";
import { COLUMNAS_LISTA, cuerpoEvolucion, cuerpoLista } from "../src/items/respuesta.js";
import { fuenteItems } from "../src/pos/tramos.js";

const poolFalso = (rows = []) => {
  const llamadas = [];
  return { llamadas, query: async (sql, params) => { llamadas.push({ sql, params }); return { rows }; } };
};

test("leerLista separa por barra, limpia, deduplica y vacía es null", () => {
  assert.deepEqual(leerLista("A| B |A||C"), ["A", "B", "C"]);
  assert.equal(leerLista(""), null);
  assert.equal(leerLista(undefined), null);
});

test("un nombre con coma no se parte", () => {
  assert.deepEqual(leerLista("ASEO, HOGAR|GRANOS"), ["ASEO, HOGAR", "GRANOS"]);
});

test("los códigos de ítem con caracteres raros se descartan", () => {
  assert.deepEqual(leerFiltros({ items: "15202|1;DROP|180335" }).items, ["15202", "180335"]);
});

test("una lista enorme se recorta, no revienta", () => {
  const larga = Array.from({ length: 900 }, (_, i) => `I${i}`).join("|");
  assert.equal(leerLista(larga).length, 400);
});

test("el detalle es diario hasta 62 días y mensual después", () => {
  assert.equal(diasDelPeriodo({ desde: "2026-01-01", hasta: "2026-01-01" }), 1);
  assert.equal(granularidadDe({ desde: "2026-09-01", hasta: "2026-11-01" }), "dia");
  assert.equal(granularidadDe({ desde: "2026-09-01", hasta: "2026-11-02" }), "mes");
});

test("una línea por ítem solo con pocos ítems elegidos", () => {
  assert.equal(conLineaPorItem(null), false);
  assert.equal(conLineaPorItem(Array(6).fill("x")), true);
  assert.equal(conLineaPorItem(Array(7).fill("x")), false);
});

test("el año anterior no salta de mes en bisiesto", () => {
  assert.deepEqual(periodoAnterior({ desde: "2024-02-01", hasta: "2024-02-29" }), { desde: "2023-02-01", hasta: "2023-02-28" });
});

test("fuenteItems corre la numeración sin tocar la llamada original", () => {
  const normal = fuenteItems("item");
  assert.match(normal, /mes >= \$4::date AND mes < \$5::date/);
  const corrida = fuenteItems("item", "", { base: 5 });
  assert.match(corrida, /mes >= \$9::date AND mes < \$10::date/);
  assert.match(corrida, /fecha >= \$6::date AND fecha < \$9::date/);
  assert.match(corrida, /\$8::text IS NULL OR bodega = \$8/);
  assert.doesNotMatch(corrida, /\$[1-5]::/);
});

test("columnasDiario solo cambia la rama del diario", () => {
  const sql = fuenteItems("mes AS periodo", "", { columnasDiario: "fecha AS periodo" });
  assert.match(sql, /SELECT mes AS periodo FROM merkahorro_siesa\.ventas_pdv_resumen_item_mensual/);
  assert.match(sql, /SELECT fecha AS periodo FROM merkahorro_siesa\.ventas_pdv_resumen_item_diario/);
});

test("sin año anterior no hace FULL JOIN y manda 5 parámetros", async () => {
  const pool = poolFalso();
  await consultarListaItems(pool, { desde: "2026-01-01", hasta: "2026-03-31", tienda: null, anterior: null });
  assert.doesNotMatch(pool.llamadas[0].sql, /FULL JOIN/);
  assert.equal(pool.llamadas[0].params.length, 5);
});

test("con año anterior manda los dos períodos en orden", async () => {
  const pool = poolFalso();
  await consultarListaItems(pool, {
    desde: "2026-01-01", hasta: "2026-03-31", tienda: "PV001", anterior: { desde: "2025-01-01", hasta: "2025-03-31" },
  });
  const { sql, params } = pool.llamadas[0];
  assert.match(sql, /FULL JOIN/);
  assert.deepEqual(params.slice(0, 3), ["2026-01-01", "2026-03-31", "PV001"]);
  assert.deepEqual(params.slice(5, 8), ["2025-01-01", "2025-03-31", "PV001"]);
});

test("la evolución por día no usa el mensual aunque haya un mes completo", async () => {
  const pool = poolFalso();
  await consultarEvolucionItems(pool, {
    desde: "2026-09-01", hasta: "2026-09-30", granularidad: "dia", lineaPorItem: false,
    filtros: { tienda: null, unidades: null, grupos: null, subgrupos: null, proveedores: null, marcas: null, items: ["15202"] },
  });
  const { sql, params } = pool.llamadas[0];
  assert.equal(params[3], "2026-10-01");
  assert.equal(params[4], "2026-10-01");
  assert.equal(params[10][0], "15202");
  assert.doesNotMatch(sql, /\(periodo, item\)/);
  assert.doesNotMatch(sql, /GROUPING\(item\)/, "Postgres rechaza GROUPING de una columna que no está en ningún conjunto");
});

test("la evolución por mes usa los meses completos y pide la línea por ítem", async () => {
  const pool = poolFalso();
  await consultarEvolucionItems(pool, {
    desde: "2026-01-15", hasta: "2026-06-30", granularidad: "mes", lineaPorItem: true,
    filtros: { tienda: null, unidades: null, grupos: ["A"], subgrupos: null, proveedores: null, marcas: null, items: ["1", "2"] },
  });
  const { sql, params } = pool.llamadas[0];
  assert.equal(params[3], "2026-02-01");
  assert.equal(params[4], "2026-07-01");
  assert.match(sql, /date_trunc\('month', fecha\)::date AS periodo/);
  assert.match(sql, /\(periodo, item\)/);
});

test("la lista viaja en el orden de sus columnas; sin base queda null", () => {
  const { filas, columnas } = cuerpoLista({
    periodo: {}, anterior: null,
    filas: [{ item: "1", nombre: "A", unidad: "001", grupo: "G", subgrupo: "S", proveedor: "P", marca: "M",
      ventas: 100, costo: 80, contribucion: 20, unidades: 5,
      ventas_anterior: null, contribucion_anterior: null, unidades_anterior: null }],
  });
  assert.equal(columnas, COLUMNAS_LISTA);
  assert.equal(filas[0].length, COLUMNAS_LISTA.length);
  assert.equal(filas[0][columnas.indexOf("ventas")], 100);
  assert.equal(filas[0][columnas.indexOf("ventasAnterior")], null);
});

test("cero del año anterior no es lo mismo que sin dato", () => {
  const { filas, columnas } = cuerpoLista({
    periodo: {}, anterior: {},
    filas: [{ item: "1", ventas: 10, costo: 0, contribucion: 0, unidades: 0, ventas_anterior: 0, contribucion_anterior: 0, unidades_anterior: 0 }],
  });
  assert.equal(filas[0][columnas.indexOf("ventasAnterior")], 0);
});

test("la evolución separa los conjuntos y ordena", () => {
  const cuerpo = cuerpoEvolucion({
    periodo: {}, granularidad: "mes",
    filas: [
      { periodo: "2026-02-01", bodega: null, item: null, sin_periodo: 0, sin_item: 1, ventas: 2, unidades: 1, contribucion: 1 },
      { periodo: "2026-01-01", bodega: null, item: null, sin_periodo: 0, sin_item: 1, ventas: 1, unidades: 1, contribucion: 1 },
      { periodo: null, bodega: "B", item: null, sin_periodo: 1, sin_item: 1, ventas: 1, unidades: 1, contribucion: 1 },
      { periodo: null, bodega: "A", item: null, sin_periodo: 1, sin_item: 1, ventas: 9, unidades: 1, contribucion: 1 },
      { periodo: "2026-01-01", bodega: null, item: "X", sin_periodo: 0, sin_item: 0, ventas: 1, unidades: 1, contribucion: 1 },
    ],
  });
  assert.deepEqual(cuerpo.serie.map((f) => f.periodo), ["2026-01-01", "2026-02-01"]);
  assert.deepEqual(cuerpo.sedes.map((f) => f.codigo), ["A", "B"]);
  assert.equal(cuerpo.porItem[0].item, "X");
});
