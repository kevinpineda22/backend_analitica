import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cubre, modoAuth, pathsDe, puedeVer, tokenDelHeader, vencimientoDelToken,
} from "../src/auth/permisos.js";

describe("cubre (gemelo de src/config/autorizacionRutas.js del front)", () => {
  it("cubre la ruta exacta y sus hijas", () => {
    assert.equal(cubre("/power-bi", "/power-bi"), true);
    assert.equal(cubre("/power-bi", "/power-bi/detalle"), true);
  });
  it("no cubre vecinos de nombre parecido ni distinto uso de mayúsculas", () => {
    assert.equal(cubre("/power-bi", "/power-bix"), false);
    assert.equal(cubre("/Power-bi", "/power-bi"), false);
  });
});

describe("modoAuth", () => {
  it("sin valor es report", () => {
    assert.equal(modoAuth(undefined), "report");
    assert.equal(modoAuth(""), "report");
  });
  it("acepta los tres modos sin importar mayúsculas", () => {
    assert.equal(modoAuth("OFF"), "off");
    assert.equal(modoAuth(" enforce "), "enforce");
  });
  it("un valor desconocido cierra", () => {
    assert.equal(modoAuth("enforced"), "enforce");
  });
});

describe("tokenDelHeader", () => {
  it("lee Bearer", () => assert.equal(tokenDelHeader("Bearer abc.def"), "abc.def"));
  it("rechaza otras formas", () => {
    assert.equal(tokenDelHeader("abc"), null);
    assert.equal(tokenDelHeader("Bearer a b"), null);
    assert.equal(tokenDelHeader(undefined), null);
  });
});

describe("pathsDe", () => {
  it("acepta objetos {path} y strings, descarta basura", () => {
    assert.deepEqual(pathsDe([{ path: "/a" }, "/b", null, { nombre: "x" }]), ["/a", "/b"]);
    assert.deepEqual(pathsDe(null), []);
  });
});

describe("puedeVer", () => {
  it("admin y super_admin ven todo", () => {
    assert.equal(puedeVer({ role: "admin" }, "/power-bi"), true);
    assert.equal(puedeVer({ role: "Super_Admin" }, "/power-bi"), true);
  });
  it("una ruta personal que cubre el módulo habilita", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [{ path: "/power-bi" }] }, "/power-bi"), true);
  });
  it("las rutas personales PISAN las del rol", () => {
    const acceso = {
      role: "compras",
      rutasPersonales: [{ path: "/traslados" }],
      rutasRol: [{ path: "/power-bi" }],
    };
    assert.equal(puedeVer(acceso, "/power-bi"), false);
  });
  it("sin rutas personales mandan las del rol", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [], rutasRol: [{ path: "/power-bi" }] }, "/power-bi"), true);
  });
  it("el redirect del rol habilita su pantalla de inicio", () => {
    assert.equal(puedeVer({ role: "gerencia", redirect: "/power-bi" }, "/power-bi"), true);
  });
  it("sin nada de lo anterior, no", () => {
    assert.equal(puedeVer({ role: "compras", rutasPersonales: [{ path: "/ventas-comerciales" }] }, "/power-bi"), false);
    assert.equal(puedeVer(null, "/power-bi"), false);
  });
});

describe("vencimientoDelToken", () => {
  it("lee exp en milisegundos", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1000 })).toString("base64url");
    assert.equal(vencimientoDelToken(`h.${payload}.s`), 1_000_000);
  });
  it("un token ilegible da null", () => assert.equal(vencimientoDelToken("nada"), null));
});
