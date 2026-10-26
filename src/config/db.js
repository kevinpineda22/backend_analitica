import process from "node:process";
import pg from "pg";

const { Pool } = pg;

export const postgresConfigurado = [
  "POSTGRES_HOST",
  "POSTGRES_DATABASE",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
].every((variable) => Boolean(process.env[variable]));

/* Corre en Vercel: cada instancia de la función tiene su propio pool, y el
   Postgres está detrás de un pooler que no es nuestro. Por eso `max: 1`. */
export const pool = new Pool({
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
