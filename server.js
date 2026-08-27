import process from "node:process";
import app from "./app.js";

const port = Number(process.env.PORT || process.env.POWER_BI_API_PORT || 3010);
const host = process.env.POWER_BI_API_HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`API de analitica disponible en http://${host}:${port}/api`);
});