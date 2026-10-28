import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leerBodega, motivoRangoInvalido } from "../src/cajas/reglas.js";
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
