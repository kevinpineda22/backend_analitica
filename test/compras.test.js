import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armarWhere, mismosParametros } from "../src/compras/consultas.js";
import { anteriorCompleto, armarTotales, codigoProveedor, fuentes, leerFiltros } from "../src/compras/reglas.js";
import { cuerpoPeriodo } from "../src/compras/respuesta.js";

const sinFiltros = { bodega: null, proveedor: null, sucursal: null, grupo: null };

describe("armarTotales: signos por tipo", () => {
  const porTipo = {
    CEA: { subtotal: "1000", impuestos: "190", unidades: "50" },
    CDP: { subtotal: "100" },
    CAE: { subtotal: "30" },
    CAS: { subtotal: "10" },
    DSE: { subtotal: "999" },
  };
  const t = armarTotales(porTipo, { entradas: 4 });

  it("compras = CEA; DSE no entra", () => assert.equal(t.compras, 1000));
  it("ajuste neto = CAE − CAS (SIESA guarda CAS en positivo)", () => assert.equal(t.ajusteNeto, 20));
  it("compras netas = CEA − CDP + CAE − CAS", () => assert.equal(t.comprasNetas, 920));
  it("tasa de devolución = CDP / CEA", () => assert.equal(t.tasaDevolucion, 0.1));
  it("impuestos y unidades son los de las entradas", () => {
    assert.equal(t.impuestos, 190);
    assert.equal(t.unidades, 50);
  });
  it("sin compras la tasa es null, no infinito", () => assert.equal(armarTotales({ CDP: { subtotal: "5" } }).tasaDevolucion, null));
  it("un conteo que no se pudo calcular queda null, no 0", () => {
    assert.equal(t.documentosDevolucion, null);
    assert.equal(t.entradas, 4);
  });
});

describe("fuentes", () => {
  it("sin proveedor ni grupo, totales del diario y documentos contables", () => {
    assert.deepEqual(fuentes({ ...sinFiltros, bodega: "PV001" }), { totales: "diario", documentos: "documentos" });
  });
  it("con proveedor, totales por ítem pero documentos sí", () => {
    assert.deepEqual(fuentes({ ...sinFiltros, proveedor: "900" }), { totales: "item", documentos: "documentos" });
  });
  it("con grupo NO se cuentan documentos", () => {
    assert.deepEqual(fuentes({ ...sinFiltros, grupo: "10-CAFE" }), { totales: "item", documentos: null });
  });
});

describe("anteriorCompleto", () => {
  it("un feriado al arrancar no deja a todo el año siguiente sin base", () => {
    // Datos desde el 2025-01-02 (el 1 de enero no hubo compras).
    assert.equal(anteriorCompleto({ desde: "2025-01-01" }, "2025-01-02"), true);
  });
  it("antes del mes de cobertura no hay base", () => {
    assert.equal(anteriorCompleto({ desde: "2024-12-31" }, "2025-01-02"), false);
  });
  it("sin datos no hay base", () => assert.equal(anteriorCompleto({ desde: "2025-06-01" }, null), false));
});

describe("leerFiltros", () => {
  it("recorta, y vacío es null", () => {
    assert.deepEqual(leerFiltros({ bodega: " PV001 ", grupo: "" }), { bodega: "PV001", proveedor: null, sucursal: null, grupo: null });
  });
  it("la sucursal solo cuenta si hay proveedor", () => {
    assert.equal(leerFiltros({ sucursal: "001" }).sucursal, null);
    assert.equal(leerFiltros({ proveedor: "900", sucursal: "001" }).sucursal, "001");
  });
  it("un valor absurdamente largo se descarta", () => {
    assert.equal(leerFiltros({ proveedor: "9".repeat(21) }).proveedor, null);
  });
});

describe("armarWhere", () => {
  const periodo = { desde: "2026-01-01", hasta: "2026-01-31" };
  it("usa parámetros posicionales, nunca el valor en el SQL", () => {
    const { where, params } = armarWhere("item", { ...periodo, filtros: { ...sinFiltros, grupo: "10-CAFE'; DROP" } });
    assert.match(where, /grupo = \$4/);
    assert.doesNotMatch(where, /DROP/);
    assert.equal(params[3], "10-CAFE'; DROP");
  });
  it("aplica solo los filtros presentes", () => {
    const { where, params } = armarWhere("documentos", { ...periodo, filtros: { ...sinFiltros, bodega: "PV001", proveedor: "900" } });
    assert.match(where, /bodega = \$4 AND proveedor = \$5$/);
    assert.equal(params.length, 5);
  });
  it("un filtro que la tabla no tiene es un error, no se ignora en silencio", () => {
    assert.throws(() => armarWhere("diario", { ...periodo, filtros: { ...sinFiltros, grupo: "x" } }), /no tiene grupo/);
  });
});

describe("mismosParametros", () => {
  const periodo = { desde: "2026-01-01", hasta: "2026-01-31" };
  it("diario y documentos comparten parámetros con filtro de bodega", () => {
    const { params, where } = mismosParametros(["diario", "documentos"], { ...periodo, filtros: { ...sinFiltros, bodega: "PV001" } });
    assert.equal(params[3], "PV001");
    assert.match(where.diario, /bodega = \$4/);
    assert.match(where.documentos, /bodega = \$4/);
  });
  it("documentos e item comparten parámetros con proveedor y sucursal", () => {
    const { where } = mismosParametros(["documentos", "item"], { ...periodo, filtros: { ...sinFiltros, proveedor: "900", sucursal: "001" } });
    assert.match(where.documentos, /proveedor = \$4 AND sucursal = \$5$/);
    assert.match(where.item, /proveedor = \$4 AND sucursal = \$5$/);
  });
  it("una tabla que no tiene un filtro presente corta con error", () => {
    assert.throws(() => mismosParametros(["diario", "item"], { ...periodo, filtros: { ...sinFiltros, grupo: "x" } }), /no tiene grupo/);
  });
});

describe("cuerpoPeriodo", () => {
  const fila = {
    porTipo: { CEA: { subtotal: "200" }, CDP: { subtotal: "20" } },
    conteos: { entradas: "3", documentosDevolucion: "1", proveedores: "2" },
    serie: [{ fecha: "2026-10-01", compras: "200", devoluciones: "20", ajusteNeto: "0" }],
    rankings: {
      proveedores: [{ nit: "900", sucursal: "001", nombre: "X", compras: "200", devoluciones: "20", ajusteNeto: "5" }],
      productos: [], grupos: [], bodegas: [],
      motivos: [{ codigo: "01", nombre: "Averías", valor: "20", lineas: "2" }],
    },
  };
  it("arma totales con conteos y pasa todo a número", () => {
    const c = cuerpoPeriodo(fila, { conRankings: true });
    assert.equal(c.total.entradas, 3);
    assert.deepEqual(c.serie[0], { fecha: "2026-10-01", compras: 200, devoluciones: 20, ajusteNeto: 0 });
    assert.deepEqual(c.proveedores[0], {
      codigo: "900-001", nit: "900", sucursal: "001", nombre: "X", compras: 200, devoluciones: 20, ajusteNeto: 5, tasaDevolucion: 0.1,
    });
    assert.deepEqual(c.motivos[0], { codigo: "01", nombre: "Averías", valor: 20, lineas: 2 });
  });
  it("sin rankings solo trae total y serie", () => {
    assert.deepEqual(Object.keys(cuerpoPeriodo({ ...fila, rankings: undefined }, { conRankings: false })), ["total", "serie"]);
  });
  it("codigoProveedor sin sucursal es el NIT", () => assert.equal(codigoProveedor("900", ""), "900"));
});
