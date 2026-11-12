# Réplica de producción en Docker

Una copia exacta de la base de producción (datos, funciones, políticas, triggers y permisos)
dentro del Postgres local de `supabase start`, para probar mejoras, cambios de base y soporte
sin tocar producción.

## Bases que quedan en Docker (puerto 54322, postgres/postgres)

| Base | Para qué |
|---|---|
| `valhalla_replica` | La réplica limpia. **No se prueba directamente sobre ella.** |
| `valhalla_prueba` | Copia descartable de la réplica para probar migraciones y cargas. |
| `postgres` | La base estándar de Supabase local (sin datos de producción). |

Probar siempre sobre una copia:

```sql
select pg_terminate_backend(pid) from pg_stat_activity where datname='valhalla_replica' and pid<>pg_backend_pid();
drop database if exists valhalla_prueba;
create database valhalla_prueba template valhalla_replica;
```

Aplicar una migración a la copia:

```bash
docker exec -i supabase_db_ValhallaGest psql -U postgres -d valhalla_prueba -v ON_ERROR_STOP=1 < supabase/migrations/108_turnero_blindaje_de_concurrencia.sql
```

Prueba de carga del turnero (borra los turnos de la base en la que corre: usar solo la copia):

```bash
PGDATABASE=valhalla_prueba node scripts/pruebas-concurrencia/stress.js
```

## Rehacerla (cuando producción cambie)

Necesita la cadena de conexión del **Session pooler** (Supabase → Project Settings → Database).
La conexión directa de Supabase es solo IPv6 y no funciona desde Docker en Windows.
El script solo **lee** producción.

```bash
PROD_URL="postgresql://postgres.PROYECTO:CLAVE@aws-1-us-east-2.pooler.supabase.com:5432/postgres" \
bash scripts/replica-produccion/rehacer-replica.sh
```

## Cuidados

- Contiene **datos reales de clientes**. Los volcados se guardan fuera del repo y de OneDrive
  (por defecto en `~/valhalla-replica`). No subirlos a ningún lado.
- No guardar la clave de la base en archivos. Si se pega en un chat, resetearla después
  (Supabase → Project Settings → Database → Reset database password).
- La réplica es una foto: no se actualiza sola.
- No incluye Storage con archivos (solo la estructura) ni los secretos de la app.
