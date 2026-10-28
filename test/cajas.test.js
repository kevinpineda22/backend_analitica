import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cajerasNecesarias, diaSemana, fechaCorte, indexar, motivoRangoInvalido, pronosticar, semanasReferencia,
  tendencia, ventanasNecesarias,
} from "../src/cajas/reglas.js";
import { cuerpoHistorico } from "../src/cajas/respuesta.js";

const fila = (fecha, documentos, franja = "10:00", cajeras = 1) => ({ fecha, franja, documentos: String(documentos), cajeras });

describe("fechas", () => {
  it("día de la semana ISO: lunes 1, domingo 7", () => {
    assert.equal(diaSemana("2026-10-26"), 1);
    assert.equal(diaSemana("2026-10-25"), 7);
  });
  it("un día pasado se pronostica con lo que se sabía la víspera", () => {
    assert.equal(fechaCorte("2026-10-20", "2026-10-27"), "2026-10-19");
  });
  it("un día futuro, con el último día cargado", () => {
    assert.equal(fechaCorte("2026-11-05", "2026-10-27"), "2026-10-27");
  });
  it("el pronóstico admite 14 días", () => {
    assert.equal(motivoRangoInvalido({ desde: "2026-11-01", hasta: "2026-11-14" }), null);
    assert.match(motivoRangoInvalido({ desde: "2026-11-01", hasta: "2026-11-15" }), /14 dias/);
  });
  it("las ventanas cubren 8 semanas atrás y el año pasado con su tendencia", () => {
    assert.deepEqual(ventanasNecesarias({ desde: "2026-10-26", hasta: "2026-11-01" }, "2026-10-27"), {
      reciente: { desde: "2026-08-30", hasta: "2026-11-01" },
      anioPasado: { desde: "2025-09-28", hasta: "2025-11-02" },
    });
  });
});

describe("semanasReferencia", () => {
  const indice = indexar([fila("2026-10-19", 5), fila("2026-10-05", 5), fila("2026-09-28", 5), fila("2026-09-21", 5)]);

  it("salta el mismo día sin ventas (12-oct, festivo) y sigue buscando", () => {
    assert.deepEqual(semanasReferencia(indice, "2026-10-26", "2026-10-25"),
      ["2026-10-19", "2026-10-05", "2026-09-28", "2026-09-21"]);
  });
  it("para un día futuro arranca desde el último día cargado", () => {
    assert.deepEqual(semanasReferencia(indice, "2026-11-09", "2026-10-27").slice(0, 2), ["2026-10-19", "2026-10-05"]);
  });
});

describe("tendencia", () => {
  it("últimas 4 semanas ÷ las mismas del año pasado", () => {
    const indice = indexar([fila("2026-10-20", 120), fila("2025-10-21", 100)]);
    assert.equal(tendencia(indice, "2026-10-25"), 1.2);
  });
  it("fuera de 0,5–2 es una sede que abrió o cerró: null", () => {
    const indice = indexar([fila("2026-10-20", 300), fila("2025-10-21", 100)]);
    assert.equal(tendencia(indice, "2026-10-25"), null);
  });
  it("sin año pasado: null", () => assert.equal(tendencia(indexar([fila("2026-10-20", 1)]), "2026-10-25"), null));
});

describe("cajerasNecesarias", () => {
  it("redondea para arriba con el margen", () => assert.equal(cajerasNecesarias(32.5, 5, 0.15), 8));
  it("con la sede abierta, al menos una", () => assert.equal(cajerasNecesarias(0.4, 5, 0.15), 1));
  it("sin demanda o sin capacidad medida, cero", () => {
    assert.equal(cajerasNecesarias(0, 5), 0);
    assert.equal(cajerasNecesarias(10, null), 0);
  });
});

describe("pronosticar: mezcla de semanas y año pasado", () => {
  // Lunes 26-oct. Semanas: 10, 20, 30, 40 → 25. Tendencia: 100 este año vs 50
  // el año pasado → 2. Año: lunes 27-oct-2025 con 20 → 40. Mezcla: 32,5.
  const filas = [
    fila("2026-10-19", 10), fila("2026-10-12", 20), fila("2026-10-05", 30), fila("2026-09-28", 40),
    fila("2025-10-20", 50), fila("2025-10-27", 20),
    fila("2026-10-26", 30, "10:00", 4), fila("2026-10-26", 2, "20:45", 1),
  ];
  const [dia] = pronosticar({ desde: "2026-10-26", hasta: "2026-10-26" }, filas, { ultimoDia: "2026-10-27", capacidad: 5 });
  const diez = dia.franjas.find((f) => f.franja === "10:00");

  it("usa la mezcla y dice con qué fechas", () => {
    assert.equal(dia.metodo, "mezcla");
    assert.deepEqual(dia.referencias, {
      semanas: ["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28"], anioPasado: "2025-10-27", tendencia: 2,
    });
  });
  it("esperado = (semanas + año × tendencia) ÷ 2", () => {
    assert.equal(diez.semanas, 25);
    assert.equal(diez.anioPasado, 40);
    assert.equal(diez.esperado, 32.5);
    assert.equal(diez.cajerasNecesarias, 8);
  });
  it("un día pasado trae lo real para comparar", () => {
    assert.equal(diez.real, 30);
    assert.equal(diez.cajerasReales, 4);
    assert.equal(dia.real, 32);
    assert.equal(dia.picoCajerasReales, 4);
  });
  it("una franja que solo tuvo ventas en lo real se pronostica en cero", () => {
    const tarde = dia.franjas.find((f) => f.franja === "20:45");
    assert.equal(tarde.esperado, 0);
    assert.equal(tarde.cajerasNecesarias, 0);
    assert.equal(tarde.real, 2);
  });
  it("sin año pasado usa solo las semanas", () => {
    const [solo] = pronosticar({ desde: "2026-10-26", hasta: "2026-10-26" }, filas.slice(0, 4),
      { ultimoDia: "2026-10-27", capacidad: 5 });
    assert.equal(solo.metodo, "semanas");
    assert.equal(solo.franjas[0].esperado, 25);
    assert.equal(solo.real, null);
  });
  it("un día futuro no tiene real", () => {
    const [futuro] = pronosticar({ desde: "2026-11-02", hasta: "2026-11-02" }, filas, { ultimoDia: "2026-10-27", capacidad: 5 });
    assert.equal(futuro.real, null);
    assert.equal(futuro.franjas[0].real, null);
  });
});

describe("cuerpoHistorico", () => {
  it("pasa a número y calcula documentos por hora", () => {
    const cuerpo = cuerpoHistorico({
      total: { documentos: "100", venta: "5000", dias: "2", cajeras: "3" },
      mapa: [{ diaSemana: 6, hora: 11, documentos: "118.75", cajeras: "5.25" }],
      cajeras: [{ cajera: "ana", bodega: "PV001", documentos: "60", venta: "300", dias: "2", horas: "7.5" }],
      sedes: [{ codigo: "PV001", nombre: "Copacabana", documentos: "100", venta: "5000", cajeras: "3" }],
    });
    assert.equal(cuerpo.total.documentos, 100);
    assert.deepEqual(cuerpo.mapa[0], { diaSemana: 6, hora: 11, documentos: 118.8, cajeras: 5.3 });
    assert.equal(cuerpo.cajeras[0].documentosPorHora, 8);
  });
});
