-- 092 - Aplicada a Valhalla el 2026-10-19 (no existe en Flowi.estudio).
-- btree_gist se habia instalado en public al aplicar la 067/068 y trajo ~100 funciones de soporte de
-- indices ejecutables por anon. Se muda al esquema extensions, que es el que usa Supabase. Las
-- restricciones de exclusion ya creadas siguen andando (referencian la clase de operadores por oid).
-- En una base nueva esto ya no hace falta: la 067/068 crean la extension directamente ahi.
do $$ begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist' and n.nspname <> 'extensions') then
    alter extension btree_gist set schema extensions;
  end if;
end $$;
