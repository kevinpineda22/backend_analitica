import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requiereModulo } from "../src/auth/middleware.js";
import { crearResolverAcceso, ErrorAuth } from "../src/auth/supabaseAuth.js";

function respuestaFalsa() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function correr(middleware, headers = {}) {
  const request = { method: "GET", originalUrl: "/api/analitica/resumen", headers };
  const response = respuestaFalsa();
  let siguio = false;
  await middleware(request, response, () => { siguio = true; });
  return { request, response, siguio };
}

const conToken = { authorization: "Bearer t" };
const accesoCon = (acceso) => async () => acceso;
const fallaCon = (motivo) => async () => { throw new ErrorAuth(motivo, "x"); };
const silencio = () => {};

describe("requiereModulo en enforce", () => {
  const crear = (resolverAcceso) =>
    requiereModulo("/power-bi", { modo: "enforce", resolverAcceso, log: silencio });

  it("sin token responde 401", async () => {
    const { response, siguio } = await correr(crear(accesoCon({})));
    assert.equal(siguio, false);
    assert.equal(response.statusCode, 401);
  });
  it("token inválido responde 401", async () => {
    const { response } = await correr(crear(fallaCon("token_invalido")), conToken);
    assert.equal(response.statusCode, 401);
  });
  it("sin permiso responde 403", async () => {
    const { response } = await correr(crear(accesoCon({ role: "compras", rutasPersonales: [] })), conToken);
    assert.equal(response.statusCode, 403);
  });
  it("Supabase caído responde 503", async () => {
    const { response } = await correr(crear(fallaCon("no_disponible")), conToken);
    assert.equal(response.statusCode, 503);
  });
  it("un error inesperado también cierra con 503", async () => {
    const { response } = await correr(crear(async () => { throw new Error("boom"); }), conToken);
    assert.equal(response.statusCode, 503);
  });
  it("con permiso sigue y deja el acceso en request.usuario", async () => {
    const acceso = { role: "admin", email: "a@b.co" };
    const { siguio, request } = await correr(crear(accesoCon(acceso)), conToken);
    assert.equal(siguio, true);
    assert.equal(request.usuario, acceso);
  });
});

describe("requiereModulo en report", () => {
  it("deja pasar y registra al que habría rechazado", async () => {
    const logs = [];
    const middleware = requiereModulo("/power-bi", {
      modo: "report",
      resolverAcceso: accesoCon({ role: "compras", email: "c@d.co" }),
      log: (msg) => logs.push(msg),
    });
    const sinToken = await correr(middleware);
    const sinPermiso = await correr(middleware, conToken);
    assert.equal(sinToken.siguio, true);
    assert.equal(sinPermiso.siguio, true);
    assert.match(logs[0], /\[auth:report\] sin_token/);
    assert.match(logs[1], /sin_permiso .*usuario=c@d\.co/);
  });
  it("con Supabase caído no frena", async () => {
    const middleware = requiereModulo("/power-bi", {
      modo: "report", resolverAcceso: fallaCon("no_disponible"), log: silencio,
    });
    assert.equal((await correr(middleware, conToken)).siguio, true);
  });
});

describe("requiereModulo en off", () => {
  it("no llama a Supabase", async () => {
    let llamado = false;
    const middleware = requiereModulo("/power-bi", {
      modo: "off", resolverAcceso: async () => { llamado = true; }, log: silencio,
    });
    assert.equal((await correr(middleware)).siguio, true);
    assert.equal(llamado, false);
  });
});

function fetchFalso(rutas) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url, opciones });
    const ruta = Object.keys(rutas).find((clave) => url.includes(clave));
    const [status, body] = rutas[ruta] || [404, {}];
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetchImpl, llamadas };
}

describe("crearResolverAcceso", () => {
  const supabaseOk = {
    "/auth/v1/user": [200, { id: "u1", email: "u@m.co" }],
    "/rest/v1/profiles": [200, [{ role: "compras", personal_routes: [{ path: "/power-bi" }] }]],
    "/rest/v1/role_permissions": [200, [{ permissions: [{ path: "/x" }], redirect: "/x" }]],
  };

  it("arma el acceso con el perfil y el rol, usando el token del usuario", async () => {
    const { fetchImpl, llamadas } = fetchFalso(supabaseOk);
    const resolver = crearResolverAcceso({ url: "https://s.co/", anonKey: "anon", fetchImpl });
    const acceso = await resolver("tok");
    assert.deepEqual(acceso, {
      userId: "u1",
      email: "u@m.co",
      role: "compras",
      rutasPersonales: [{ path: "/power-bi" }],
      rutasRol: [{ path: "/x" }],
      redirect: "/x",
    });
    assert.equal(llamadas[0].url, "https://s.co/auth/v1/user");
    assert.equal(llamadas[0].opciones.headers.Authorization, "Bearer tok");
    assert.equal(llamadas[0].opciones.headers.apikey, "anon");
  });

  it("guarda el resultado por token y no vuelve a preguntar", async () => {
    const { fetchImpl, llamadas } = fetchFalso(supabaseOk);
    const resolver = crearResolverAcceso({ url: "https://s.co", anonKey: "anon", fetchImpl });
    await resolver("tok");
    await resolver("tok");
    assert.equal(llamadas.length, 3);
  });

  it("vuelve a preguntar cuando pasan 60 s", async () => {
    const { fetchImpl, llamadas } = fetchFalso(supabaseOk);
    let reloj = 0;
    const resolver = crearResolverAcceso({ url: "https://s.co", anonKey: "anon", fetchImpl, ahora: () => reloj });
    await resolver("tok");
    reloj = 61_000;
    await resolver("tok");
    assert.equal(llamadas.length, 6);
  });

  it("un 401 de Supabase es token_invalido", async () => {
    const { fetchImpl } = fetchFalso({ "/auth/v1/user": [401, {}] });
    const resolver = crearResolverAcceso({ url: "https://s.co", anonKey: "anon", fetchImpl });
    await assert.rejects(resolver("tok"), { motivo: "token_invalido" });
  });

  it("sin perfil es perfil_no_encontrado", async () => {
    const { fetchImpl } = fetchFalso({ ...supabaseOk, "/rest/v1/profiles": [200, []] });
    const resolver = crearResolverAcceso({ url: "https://s.co", anonKey: "anon", fetchImpl });
    await assert.rejects(resolver("tok"), { motivo: "perfil_no_encontrado" });
  });

  it("un 500 o un corte de red es no_disponible", async () => {
    const caido = fetchFalso({ "/auth/v1/user": [500, {}] });
    await assert.rejects(
      crearResolverAcceso({ url: "https://s.co", anonKey: "a", fetchImpl: caido.fetchImpl })("tok"),
      { motivo: "no_disponible" },
    );
    const sinRed = async () => { throw new Error("ECONNRESET"); };
    await assert.rejects(
      crearResolverAcceso({ url: "https://s.co", anonKey: "a", fetchImpl: sinRed })("tok"),
      { motivo: "no_disponible" },
    );
  });

  it("sin configuración es no_disponible, no un crash", async () => {
    await assert.rejects(crearResolverAcceso({})("tok"), { motivo: "no_disponible" });
  });
});
