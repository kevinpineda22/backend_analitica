/* Consultas de Ventas POS. Cada una devuelve la fila cruda de Postgres; el
   armado de la respuesta vive en `respuesta.js`. */

import { contribucion, cteFiltrado, metricas, ventaSubtotal } from "./sql.js";

const campoDe = (campoValor) => (campoValor === "contribucion" ? "contribucion" : "ventas");

export async function consultarFiltros(pool) {
  const result = await pool.query(`WITH periodo AS (
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
  return result.rows;
}

export async function consultarBodegas(pool, values) {
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
    ORDER BY "totalNeto" DESC`, values);
  return result.rows;
}

export async function consultarResumenDiario(pool, desde, hasta, tienda, campoValor = "ventas") {
  const campo = campoDe(campoValor);
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

export async function consultarDetallesDiarios(pool, desde, hasta, tienda, campoValor = "ventas") {
  const campo = campoDe(campoValor);
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

const CAMPO_ITEM = { pesos: "ventas", contribucion: "contribucion", unidades: "unidades" };

export async function consultarResumenItemsFiltrado(pool, values, metrica) {
  const campo = CAMPO_ITEM[metrica];
  if (!campo) throw new Error(`La metrica ${metrica} no se puede sumar por item.`);

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

export async function consultarAnalisisKpiDiario(pool, desde, hasta, tienda, metrica) {
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
  if (!agregados) throw new Error(`La metrica ${metrica} no tiene resumen KPI.`);

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

/** Totales y serie desde la transaccional, sin top 15 (primera carga del tablero). */
export async function consultarTransaccionalRapido(pool, values, metrica) {
  const metricaSql = metricas[metrica];
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
  return result.rows[0];
}

/** Análisis completo desde la transaccional, con top 15 por dimensión. */
export async function consultarTransaccionalCompleto(pool, values, metrica) {
  const metricaSql = metricas[metrica];
  const result = await pool.query(`${cteFiltrado.replace(", ventas AS (", ", ventas AS MATERIALIZED (")}
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
          ) fila), '[]'::json) AS productos`, values);
  return result.rows[0];
}

export async function consultarOperacionHoraria(pool, desde, hasta, tienda) {
  const result = await pool.query(`WITH base AS MATERIALIZED (
      SELECT *
      FROM merkahorro_siesa.ventas_pdv_resumen_horario
      WHERE fecha >= $1::date AND fecha < $2::date + 1
        AND ($3::text IS NULL OR bodega = $3)
    ), horas AS (
      SELECT hora,
             SUM(venta) AS ventas,
             COUNT(*)::bigint AS tickets,
             COUNT(DISTINCT caja)::integer AS cajas,
             AVG(duracion_segundos) FILTER (WHERE lineas > 1) AS duracion,
             SUM(productos)::bigint AS productos
      FROM base GROUP BY hora
    ), dias AS (
      SELECT fecha::text AS fecha, SUM(venta) AS ventas,
             COUNT(*)::bigint AS tickets,
             COUNT(DISTINCT caja)::integer AS cajas
      FROM base GROUP BY fecha
    ), tiendas AS (
      SELECT bodega AS codigo, MAX(desc_bodega) AS nombre,
             SUM(venta) AS ventas, COUNT(*)::bigint AS tickets,
             COUNT(DISTINCT caja)::integer AS cajas,
             AVG(duracion_segundos) FILTER (WHERE lineas > 1) AS duracion
      FROM base GROUP BY bodega
    ), cajas AS (
      SELECT bodega AS codigo_tienda, MAX(desc_bodega) AS tienda, caja,
             SUM(venta) AS ventas, COUNT(*)::bigint AS tickets,
             AVG(duracion_segundos) FILTER (WHERE lineas > 1) AS duracion,
             SUM(productos)::bigint AS productos
      FROM base GROUP BY bodega, caja
    )
    SELECT JSON_BUILD_OBJECT(
             'ventas', COALESCE(SUM(venta), 0),
             'tickets', COUNT(*)::bigint,
             'cajas', COUNT(DISTINCT (bodega, caja))::integer,
             'duracionPromedio', COALESCE(AVG(duracion_segundos) FILTER (WHERE lineas > 1), 0),
             'productosPromedio', COALESCE(AVG(productos), 0)
           ) AS total,
           COALESCE((SELECT JSON_AGG(fila ORDER BY hora) FROM (
             SELECT hora, ventas, tickets, cajas,
                    COALESCE(duracion, 0) AS "duracionPromedio", productos
             FROM horas
           ) fila), '[]'::json) AS horas,
           COALESCE((SELECT JSON_AGG(fila ORDER BY ventas DESC) FROM (
             SELECT * FROM dias ORDER BY ventas DESC LIMIT 15
           ) fila), '[]'::json) AS dias,
           COALESCE((SELECT JSON_AGG(fila ORDER BY ventas DESC) FROM tiendas fila), '[]'::json) AS tiendas,
           COALESCE((SELECT JSON_AGG(fila ORDER BY ventas DESC) FROM cajas fila), '[]'::json) AS cajas
    FROM base`, [desde, hasta, tienda]);
  return result.rows[0];
}
