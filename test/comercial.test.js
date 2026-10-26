import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  desplazarAnio, dimensionesPos, leerBodega, leerCanal, leerCanales, motivoExclusionPos, periodoAnterior,
} from "../src/comercial/reglas.js";
import { cuerpoIntegracion, cuerpoPeriodo, normalizarTotal } from "../src/comercial/respuesta.js";

describe("leerCanal", () => {
  it("vacío es CFE y acepta minúsculas", () => {
    assert.equal(leerCanal(undefined), "CFE");
    assert.equal(leerCanal(" vmf "), "VMF");
  });
  it("otro canal es null (CNC no entra al modelo)", () => {
    assert.equal(leerCanal("CNC"), null);
  });
});

describe("leerCanales", () => {
  it("lee la lista y quita repetidos", () => {
    assert.deepEqual(leerCanales("CFE, vmf,CFE"), ["CFE", "VMF"]);
  });
  it("vacía o con un canal inválido es null", () => {
    assert.equal(leerCanales(""), null);
    assert.equal(leerCanales("CFE,CNC"), null);
  });
});

describe("desplazarAnio (gemelo de CommercialSales.jsx)", () => {
  it("resta un año", () => assert.equal(desplazarAnio("2026-10-26"), "2025-10-26"));
  it("29 de febrero pasa a 28", () => assert.equal(desplazarAnio("2024-02-29"), "2023-02-28"));
  it("hacia adelante también respeta el fin de mes", () => assert.equal(desplazarAnio("2024-02-29", 1), "2025-02-28"));
  it("periodoAnterior corre las dos puntas", () => {
    assert.deepEqual(periodoAnterior({ desde: "2026-10-01", hasta: "2026-10-26" }), { desde: "2025-10-01", hasta: "2025-10-26" });
  });
});

describe("leerBodega", () => {
  it("recorta y acepta códigos cortos", () => assert.equal(leerBodega(" PV003 "), "PV003"));
  it("vacía o absurda es null", () => {
    assert.equal(leerBodega(""), null);
    assert.equal(leerBodega("x".repeat(21)), null);
  });
});

describe("motivoExclusionPos", () => {
  it("sin unidad de negocio ni tienda se suma", () => {
    assert.equal(motivoExclusionPos({ unidadNegocio: "", tienda: "", grupo: "01-ACEITES" }), null);
  });
  it("con unidad de negocio no se suma", () => {
    assert.match(motivoExclusionPos({ unidadNegocio: "001" }), /unidad de negocio/);
  });
  it("con tienda (o su alias sede) no se suma", () => {
    assert.match(motivoExclusionPos({ tienda: "00301" }), /tiendas POS/);
    assert.match(motivoExclusionPos({ sede: "00301" }), /tiendas POS/);
  });
});

describe("dimensionesPos", () => {
  it("vacíos son null", () => {
    assert.deepEqual(dimensionesPos({ grupo: " 10-CAFE ", marca: "" }), {
      grupo: "10-CAFE", subgrupo: null, proveedor: null, marca: null,
    });
  });
});

describe("respuesta", () => {
  it("normalizarTotal pasa texto a número y completa los campos", () => {
    assert.deepEqual(normalizarTotal({ ventas: "10.5", clientes: "3" }), {
      ventas: 10.5, contribucion: 0, documentos: 0, clientes: 3, unidades: 0, pesoKg: 0,
    });
  });
  it("cuerpoPeriodo sin rankings solo trae total y serie", () => {
    const cuerpo = cuerpoPeriodo({ total: {}, serie: [{ fecha: "2026-10-01", ventas: "5", documentos: "1" }] }, { conRankings: false });
    assert.deepEqual(Object.keys(cuerpo), ["total", "serie"]);
    assert.deepEqual(cuerpo.serie, [{ fecha: "2026-10-01", ventas: 5, documentos: 1 }]);
  });
  it("cuerpoPeriodo con rankings garantiza las cuatro listas", () => {
    const cuerpo = cuerpoPeriodo({ total: {}, serie: [] }, { conRankings: true });
    for (const lista of ["bodegas", "vendedores", "clientes", "productos"]) assert.deepEqual(cuerpo[lista], []);
  });
  it("cuerpoIntegracion suma la serie", () => {
    assert.deepEqual(cuerpoIntegracion(["CFE"], [
      { fecha: "2026-10-01", ventas: "20", contribucion: "5" },
      { fecha: "2026-10-02", ventas: "30", contribucion: "7" },
    ]), {
      canales: ["CFE"],
      ventas: 50,
      contribucion: 12,
      serie: [
        { fecha: "2026-10-01", ventas: 20, contribucion: 5 },
        { fecha: "2026-10-02", ventas: 30, contribucion: 7 },
      ],
    });
  });
});
