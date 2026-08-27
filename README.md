# Backend de analitica

API Express para consultar indicadores comerciales desde PostgreSQL. Se ejecuta localmente con Node.js y en produccion como una funcion serverless de Vercel.

## Rutas

- `GET /api/salud`
- `GET /api/analitica/filtros`
- `GET /api/analitica/bodegas`
- `GET /api/analitica/resumen`
- `GET /api/analitica/modelo`

Las rutas de analitica requieren `Authorization: Bearer <token>` de una sesion valida de Supabase.

## Desarrollo local

1. Instala Node.js 20 o superior.
2. Ejecuta `npm install`.
3. Conserva las credenciales locales en `.env` usando `.env.example` como referencia.
4. Agrega `http://localhost:5173` a `POWER_BI_ALLOWED_ORIGINS`.
5. Ejecuta `npm run dev`.

La API quedara disponible en `http://127.0.0.1:3010/api`.

## Despliegue en Vercel

1. Conecta el repositorio `kevinpineda22/backend_analitica` en **Settings > Git**.
2. Configura `master` como **Production Branch** y `/` como **Root Directory**.
3. Usa la deteccion automatica de Express. No configures Build Command, Output Directory ni un archivo `vercel.json`.
4. Registra en **Settings > Environment Variables** todas las variables de `.env.example` excepto `POWER_BI_API_PORT` y `POWER_BI_API_HOST`.
5. En `POWER_BI_ALLOWED_ORIGINS` registra la URL publica del frontend, sin `/` final. Se aceptan varias URLs separadas por comas.
6. Haz push a `master` o ejecuta **Redeploy** sobre el ultimo commit.
7. Comprueba primero `https://TU-BACKEND.vercel.app/`. Debe responder `{ "ok": true, "servicio": "API de analitica" }`.
8. Comprueba `https://TU-BACKEND.vercel.app/api/salud` para verificar PostgreSQL.
9. En el frontend configura `VITE_POWER_BI_API_URL=https://TU-BACKEND.vercel.app/api` y vuelve a desplegarlo.

No subas `.env` al repositorio. Si PostgreSQL solo admite ciertas IP, debe aceptar conexiones desde Vercel o utilizar un pooler accesible publicamente. Para produccion se recomienda `POSTGRES_SSLMODE=require` cuando el proveedor lo soporte.