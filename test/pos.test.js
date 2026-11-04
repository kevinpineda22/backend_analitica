import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { originPermitido, origenesPermitidos } from "../src/config/cors.js";
import { fechaValida, validarPeriodo } from "../src/http.js";
import { elegirFuente } from "../src/pos/fuente.js";
import { cuerpoKpi, cuerpoResumen, unidadesNegocio } from "../src/pos/respuesta.js";
import { parametros } from "../src/pos/sql.js";
import { parametrosItems, tramosMensuales } from "../src/pos/tramos.js";

describe("elegirFuente", () => {
  const casos = [
    // [metrica, rapido, conFiltros, fuente]
    ["pesos", true, false, "diario-rapido"],
    ["contribucion", true, false, "diario-rapido"],
    ["unidades", true, false, "transaccional"],
    ["pesos", false, false, "diario-detalle"],
    ["contribucion", false, false, "diario-detalle"],
    ["unidades", false, false, "kpi-diario"],
    ["clientes", false, false, "kpi-diario"],
    ["tickets", false, false, "kpi-diario"],
    ["ticket_promedio", false, false, "kpi-diario"],
    ["pesos", true, true, "item-filtrado"],
    ["unidades", false, true, "item-filtrado"],
    ["tickets", true, true, "transaccional"],
    ["clientes", false, true, "transaccional"],
  ];
  for (const [metrica, rapido, conFiltros, fuente] of casos) {
    it(`${metrica} rapido=${rapido} filtros=${conFiltros} → ${fuente}`, () => {
      assert.equal(elegirFuente({ metrica, rapido, conFiltros }), fuente);
    });
  }
  it("solo unidad de negocio: resúmenes por unidad para TODAS las métricas", () => {
    for (const metrica of ["pesos", "unidades", "tickets", "clientes", "ticket_promedio"]) {
      assert.equal(elegirFuente({ metrica, rapido: true, conFiltros: true, soloUnidad: true }), "negocio-filtrado");
    }
  });
});

describe("tramosMensuales", () => {
  it("un año entero sale todo del mensual", () => {
    assert.deepEqual(tramosMensuales("2024-01-01", "2024-12-31"), { mesDesde: "2024-01-01", mesHasta: "2025-01-01" });
  });
  it("las puntas que no son mes completo quedan para el diario", () => {
    assert.deepEqual(tramosMensuales("2024-01-15", "2024-03-10"), { mesDesde: "2024-02-01", mesHasta: "2024-03-01" });
  });
  it("fin de febrero bisiesto cuenta como mes completo", () => {
    assert.deepEqual(tramosMensuales("2024-02-01", "2024-02-29"), { mesDesde: "2024-02-01", mesHasta: "2024-03-01" });
  });
  it("sin un mes completo, el mensual no aporta nada", () => {
    assert.deepEqual(tramosMensuales("2026-10-01", "2026-10-29"), { mesDesde: "2026-10-30", mesHasta: "2026-10-30" });
    assert.deepEqual(tramosMensuales("2024-01-15", "2024-01-20"), { mesDesde: "2024-01-21", mesHasta: "2024-01-21" });
  });
  it("los parámetros traen la tienda o null", () => {
    assert.deepEqual(parametrosItems("2024-01-15", "2024-03-10", ""), ["2024-01-15", "2024-03-10", null, "2024-02-01", "2024-03-01"]);
  });
});

describe("unidadesNegocio", () => {
  it("devuelve siempre las tres, en cero si no vendieron", () => {
    const filas = unidadesNegocio([{ codigo: "002", ventas: "100", cantidad: "10", tickets: "4" }]);
    assert.deepEqual(filas.map((f) => f.codigo), ["001", "002", "003"]);
    assert.deepEqual(filas[1], {
      codigo: "002", nombre: "Fruver", unidad: "KL", ventas: 100, cantidad: 10, tickets: 4, promedio: 2.5,
    });
    assert.equal(filas[0].promedio, 0);
  });
});

describe("cuerpoResumen", () => {
  it("pasa a número y completa las listas que faltan", () => {
    const cuerpo = cuerpoResumen({
      periodo: { desde: "2026-10-01", hasta: "2026-10-02" },
      metrica: "pesos",
      serie: [{ fecha: "2026-10-01", valor: "10", contribucion: "3" }],
      sedes: [],
      total: { valorActual: "10", totalVentas: "10" },
      negocios: [],
      parcial: true,
    });
    assert.deepEqual(cuerpo.serie, [{ fecha: "2026-10-01", valor: 10, contribucion: 3 }]);
    assert.deepEqual(cuerpo.grupos, []);
    assert.equal(cuerpo.totalContribucion, 0);
    assert.equal(cuerpo.parcial, true);
    assert.equal(cuerpo.valorAnterior, 0);
    assert.equal(cuerpo.variacion, null);
  });
});

describe("cuerpoKpi", () => {
  it("no trae totales", () => {
    const cuerpo = cuerpoKpi({
      periodo: {}, metrica: "tickets",
      analisis: { valorActual: "5", serie: [], sedes: [], grupos: [], productos: [] },
    });
    assert.equal(cuerpo.valorActual, 5);
    assert.equal("totalVentas" in cuerpo, false);
  });
});

describe("parametros", () => {
  it("acepta sede como alias de tienda y vacío como null", () => {
    assert.deepEqual(
      parametros({ sede: " PV001 ", grupo: "" }, "2026-10-01", "2026-10-02"),
      ["2026-10-01", "2026-10-02", "PV001", null, null, null, null, null],
    );
  });
});

describe("validarPeriodo", () => {
  const respuesta = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });
  it("rechaza fechas inválidas y orden invertido con 400", () => {
    const r1 = respuesta();
    assert.equal(validarPeriodo({ query: { desde: "2026-13-01", hasta: "2026-10-01" } }, r1), null);
    assert.equal(r1.statusCode, 400);
    const r2 = respuesta();
    assert.equal(validarPeriodo({ query: { desde: "2026-10-08", hasta: "2026-10-07" } }, r2), null);
    assert.equal(r2.statusCode, 400);
  });
  it("devuelve el periodo si sirve", () => {
    assert.deepEqual(
      validarPeriodo({ query: { desde: "2026-10-01", hasta: "2026-10-07" } }, respuesta()),
      { desde: "2026-10-01", hasta: "2026-10-07" },
    );
  });
  it("fechaValida exige AAAA-MM-DD", () => {
    assert.equal(fechaValida("2026-1-01"), false);
    assert.equal(fechaValida("2026-10-01"), true);
  });
});

describe("cors", () => {
  const lista = origenesPermitidos("https://merkahorro.com, *.vercel.app/");
  it("acepta exactos y subdominios del comodín", () => {
    assert.equal(originPermitido("https://merkahorro.com/", lista), true);
    assert.equal(originPermitido("https://x.vercel.app", lista), true);
  });
  it("no acepta el dominio pelado del comodín ni otros", () => {
    assert.equal(originPermitido("https://vercel.app", lista), false);
    assert.equal(originPermitido("https://evil.com", lista), false);
  });
  it("sin lista usa los orígenes por defecto", () => {
    assert.equal(originPermitido("http://localhost:5173", origenesPermitidos(undefined)), true);
  });
});
