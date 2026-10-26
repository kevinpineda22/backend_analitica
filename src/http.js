export function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function numero(value) {
  return Number(value || 0);
}

export function esTimeout(error) {
  return error?.code === "ETIMEDOUT"
    || error?.code === "57014"
    || /timeout|statement timeout/i.test(error?.message || "");
}

/** Lee `desde`/`hasta`. Si no sirven, responde 400 y devuelve null. */
export function validarPeriodo(request, response) {
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

export function respuestaError(response, error, mensaje) {
  console.error(mensaje, error.message);
  response.status(esTimeout(error) ? 503 : 500).json({
    ok: false,
    error: esTimeout(error)
      ? "PostgreSQL tardo demasiado en responder. Intenta un periodo mas corto."
      : mensaje,
  });
}
