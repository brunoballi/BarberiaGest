#!/usr/bin/env bash
# Rehace en Docker una réplica exacta de producción (datos, funciones, políticas, permisos).
# SOLO LEE producción. Uso (la cadena es la del "Session pooler" de Supabase, con la clave):
#   PROD_URL="postgresql://postgres.PROYECTO:CLAVE@aws-1-us-east-2.pooler.supabase.com:5432/postgres" \
#   bash scripts/replica-produccion/rehacer-replica.sh
# Requiere: `supabase start` corriendo (contenedor supabase_db_ValhallaGest).
set -euo pipefail
export MSYS_NO_PATHCONV=1
C=supabase_db_ValhallaGest
: "${PROD_URL:?Falta PROD_URL}"
SALIDA="${SALIDA:-$HOME/valhalla-replica}"   # fuera de OneDrive y de git: tiene datos reales de clientes
mkdir -p "$SALIDA"

echo "1/5 Volcando producción (datos + estructura)..."
docker exec $C pg_dump "$PROD_URL" --no-owner --no-privileges -n public -n auth -n storage -f /tmp/valhalla_prod.sql
echo "2/5 Volcando permisos..."
docker exec $C pg_dump "$PROD_URL" --schema-only --no-owner -n public -n auth -n storage -f /tmp/schema_con_permisos.sql
docker cp $C:/tmp/valhalla_prod.sql "$SALIDA/valhalla_prod.sql"
docker cp $C:/tmp/schema_con_permisos.sql "$SALIDA/schema_con_permisos.sql"
docker exec $C sh -c "grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)' /tmp/schema_con_permisos.sql > /tmp/permisos.sql"

echo "3/5 Creando base valhalla_replica..."
docker exec $C psql -U postgres -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='valhalla_replica' and pid<>pg_backend_pid()" >/dev/null
docker exec $C psql -U postgres -q -c "drop database if exists valhalla_replica" -c "create database valhalla_replica"
docker exec $C psql -U postgres -d valhalla_replica -q \
  -c "create schema if not exists extensions" \
  -c 'create extension if not exists "uuid-ossp" with schema extensions' \
  -c "create extension if not exists pgcrypto with schema extensions" \
  -c "create extension if not exists btree_gist with schema extensions" \
  -c "create extension if not exists pg_stat_statements with schema extensions"
echo "4/5 Cargando (el aviso 'schema public already exists' es normal)..."
docker exec $C psql -U postgres -d valhalla_replica -q -f /tmp/valhalla_prod.sql > "$SALIDA/carga.log" 2>&1 || true
docker exec $C psql -U postgres -d valhalla_replica -q -f /tmp/permisos.sql >> "$SALIDA/carga.log" 2>&1 || true

echo "5/5 Resumen de la réplica:"
docker exec $C psql -U postgres -d valhalla_replica -At -c "select 'tablas', count(*) from pg_tables where schemaname='public' union all select 'funciones', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' union all select 'usuarios', count(*) from auth.users union all select 'turnos', count(*) from appointments"
echo "Listo. Para probar sin ensuciarla: create database valhalla_prueba template valhalla_replica;"
