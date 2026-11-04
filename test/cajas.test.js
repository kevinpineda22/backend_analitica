import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leerBodega, leerCaja, motivoRangoInvalido } from "../src/cajas/reglas.js";
import { cuerpoHistorico } from "../src/cajas/respuesta.js";

describe("reglas de cajas", () => {
  it("el histórico admite hasta 366 días", () => {
    assert.equal(motivoRangoInvalido({ desde: "2025-10-28", hasta: "2026-10-28" }), null);
    assert.match(motivoRangoInvalido({ desde: "2025-10-27", hasta: "2026-10-28" }), /366 dias/);
  });
  it("la bodega es opcional: vacía o absurda es null", () => {
    assert.equal(leerBodega(" PV001 "), "PV001");
    assert.equal(leerBodega(""), null);
    assert.equal(leerBodega("x".repeat(21)), null);
  });
  it("la caja va con dos dígitos y solo con sede: la caja 3 existe en casi todas", () => {
    assert.equal(leerCaja("3", "PV001"), "03");
    assert.equal(leerCaja("10", "PV001"), "10");
    assert.equal(leerCaja("sin_caja", "PV001"), "SIN_CAJA");
    assert.equal(leerCaja("3", null), null);
    assert.equal(leerCaja("P03", "PV001"), null);
    assert.equal(leerCaja("", "PV001"), null);
  });
});

describe("cuerpoHistorico", () => {
  it("pasa a número y calcula documentos por hora", () => {
    const cuerpo = cuerpoHistorico({
      total: { documentos: "100", devoluciones: "2", venta: "5000", dias: "2", cajeras: "3" },
      mapa: [{ diaSemana: 6, hora: 11, documentos: "118.75", venta: "250000.4", cajeras: "5.25" }],
      cajeras: [{ cajera: "ana", bodega: "PV001", documentos: "60", devoluciones: "1", venta: "300", dias: "2", horas: "7.5" }],
      sedes: [{ codigo: "PV001", nombre: "Copacabana", documentos: "100", venta: "5000", cajeras: "3" }],
    });
    assert.equal(cuerpo.total.documentos, 100);
    assert.equal(cuerpo.total.devoluciones, 2);
    assert.deepEqual(cuerpo.mapa[0], { diaSemana: 6, hora: 11, documentos: 118.8, venta: 250000, cajeras: 5.3 });
    assert.equal(cuerpo.cajeras[0].documentosPorHora, 8);
    assert.equal(cuerpo.cajeras[0].devoluciones, 1);
    assert.deepEqual(cuerpo.cajas, []);
  });
  it("cada caja trae su ritmo y su hora pico en un día promedio", () => {
    const cuerpo = cuerpoHistorico({
      total: { documentos: "0", devoluciones: "0", venta: "0", dias: "0", cajeras: "0" },
      mapa: [], sedes: [], cajeras: [],
      cajas: [{ bodega: "PV001", nombreSede: "Copacabana", caja: "03", documentos: "400", devoluciones: "2", venta: "40000",
        dias: "4", horas: "20", cajeras: "3", horaPico: 11, documentosPico: "120" }],
    });
    assert.deepEqual(cuerpo.cajas[0], {
      bodega: "PV001", nombreSede: "Copacabana", caja: "03", documentos: 400, devoluciones: 2, venta: 40000,
      dias: 4, horas: 20, cajeras: 3, documentosPorHora: 20, horaPico: 11, documentosPico: 30,
    });
  });
  it("una cajera sin horas no divide por cero", () => {
    const cuerpo = cuerpoHistorico({
      total: { documentos: "0", devoluciones: "0", venta: "0", dias: "0", cajeras: "0" },
      mapa: [], sedes: [],
      cajeras: [{ cajera: "ana", bodega: "PV001", documentos: "0", devoluciones: "0", venta: "0", dias: "0", horas: "0" }],
    });
    assert.equal(cuerpo.cajeras[0].documentosPorHora, null);
  });
});
