import assert from "node:assert/strict";
import test from "node:test";
import { consultarItems, sqlInventario } from "../src/inventario/consultas.js";
import { COLUMNAS, COLUMNAS_ITEM, cuerpoInventario, leerFecha, ventanaVenta } from "../src/inventario/reglas.js";

test("la fecha se valida", () => {
  assert.equal(leerFecha("2026-11-17"), "2026-11-17");
  assert.equal(leerFecha("17/11/2026"), null);
  assert.equal(leerFecha("2026-11-17; DROP"), null);
});

test("la venta comparada son los 28 días que terminan el día anterior a la foto", () => {
  assert.deepEqual(ventanaVenta("2026-11-18", "2026-11-17"), { desde: "2026-10-21", hasta: "2026-11-17", dias: 28 });
  // Si las ventas vienen atrasadas, termina en el último día cargado.
  assert.deepEqual(ventanaVenta("2026-11-18", "2026-11-15"), { desde: "2026-10-19", hasta: "2026-11-15", dias: 28 });
  // Una foto vieja no mira ventas posteriores a ella.
  assert.equal(ventanaVenta("2026-03-01", "2026-11-17").hasta, "2026-02-28");
});

test("las sedes viejas se suman a la nueva y lo vendido sin inventario también aparece", () => {
  const sql = sqlInventario();
  assert.match(sql, /WHEN 'PV002' THEN '00201'/);
  assert.match(sql, /FULL JOIN venta/);
  assert.match(sql, /existencia \* costo_unitario/);
});

test("el maestro se busca sin ceros a la izquierda y sin consultar si no hay ítems", async () => {
  let consultas = 0;
  const pool = { query: async (sql, params) => { consultas += 1; assert.match(sql, /LTRIM\(BTRIM\(item::text\), '0'\)/); assert.deepEqual(params, [["342"]]); return { rows: [] }; } };
  assert.deepEqual(await consultarItems(pool, []), []);
  assert.equal(consultas, 0);
  await consultarItems(pool, ["342"]);
  assert.equal(consultas, 1);
});

test("la respuesta va compacta y redondeada", () => {
  const cuerpo = cuerpoInventario({
    foto: { fecha: "2026-11-18", tomadoEn: "2026-11-18T10:31:00Z" },
    fotos: [{ fecha: "2026-11-18" }, { fecha: "2026-11-17" }],
    ventana: { desde: "2026-10-21", hasta: "2026-11-17", dias: 28 },
    filas: [{ sede: "PV001", item: "342", existencia: 120.12345, pos: 4, valor: 1005558.26, costo_total: 1005558.26, ventas: 50000.4, costo_venta: 40000.6, unidades: 6, ultima: "2026-11-17" }],
    items: [{ item: "342", descripcion: "ARROZ", grupo: "10-GRANOS", subgrupo: null, proveedor: "P", marca: "M", unidad: "UND" }],
    serie: [{ fecha: "2026-11-18", sede: "PV001", valor: 10.6 }],
    nombres: [{ sede: "PV001", nombre: "1.PRINCIPAL COPACABANA" }],
  });
  assert.deepEqual(cuerpo.columnas, COLUMNAS);
  assert.deepEqual(cuerpo.filas[0], ["PV001", "342", 120.123, 4, 1005558, 1005558, 50000, 40001, 6, "2026-11-17"]);
  assert.deepEqual(cuerpo.columnasItem, COLUMNAS_ITEM);
  assert.deepEqual(cuerpo.items[0], ["342", "ARROZ", "10-GRANOS", null, "P", "M", "UND"]);
  assert.deepEqual(cuerpo.fechas, ["2026-11-18", "2026-11-17"]);
  assert.deepEqual(cuerpo.sedes, { PV001: "1.PRINCIPAL COPACABANA" });
  assert.deepEqual(cuerpo.serie, [["2026-11-18", "PV001", 11]]);
});
