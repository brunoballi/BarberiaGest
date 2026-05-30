# Load testing

Script de carga real contra la API de Supabase (PostgREST + GoTrue): hace login,
dispara GETs concurrentes a los endpoints clave y reporta throughput y latencias
p50/p95/p99 + errores. Solo Node ≥18, sin dependencias.

> ⚠️ **Correr SOLO contra un entorno aislado, nunca contra producción.**
> Producción sirve la barbería en vivo; un load test puede degradar el servicio,
> consumir cuota y (si hubiera writes) contaminar datos reales.

## Pasos

1. **Entorno aislado.** Crear una Supabase branch (Dashboard → Branches, o MCP
   `create_branch`). La branch replica las migraciones (incluidas 005/006), así
   que prueba el esquema ya optimizado. Anotar su **Project URL** y **anon key**.

2. **Usuario de prueba** en la branch. Vía SQL/RPC `create_admin_auth_user(...)`
   o creando un usuario en Auth y su fila en `profiles`. Anotar email + password.

3. **Correr** (PowerShell):
   ```powershell
   $env:SUPABASE_URL   = "https://<branch-ref>.supabase.co"
   $env:SUPABASE_ANON_KEY = "<anon key del branch>"
   $env:TEST_EMAIL    = "loadtest@valhalla.test"
   $env:TEST_PASSWORD = "<password>"
   $env:VUS = "25"          # usuarios virtuales concurrentes
   $env:DURATION_S = "30"   # duración en segundos
   node loadtest/run.mjs
   ```
   Subir `VUS` (50, 100, 200…) para encontrar el punto de saturación.

4. **Borrar la branch** al terminar para no acumular costo.

## Qué mirar
- **Throughput (req/s)** y **errores %**: si los errores suben al aumentar VUs,
  llegaste al límite de conexiones/CPU del plan.
- **p95/p99**: latencia bajo carga. Con los índices (005) y RLS initplan (006)
  debería mantenerse estable a más VUs que antes.
