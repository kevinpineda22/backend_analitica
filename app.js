import "dotenv/config";
import process from "node:process";
import cors from "cors";
import express from "express";
import pg from "pg";

const { Pool } = pg;

const postgresConfigurado = [
  "POSTGRES_HOST",
  "POSTGRES_DATABASE",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
].every((variable) => Boolean(process.env[variable]));

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DATABASE || "postgres",
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT || 55000),
  options: "-c max_parallel_workers_per_gather=0",
  application_name: "merkahorro_powerbi_api",
});

pool.on("error", (error) => {
  console.error("Conexion inactiva de PostgreSQL terminada:", error.message);
});

const defaultAllowedOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://merkahorro.com",
  "https://www.merkahorro.com",
];
const allowedOrigins = (process.env.POWER_BI_ALLOWED_ORIGINS || defaultAllowedOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

function originPermitido(origin) {
  if (!origin) return true;
  const normalizedOrigin = origin.replace(/\/$/, "");
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === "*") return true;
    if (!allowedOrigin.startsWith("*.")) return normalizedOrigin === allowedOrigin;
    const hostname = new URL(normalizedOrigin).hostname;
    const suffix = allowedOrigin.slice(1);
    return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
  });
}

export const app = express();

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    try {
      callback(null, originPermitido(origin));
    } catch {
      callback(null, false);
    }
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use("/api/analitica", (_request, response, next) => {
  response.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=1800");
  next();
});

function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function numero(value) {
  return Number(value || 0);
}

function esTimeout(error) {
  return error?.code === "ETIMEDOUT"
    || error?.code === "57014"
    || /timeout|statement timeout/i.test(error?.message || "");
}

const ventaSubtotal = "COALESCE(SUM(COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0)), 0)";
const contribucion = `COALESCE(SUM(
  COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0) - COALESCE(v.costo, 0)
), 0)`;

const metricas = {
  pesos: ventaSubtotal,
  contribucion,
  unidades: "COALESCE(SUM(v.cantidad), 0)",
  clientes: "COUNT(DISTINCT NULLIF(BTRIM(v.nit_tercero), ''))::bigint",
  tickets: "COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint",
  ticket_promedio: `COALESCE(
    SUM(COALESCE(v.valor_bruto, 0) - COALESCE(v.vlr_tot_dscto, 0)) /
    NULLIF(COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto)), 0),
    0
  )`,
};

const itemDimension = `CASE
  WHEN BTRIM(item::text) ~ '^[0-9]+([.][0]+)?$'
    THEN COALESCE(NULLIF(LTRIM(SPLIT_PART(BTRIM(item::text), '.', 1), '0'), ''), '0')
  ELSE UPPER(BTRIM(item::text))
END`;

const itemVenta = `CASE
  WHEN BTRIM(v.id_item::text) ~ '^[0-9]+([.][0]+)?$'
    THEN COALESCE(NULLIF(LTRIM(SPLIT_PART(BTRIM(v.id_item::text), '.', 1), '0'), ''), '0')
  ELSE UPPER(BTRIM(v.id_item::text))
END`;

const cteFiltrado = `WITH dimensiones_item AS (
  SELECT ${itemDimension} AS item,
         COALESCE(NULLIF(BTRIM(MAX("001-GRUPO"::text)), ''), 'Sin grupo') AS grupo,
         COALESCE(NULLIF(BTRIM(MAX("002-SUBGRUPO"::text)), ''), 'Sin subgrupo') AS subgrupo,
         COALESCE(NULLIF(BTRIM(MAX("003-PROVEEDOR"::text)), ''), 'Sin proveedor') AS proveedor,
         COALESCE(NULLIF(BTRIM(MAX("004-MARCA"::text)), ''), 'Sin marca') AS marca
  FROM merkahorro_siesa.dimitems
  WHERE NULLIF(BTRIM(item::text), '') IS NOT NULL
  GROUP BY 1
), ventas AS (
  SELECT v.*, d.grupo, d.subgrupo, d.proveedor, d.marca
  FROM merkahorro_siesa.ventas_pdv_detalle v
  LEFT JOIN dimensiones_item d ON d.item = ${itemVenta}
  WHERE v.fecha_docto >= $1::date
    AND v.fecha_docto < $2::date + 1
    AND ($3::text IS NULL OR v.bodega::text = $3)
    AND ($4::text IS NULL OR BTRIM(v.unidad_de_negocio) = $4)
    AND ($5::text IS NULL OR d.grupo = $5)
    AND ($6::text IS NULL OR d.subgrupo = $6)
    AND ($7::text IS NULL OR d.proveedor = $7)
    AND ($8::text IS NULL OR d.marca = $8)
)`;

function parametros(request, desde, hasta) {
  return [
    desde,
    hasta,
    String(request.query.tienda || request.query.sede || "").trim() || null,
    String(request.query.unidadNegocio || "").trim() || null,
    String(request.query.grupo || "").trim() || null,
    String(request.query.subgrupo || "").trim() || null,
    String(request.query.proveedor || "").trim() || null,
    String(request.query.marca || "").trim() || null,
  ];
}

function validarPeriodo(request, response) {
  const desde = String(request.query.desde || "");
  const hasta = String(request.query.hasta || "");
  if (!fechaValida(desde) || !fechaValida(hasta)) {
    response.status(400).json({ ok: false, error: "El periodo no es valido." });
    return null;
  }
  if (desde > hasta) {
    response.status(400).json({
      ok: false,
      error: "La fecha inicial no puede ser posterior a la fecha final.",
    });
    return null;
  }
  return { desde, hasta };
}

function respuestaError(response, error, mensaje) {
  console.error(mensaje, error.message);
  response.status(esTimeout(error) ? 503 : 500).json({
    ok: false,
    error: esTimeout(error)
      ? "PostgreSQL tardo demasiado en responder. Intenta un periodo mas corto."
      : mensaje,
  });
}

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    servicio: "API de analitica",
    configuracion: {
      postgres: postgresConfigurado,
      cors: allowedOrigins.length > 0,
    },
  });
});

app.get(["/api", "/api/salud"], async (_request, response) => {
  try {
    const result = await pool.query("SELECT NOW() AS ahora");
    response.json({
      ok: true,
      data: {
        servicio: "API de analitica",
        ahora: result.rows[0].ahora,
      },
    });
  } catch (error) {
    respuestaError(response, error, "PostgreSQL no esta disponible.");
  }
});

app.get("/api/analitica/filtros", async (_request, response) => {
  try {
    let result;
    try {
      result = await pool.query(`WITH periodo AS (
        SELECT MIN(fecha)::date AS desde, MAX(fecha)::date AS hasta
        FROM merkahorro_siesa.ventas_pdv_resumen_diario
      )
      SELECT v.bodega::text AS codoc,
             MAX(v.desc_bodega) AS nombre,
             p.desde::text AS desde,
             p.hasta::text AS hasta,
             (SELECT ARRAY_AGG(DISTINCT BTRIM("001-GRUPO"::text) ORDER BY BTRIM("001-GRUPO"::text))
                FILTER (WHERE NULLIF(BTRIM("001-GRUPO"::text), '') IS NOT NULL)
              FROM merkahorro_siesa.dimitems) AS grupos,
             (SELECT ARRAY_AGG(DISTINCT BTRIM("002-SUBGRUPO"::text) ORDER BY BTRIM("002-SUBGRUPO"::text))
                FILTER (WHERE NULLIF(BTRIM("002-SUBGRUPO"::text), '') IS NOT NULL)
              FROM merkahorro_siesa.dimitems) AS subgrupos,
             (SELECT ARRAY_AGG(DISTINCT BTRIM("003-PROVEEDOR"::text) ORDER BY BTRIM("003-PROVEEDOR"::text))
                FILTER (WHERE NULLIF(BTRIM("003-PROVEEDOR"::text), '') IS NOT NULL)
              FROM merkahorro_siesa.dimitems) AS proveedores,
             (SELECT ARRAY_AGG(DISTINCT BTRIM("004-MARCA"::text) ORDER BY BTRIM("004-MARCA"::text))
                FILTER (WHERE NULLIF(BTRIM("004-MARCA"::text), '') IS NOT NULL)
              FROM merkahorro_siesa.dimitems) AS marcas
      FROM merkahorro_siesa.ventas_pdv_resumen_diario v
      CROSS JOIN periodo p
      WHERE v.fecha >= p.hasta - 90
      GROUP BY v.bodega, p.desde, p.hasta
      ORDER BY nombre`);
    } catch (error) {
      if (!["42P01", "42703"].includes(error.code)) throw error;
      result = await pool.query(`WITH periodo AS (
      SELECT MIN(fecha_docto)::date AS desde, MAX(fecha_docto)::date AS hasta
      FROM merkahorro_siesa.ventas_pdv_detalle
      WHERE fecha_docto IS NOT NULL
    )
    SELECT v.bodega::text AS codoc,
           COALESCE(NULLIF(BTRIM(MAX(v.desc_bodega)), ''), v.bodega::text) AS nombre,
           p.desde::text AS desde,
           p.hasta::text AS hasta,
           (SELECT ARRAY_AGG(DISTINCT BTRIM("001-GRUPO"::text) ORDER BY BTRIM("001-GRUPO"::text))
              FILTER (WHERE NULLIF(BTRIM("001-GRUPO"::text), '') IS NOT NULL)
            FROM merkahorro_siesa.dimitems) AS grupos,
           (SELECT ARRAY_AGG(DISTINCT BTRIM("002-SUBGRUPO"::text) ORDER BY BTRIM("002-SUBGRUPO"::text))
              FILTER (WHERE NULLIF(BTRIM("002-SUBGRUPO"::text), '') IS NOT NULL)
            FROM merkahorro_siesa.dimitems) AS subgrupos,
           (SELECT ARRAY_AGG(DISTINCT BTRIM("003-PROVEEDOR"::text) ORDER BY BTRIM("003-PROVEEDOR"::text))
              FILTER (WHERE NULLIF(BTRIM("003-PROVEEDOR"::text), '') IS NOT NULL)
            FROM merkahorro_siesa.dimitems) AS proveedores,
           (SELECT ARRAY_AGG(DISTINCT BTRIM("004-MARCA"::text) ORDER BY BTRIM("004-MARCA"::text))
              FILTER (WHERE NULLIF(BTRIM("004-MARCA"::text), '') IS NOT NULL)
            FROM merkahorro_siesa.dimitems) AS marcas
    FROM merkahorro_siesa.ventas_pdv_detalle v
    CROSS JOIN periodo p
    WHERE v.fecha_docto >= p.hasta - 90
      AND NULLIF(BTRIM(v.bodega::text), '') IS NOT NULL
    GROUP BY v.bodega, p.desde, p.hasta
    ORDER BY nombre`);
    }

    if (!result.rows.length || !result.rows[0].desde) {
      return response.status(404).json({ ok: false, error: "No hay ventas disponibles para analizar." });
    }

    const first = result.rows[0];
    return response.json({
      ok: true,
      data: {
        periodo: { desde: first.desde, hasta: first.hasta },
        tiendas: result.rows.map(({ codoc, nombre }) => ({ codoc, nombre })),
        grupos: first.grupos || [],
        subgrupos: first.subgrupos || [],
        proveedores: first.proveedores || [],
        marcas: first.marcas || [],
      },
    });
  } catch (error) {
    return respuestaError(response, error, "No fue posible cargar los filtros.");
  }
});

app.get("/api/analitica/bodegas", async (request, response) => {
  const periodo = validarPeriodo(request, response);
  if (!periodo) return;

  try {
    const result = await pool.query(`${cteFiltrado}
      SELECT v.bodega::text AS bodega,
             COALESCE(NULLIF(BTRIM(MAX(v.desc_bodega)), ''), v.bodega::text) AS "descBodega",
             COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint AS "numDocumentos",
             COALESCE(SUM(v.cantidad), 0) AS "totalCantidad",
             COALESCE(SUM(v.valor_bruto), 0) AS "totalBruto",
             COALESCE(SUM(v.vr_impto_det), 0) AS "totalImpuestos",
             COALESCE(SUM(v.vr_neto_det), 0) AS "totalNeto"
      FROM ventas v
      GROUP BY v.bodega
      ORDER BY "totalNeto" DESC`, parametros(request, periodo.desde, periodo.hasta));
    response.json({ ok: true, data: result.rows.map(normalizarNumerosBodega) });
  } catch (error) {
    respuestaError(response, error, "No fue posible consultar los totales por bodega.");
  }
});

function normalizarNumerosBodega(row) {
  return {
    ...row,
    numDocumentos: numero(row.numDocumentos),
    totalCantidad: numero(row.totalCantidad),
    totalBruto: numero(row.totalBruto),
    totalImpuestos: numero(row.totalImpuestos),
    totalNeto: numero(row.totalNeto),
  };
}

function normalizarValores(rows) {
  return rows.map((row) => ({
    ...row,
    valor: numero(row.valor),
    ...(row.contribucion == null ? {} : { contribucion: numero(row.contribucion) }),
  }));
}

async function consultarResumenDiario(desde, hasta, tienda, campoValor = "ventas") {
  const campo = campoValor === "contribucion" ? "contribucion" : "ventas";
  const result = await pool.query(`WITH diario AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
    ), bodegas AS (
      SELECT bodega, MAX(desc_bodega) AS nombre
      FROM merkahorro_siesa.ventas_pdv_resumen_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
      GROUP BY bodega
    ), negocios AS (
      SELECT unidad_negocio AS codigo,
             SUM(ventas) AS ventas,
             SUM(unidades) AS cantidad,
             SUM(tickets)::bigint AS tickets
      FROM merkahorro_siesa.ventas_pdv_resumen_negocio_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
      GROUP BY unidad_negocio
    )
    SELECT JSON_BUILD_OBJECT(
             'totalVentas', COALESCE(SUM(ventas), 0),
             'totalContribucion', COALESCE(SUM(contribucion), 0),
             'totalUnidades', COALESCE(SUM(unidades), 0),
             'totalImpuestos', COALESCE(SUM(impuestos), 0),
             'transacciones', COALESCE(SUM(tickets), 0),
             'clientesActivos', COALESCE((
               SELECT COUNT(DISTINCT cliente)
               FROM diario fila
               CROSS JOIN LATERAL UNNEST(fila.clientes) cliente
             ), 0),
             'valorActual', COALESCE(SUM(${campo}), 0)
           ) AS total,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY fecha)
             FROM (
               SELECT fecha::text AS fecha,
                 SUM(${campo}) AS valor,
                      SUM(contribucion) AS contribucion
               FROM diario GROUP BY fecha
             ) fila
           ), '[]'::json) AS serie,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC)
             FROM (
               SELECT bodega AS codoc, MAX(desc_bodega) AS nombre, SUM(${campo}) AS valor
               FROM diario GROUP BY bodega
             ) fila
           ), '[]'::json) AS sedes,
           COALESCE((SELECT JSON_AGG(negocios ORDER BY codigo) FROM negocios), '[]'::json) AS negocios
    FROM diario`, [desde, hasta, tienda || null]);
  return result.rows[0];
}

async function consultarDetallesDiarios(desde, hasta, tienda, campoValor = "ventas") {
  const campo = campoValor === "contribucion" ? "contribucion" : "ventas";
  const result = await pool.query(`WITH items AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_item_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
    )
    SELECT COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT grupo AS nombre, SUM(${campo}) AS valor
               FROM items GROUP BY grupo ORDER BY valor DESC LIMIT 15
             ) fila
           ), '[]'::json) AS grupos,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT subgrupo AS nombre, SUM(${campo}) AS valor
               FROM items GROUP BY subgrupo ORDER BY valor DESC LIMIT 15
             ) fila
           ), '[]'::json) AS subgrupos,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT proveedor AS nombre, SUM(${campo}) AS valor
               FROM items GROUP BY proveedor ORDER BY valor DESC LIMIT 15
             ) fila
           ), '[]'::json) AS proveedores,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT marca AS nombre, SUM(${campo}) AS valor
               FROM items GROUP BY marca ORDER BY valor DESC LIMIT 15
             ) fila
           ), '[]'::json) AS marcas,
           COALESCE((
             SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT item AS referencia, MAX(desc_item) AS nombre, SUM(${campo}) AS valor
               FROM items GROUP BY item ORDER BY valor DESC LIMIT 15
             ) fila
           ), '[]'::json) AS productos`, [desde, hasta, tienda || null]);
  return result.rows[0];
}

async function consultarResumenItemsFiltrado(values, metrica) {
  const campo = {
    pesos: "ventas",
    contribucion: "contribucion",
    unidades: "unidades",
  }[metrica];
  if (!campo) return null;

  const result = await pool.query(`WITH items AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_item_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
        AND ($4::text IS NULL OR unidad_negocio = $4)
        AND ($5::text IS NULL OR grupo = $5)
        AND ($6::text IS NULL OR subgrupo = $6)
        AND ($7::text IS NULL OR proveedor = $7)
        AND ($8::text IS NULL OR marca = $8)
    ), bodegas AS (
      SELECT bodega, MAX(desc_bodega) AS nombre
      FROM merkahorro_siesa.ventas_pdv_resumen_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
      GROUP BY bodega
    ), negocios AS (
      SELECT unidad_negocio AS codigo,
             SUM(ventas) AS ventas,
             SUM(unidades) AS cantidad
      FROM items GROUP BY unidad_negocio
    ), tickets_negocio AS (
      SELECT unidad_negocio AS codigo, COUNT(DISTINCT documento)::bigint AS tickets
      FROM items CROSS JOIN LATERAL UNNEST(documentos) documento
      GROUP BY unidad_negocio
    )
    SELECT JSON_BUILD_OBJECT(
             'totalVentas', COALESCE(SUM(ventas), 0),
             'totalContribucion', COALESCE(SUM(contribucion), 0),
             'totalUnidades', COALESCE(SUM(unidades), 0),
             'totalImpuestos', COALESCE(SUM(impuestos), 0),
             'transacciones', COALESCE((
               SELECT COUNT(DISTINCT documento)::bigint
               FROM items CROSS JOIN LATERAL UNNEST(documentos) documento
             ), 0),
             'clientesActivos', COALESCE((
               SELECT COUNT(DISTINCT cliente)::bigint
               FROM items CROSS JOIN LATERAL UNNEST(clientes) cliente
             ), 0),
             'valorActual', COALESCE(SUM(${campo}), 0)
           ) AS total,
           COALESCE((SELECT JSON_AGG(fila ORDER BY fecha) FROM (
             SELECT fecha::text AS fecha, SUM(${campo}) AS valor,
                    SUM(contribucion) AS contribucion
             FROM items GROUP BY fecha
           ) fila), '[]'::json) AS serie,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT i.bodega AS codoc, COALESCE(MAX(b.nombre), i.bodega) AS nombre,
                    SUM(i.${campo}) AS valor
             FROM items i LEFT JOIN bodegas b ON b.bodega = i.bodega
             GROUP BY i.bodega
           ) fila), '[]'::json) AS sedes,
           COALESCE((SELECT JSON_AGG(fila ORDER BY codigo) FROM (
             SELECT n.codigo, n.ventas, n.cantidad, COALESCE(t.tickets, 0) AS tickets
             FROM negocios n LEFT JOIN tickets_negocio t USING (codigo)
           ) fila), '[]'::json) AS negocios,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT grupo AS nombre, SUM(${campo}) AS valor
             FROM items GROUP BY grupo ORDER BY valor DESC LIMIT 15
           ) fila), '[]'::json) AS grupos,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT subgrupo AS nombre, SUM(${campo}) AS valor
             FROM items GROUP BY subgrupo ORDER BY valor DESC LIMIT 15
           ) fila), '[]'::json) AS subgrupos,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT proveedor AS nombre, SUM(${campo}) AS valor
             FROM items GROUP BY proveedor ORDER BY valor DESC LIMIT 15
           ) fila), '[]'::json) AS proveedores,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT marca AS nombre, SUM(${campo}) AS valor
             FROM items GROUP BY marca ORDER BY valor DESC LIMIT 15
           ) fila), '[]'::json) AS marcas,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT item AS referencia, MAX(desc_item) AS nombre, SUM(${campo}) AS valor
             FROM items GROUP BY item ORDER BY valor DESC LIMIT 15
           ) fila), '[]'::json) AS productos
    FROM items`, values);
  return result.rows[0];
}

async function consultarAnalisisKpiDiario(desde, hasta, tienda, metrica) {
  if (metrica === "clientes") {
    const result = await pool.query(`WITH diario AS MATERIALIZED (
        SELECT *
        FROM merkahorro_siesa.ventas_pdv_resumen_diario
        WHERE fecha >= $1::date AND fecha < $2::date + 1
          AND ($3::text IS NULL OR bodega = $3)
      ), clientes AS MATERIALIZED (
        SELECT d.fecha, d.bodega, d.desc_bodega, cliente
        FROM diario d
        CROSS JOIN LATERAL UNNEST(d.clientes) cliente
      )
      SELECT (SELECT COUNT(DISTINCT cliente)::bigint FROM clientes) AS "valorActual",
             COALESCE((SELECT JSON_AGG(fila ORDER BY fecha) FROM (
               SELECT fecha::text AS fecha, COUNT(DISTINCT cliente)::bigint AS valor
               FROM clientes GROUP BY fecha
             ) fila), '[]'::json) AS serie,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT bodega AS codoc, MAX(desc_bodega) AS nombre,
                      COUNT(DISTINCT cliente)::bigint AS valor
               FROM clientes GROUP BY bodega
             ) fila), '[]'::json) AS sedes`, [desde, hasta, tienda || null]);
    return { ...result.rows[0], grupos: [], productos: [] };
  }

  const agregados = {
    unidades: { numerador: "unidades", denominador: null },
    tickets: { numerador: "tickets", denominador: null },
    ticket_promedio: { numerador: "ventas", denominador: "tickets" },
  }[metrica];
  if (!agregados) return null;

  const valor = agregados.denominador
    ? `COALESCE(SUM(${agregados.numerador}) / NULLIF(SUM(${agregados.denominador}), 0), 0)`
    : `COALESCE(SUM(${agregados.numerador}), 0)`;
  const detallesUnidades = metrica === "unidades" ? `,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT grupo AS nombre, SUM(unidades) AS valor
               FROM items GROUP BY grupo ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS grupos,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT item AS referencia, MAX(desc_item) AS nombre, SUM(unidades) AS valor
               FROM items GROUP BY item ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS productos`
    : ", '[]'::json AS grupos, '[]'::json AS productos";
  const itemsCte = metrica === "unidades" ? `, items AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_item_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
    )` : "";

  const result = await pool.query(`WITH diario AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_diario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
    )${itemsCte}
    SELECT (SELECT ${valor} FROM diario) AS "valorActual",
           COALESCE((SELECT JSON_AGG(fila ORDER BY fecha) FROM (
             SELECT fecha::text AS fecha, ${valor} AS valor
             FROM diario GROUP BY fecha
           ) fila), '[]'::json) AS serie,
           COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
             SELECT bodega AS codoc, MAX(desc_bodega) AS nombre, ${valor} AS valor
             FROM diario GROUP BY bodega
           ) fila), '[]'::json) AS sedes
           ${detallesUnidades}`, [desde, hasta, tienda || null]);
  return result.rows[0];
}

app.get("/api/analitica/resumen", async (request, response) => {
  const periodo = validarPeriodo(request, response);
  if (!periodo) return;

  const metrica = String(request.query.metrica || "pesos");
  const metricaSql = metricas[metrica];
  if (!metricaSql) {
    return response.status(400).json({ ok: false, error: "Metrica no valida." });
  }

  const unidadNegocio = String(request.query.unidadNegocio || "").trim();
  if (unidadNegocio && !["001", "002", "003"].includes(unidadNegocio)) {
    return response.status(400).json({ ok: false, error: "Unidad de negocio no valida." });
  }

  const values = parametros(request, periodo.desde, periodo.hasta);
  const rapido = request.query.rapido === "1";

  try {
    const tieneFiltrosDimensionales = values.slice(3).some(Boolean);
    if (tieneFiltrosDimensionales) {
      try {
        const resumenFiltrado = await consultarResumenItemsFiltrado(values, metrica);
        if (resumenFiltrado) {
          const {
            total, serie, sedes, negocios, grupos,
            subgrupos, proveedores, marcas, productos,
          } = resumenFiltrado;
          const definiciones = {
            "001": { nombre: "Abarrotes", unidad: "UND" },
            "002": { nombre: "Fruver", unidad: "KL" },
            "003": { nombre: "Carnes", unidad: "KL" },
          };
          const negociosPorCodigo = new Map(negocios.map((row) => [row.codigo, row]));
          response.set("X-Analytics-Source", "resumen-item-filtrado");
          return response.json({
            ok: true,
            data: {
              periodo,
              metrica,
              serie: normalizarValores(serie),
              sedes: normalizarValores(sedes),
              grupos: normalizarValores(grupos),
              subgrupos: normalizarValores(subgrupos),
              proveedores: normalizarValores(proveedores),
              marcas: normalizarValores(marcas),
              productos: normalizarValores(productos),
              valorActual: numero(total.valorActual),
              valorAnterior: 0,
              variacion: null,
              totalVentas: numero(total.totalVentas),
              totalContribucion: numero(total.totalContribucion),
              totalUnidades: numero(total.totalUnidades),
              totalImpuestos: numero(total.totalImpuestos),
              transacciones: numero(total.transacciones),
              clientesActivos: numero(total.clientesActivos),
              unidadesNegocio: Object.entries(definiciones).map(([codigo, definicion]) => {
                const row = negociosPorCodigo.get(codigo) || {};
                const cantidad = numero(row.cantidad);
                const tickets = numero(row.tickets);
                return {
                  codigo,
                  ...definicion,
                  ventas: numero(row.ventas),
                  cantidad,
                  tickets,
                  promedio: tickets ? cantidad / tickets : 0,
                };
              }),
              parcial: false,
            },
          });
        }
      } catch (error) {
        if (!["42P01", "42703"].includes(error.code)) throw error;
        console.warn("Resumen por item incompleto; se usa la tabla transaccional.");
      }
    }

    const puedeUsarResumenDiario = rapido
      && metrica === "pesos"
      && !values.slice(3).some(Boolean);
    if (puedeUsarResumenDiario) {
      try {
        const { total, serie, sedes, negocios } = await consultarResumenDiario(
          periodo.desde,
          periodo.hasta,
          values[2],
        );
        const definiciones = {
          "001": { nombre: "Abarrotes", unidad: "UND" },
          "002": { nombre: "Fruver", unidad: "KL" },
          "003": { nombre: "Carnes", unidad: "KL" },
        };
        const negociosPorCodigo = new Map(negocios.map((row) => [row.codigo, row]));
        response.set("X-Analytics-Source", "resumen-diario");
        return response.json({
          ok: true,
          data: {
            periodo,
            metrica,
            serie: normalizarValores(serie),
            sedes: normalizarValores(sedes),
            grupos: [],
            subgrupos: [],
            proveedores: [],
            marcas: [],
            productos: [],
            valorActual: numero(total.valorActual),
            valorAnterior: 0,
            variacion: null,
            totalVentas: numero(total.totalVentas),
            totalContribucion: numero(total.totalContribucion),
            totalUnidades: numero(total.totalUnidades),
            totalImpuestos: numero(total.totalImpuestos),
            transacciones: numero(total.transacciones),
            clientesActivos: numero(total.clientesActivos),
            unidadesNegocio: Object.entries(definiciones).map(([codigo, definicion]) => {
              const row = negociosPorCodigo.get(codigo) || {};
              const cantidad = numero(row.cantidad);
              const tickets = numero(row.tickets);
              return {
                codigo,
                ...definicion,
                ventas: numero(row.ventas),
                cantidad,
                tickets,
                promedio: tickets ? cantidad / tickets : 0,
              };
            }),
            parcial: true,
          },
        });
      } catch (error) {
        if (!["42P01", "42703"].includes(error.code)) throw error;
        console.warn("Resumen diario no instalado; se usa la tabla transaccional.");
      }
    }

    const puedeUsarDetallesDiarios = !rapido
      && ["pesos", "contribucion"].includes(metrica)
      && !values.slice(3).some(Boolean);
    if (puedeUsarDetallesDiarios) {
      try {
        const campoValor = metrica === "contribucion" ? "contribucion" : "ventas";
        const { total, serie, sedes, negocios } = await consultarResumenDiario(
          periodo.desde,
          periodo.hasta,
          values[2],
          campoValor,
        );
        const detalles = await consultarDetallesDiarios(
          periodo.desde,
          periodo.hasta,
          values[2],
          campoValor,
        );
        const definiciones = {
          "001": { nombre: "Abarrotes", unidad: "UND" },
          "002": { nombre: "Fruver", unidad: "KL" },
          "003": { nombre: "Carnes", unidad: "KL" },
        };
        const negociosPorCodigo = new Map(negocios.map((row) => [row.codigo, row]));
        response.set("X-Analytics-Source", "resumen-diario");
        return response.json({
          ok: true,
          data: {
            periodo,
            metrica,
            serie: normalizarValores(serie),
            sedes: normalizarValores(sedes),
            grupos: normalizarValores(detalles.grupos),
            subgrupos: normalizarValores(detalles.subgrupos),
            proveedores: normalizarValores(detalles.proveedores),
            marcas: normalizarValores(detalles.marcas),
            productos: normalizarValores(detalles.productos),
            valorActual: numero(total.valorActual),
            valorAnterior: 0,
            variacion: null,
            totalVentas: numero(total.totalVentas),
            totalContribucion: numero(total.totalContribucion),
            totalUnidades: numero(total.totalUnidades),
            totalImpuestos: numero(total.totalImpuestos),
            transacciones: numero(total.transacciones),
            clientesActivos: numero(total.clientesActivos),
            unidadesNegocio: Object.entries(definiciones).map(([codigo, definicion]) => {
              const row = negociosPorCodigo.get(codigo) || {};
              const cantidad = numero(row.cantidad);
              const tickets = numero(row.tickets);
              return {
                codigo,
                ...definicion,
                ventas: numero(row.ventas),
                cantidad,
                tickets,
                promedio: tickets ? cantidad / tickets : 0,
              };
            }),
            parcial: false,
          },
        });
      } catch (error) {
        if (!["42P01", "42703"].includes(error.code)) throw error;
        console.warn("Detalle diario no instalado; se usa la tabla transaccional.");
      }
    }

    const puedeUsarAnalisisKpiDiario = !rapido
      && metrica !== "pesos"
      && !values.slice(3).some(Boolean);
    if (puedeUsarAnalisisKpiDiario) {
      try {
        const analisis = await consultarAnalisisKpiDiario(
          periodo.desde,
          periodo.hasta,
          values[2],
          metrica,
        );
        if (analisis) {
          response.set("X-Analytics-Source", "resumen-diario-kpi");
          return response.json({
            ok: true,
            data: {
              periodo,
              metrica,
              serie: normalizarValores(analisis.serie),
              sedes: normalizarValores(analisis.sedes),
              grupos: normalizarValores(analisis.grupos),
              subgrupos: [],
              proveedores: [],
              marcas: [],
              productos: normalizarValores(analisis.productos),
              valorActual: numero(analisis.valorActual),
              valorAnterior: 0,
              variacion: null,
              parcial: false,
            },
          });
        }
      } catch (error) {
        if (!["42P01", "42703"].includes(error.code)) throw error;
        console.warn("Resumen KPI no disponible; se usa la tabla transaccional.");
      }
    }

    if (rapido) {
      response.set("X-Analytics-Source", "transaccional");
      const result = await pool.query(`${cteFiltrado},
        totales AS (
           SELECT ${ventaSubtotal} AS "totalVentas",
             ${contribucion} AS "totalContribucion",
                 COALESCE(SUM(v.cantidad), 0) AS "totalUnidades",
                 COALESCE(SUM(v.vr_impto_det), 0) AS "totalImpuestos",
                 COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint AS transacciones,
                 COUNT(DISTINCT NULLIF(BTRIM(v.nit_tercero), ''))::bigint AS "clientesActivos",
                 ${metricaSql} AS "valorActual"
          FROM ventas v
        ),
        serie_resumen AS (
          SELECT v.fecha_docto::date::text AS fecha,
                 ${metricaSql} AS valor,
                 ${contribucion} AS contribucion
          FROM ventas v GROUP BY 1
        ),
        sedes_resumen AS (
          SELECT v.bodega::text AS codoc,
                 COALESCE(NULLIF(BTRIM(MAX(v.desc_bodega)), ''), v.bodega::text) AS nombre,
                 ${metricaSql} AS valor
          FROM ventas v GROUP BY v.bodega
        ),
        negocios_resumen AS (
          SELECT BTRIM(v.unidad_de_negocio) AS codigo,
                 ${ventaSubtotal} AS ventas,
                 COALESCE(SUM(v.cantidad), 0) AS cantidad,
                 COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint AS tickets
          FROM ventas v
          WHERE BTRIM(v.unidad_de_negocio) IN ('001', '002', '003')
          GROUP BY 1
        )
        SELECT ROW_TO_JSON(totales) AS total,
               COALESCE((SELECT JSON_AGG(serie_resumen ORDER BY fecha) FROM serie_resumen), '[]'::json) AS serie,
               COALESCE((SELECT JSON_AGG(sedes_resumen ORDER BY valor DESC) FROM sedes_resumen), '[]'::json) AS sedes,
               COALESCE((SELECT JSON_AGG(negocios_resumen ORDER BY codigo) FROM negocios_resumen), '[]'::json) AS negocios
        FROM totales`, values);
      const { total, serie, sedes, negocios } = result.rows[0];
      const definiciones = {
        "001": { nombre: "Abarrotes", unidad: "UND" },
        "002": { nombre: "Fruver", unidad: "KL" },
        "003": { nombre: "Carnes", unidad: "KL" },
      };
      const negociosPorCodigo = new Map(negocios.map((row) => [row.codigo, row]));

      return response.json({
        ok: true,
        data: {
          periodo,
          metrica,
          serie: normalizarValores(serie),
          sedes: normalizarValores(sedes),
          grupos: [],
          subgrupos: [],
          proveedores: [],
          marcas: [],
          productos: [],
          valorActual: numero(total.valorActual),
          valorAnterior: 0,
          variacion: null,
          totalVentas: numero(total.totalVentas),
          totalContribucion: numero(total.totalContribucion),
          totalUnidades: numero(total.totalUnidades),
          totalImpuestos: numero(total.totalImpuestos),
          transacciones: numero(total.transacciones),
          clientesActivos: numero(total.clientesActivos),
          unidadesNegocio: Object.entries(definiciones).map(([codigo, definicion]) => {
            const row = negociosPorCodigo.get(codigo) || {};
            const cantidad = numero(row.cantidad);
            const tickets = numero(row.tickets);
            return {
              codigo,
              ...definicion,
              ventas: numero(row.ventas),
              cantidad,
              tickets,
              promedio: tickets ? cantidad / tickets : 0,
            };
          }),
          parcial: true,
        },
      });
    }

    response.set("X-Analytics-Source", "transaccional");
    const consultaAnalisis = `${cteFiltrado.replace(", ventas AS (", ", ventas AS MATERIALIZED (")}
      SELECT (
               SELECT JSON_BUILD_OBJECT(
                 'totalVentas', ${ventaSubtotal},
                 'totalContribucion', ${contribucion},
                 'totalUnidades', COALESCE(SUM(v.cantidad), 0),
                 'totalImpuestos', COALESCE(SUM(v.vr_impto_det), 0),
                 'transacciones', COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint,
                 'clientesActivos', COUNT(DISTINCT NULLIF(BTRIM(v.nit_tercero), ''))::bigint,
                 'valorActual', ${metricaSql}
               ) FROM ventas v
             ) AS total,
             COALESCE((SELECT JSON_AGG(fila ORDER BY fecha) FROM (
               SELECT v.fecha_docto::date::text AS fecha,
                      ${metricaSql} AS valor,
                      ${contribucion} AS contribucion
               FROM ventas v GROUP BY 1
             ) fila), '[]'::json) AS serie,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT v.bodega::text AS codoc,
                      COALESCE(NULLIF(BTRIM(MAX(v.desc_bodega)), ''), v.bodega::text) AS nombre,
                      ${metricaSql} AS valor
               FROM ventas v GROUP BY v.bodega
             ) fila), '[]'::json) AS sedes,
             COALESCE((SELECT JSON_AGG(fila ORDER BY codigo) FROM (
               SELECT BTRIM(v.unidad_de_negocio) AS codigo,
                      ${ventaSubtotal} AS ventas,
                      COALESCE(SUM(v.cantidad), 0) AS cantidad,
                      COUNT(DISTINCT (v.cia, v.bodega, v.id_tipo_docto, v.consec_docto))::bigint AS tickets
               FROM ventas v
               WHERE BTRIM(v.unidad_de_negocio) IN ('001', '002', '003')
               GROUP BY 1
             ) fila), '[]'::json) AS negocios,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT COALESCE(v.grupo, 'Sin grupo') AS nombre, ${metricaSql} AS valor
               FROM ventas v GROUP BY 1 ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS grupos,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT COALESCE(v.subgrupo, 'Sin subgrupo') AS nombre, ${metricaSql} AS valor
               FROM ventas v GROUP BY 1 ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS subgrupos,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT COALESCE(v.proveedor, 'Sin proveedor') AS nombre, ${metricaSql} AS valor
               FROM ventas v GROUP BY 1 ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS proveedores,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT COALESCE(v.marca, 'Sin marca') AS nombre, ${metricaSql} AS valor
               FROM ventas v GROUP BY 1 ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS marcas,
             COALESCE((SELECT JSON_AGG(fila ORDER BY valor DESC) FROM (
               SELECT v.id_item::text AS referencia,
                      COALESCE(NULLIF(BTRIM(MAX(v.desc_item)), ''), v.id_item::text) AS nombre,
                      ${metricaSql} AS valor
               FROM ventas v
               WHERE v.id_item IS NOT NULL
               GROUP BY v.id_item ORDER BY valor DESC LIMIT 15
             ) fila), '[]'::json) AS productos`;
    const resultadoAnalisis = await pool.query(consultaAnalisis, values);
    const {
      total, serie, sedes, negocios: filasNegocios,
      grupos, subgrupos, proveedores, marcas, productos,
    } = resultadoAnalisis.rows[0];
    const definiciones = {
      "001": { nombre: "Abarrotes", unidad: "UND" },
      "002": { nombre: "Fruver", unidad: "KL" },
      "003": { nombre: "Carnes", unidad: "KL" },
    };
    const negocios = new Map(filasNegocios.map((row) => [row.codigo, row]));

    return response.json({
      ok: true,
      data: {
        periodo,
        metrica,
        serie: normalizarValores(serie),
        sedes: normalizarValores(sedes),
        grupos: normalizarValores(grupos),
        subgrupos: normalizarValores(subgrupos),
        proveedores: normalizarValores(proveedores),
        marcas: normalizarValores(marcas),
        productos: normalizarValores(productos),
        valorActual: numero(total.valorActual),
        valorAnterior: 0,
        variacion: null,
        totalVentas: numero(total.totalVentas),
        totalContribucion: numero(total.totalContribucion),
        totalUnidades: numero(total.totalUnidades),
        totalImpuestos: numero(total.totalImpuestos),
        transacciones: numero(total.transacciones),
        clientesActivos: numero(total.clientesActivos),
        unidadesNegocio: Object.entries(definiciones).map(([codigo, definicion]) => {
          const row = negocios.get(codigo) || {};
          const ventas = numero(row.ventas);
          const cantidad = numero(row.cantidad);
          const tickets = numero(row.tickets);
          return {
            codigo,
            ...definicion,
            ventas,
            cantidad,
            tickets,
            promedio: tickets ? cantidad / tickets : 0,
          };
        }),
        parcial: rapido,
      },
    });
  } catch (error) {
    return respuestaError(response, error, "No fue posible consultar la analitica.");
  }
});

app.get("/api/analitica/modelo", (_request, response) => {
  response.json({
    ok: true,
    data: {
      metricas: Object.keys(metricas),
      filtros: ["desde", "hasta", "tienda", "unidadNegocio", "grupo", "subgrupo", "proveedor", "marca"],
      unidadesNegocio: [
        { codigo: "001", nombre: "Abarrotes", unidad: "UND" },
        { codigo: "002", nombre: "Fruver", unidad: "KL" },
        { codigo: "003", nombre: "Carnes", unidad: "KL" },
      ],
    },
  });
});

app.use((_request, response) => {
  response.status(404).json({ ok: false, error: "Ruta no encontrada." });
});

export default app;