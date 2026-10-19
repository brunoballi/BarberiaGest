-- ============================================================
-- 078 — PORT de Flowi.estudio 071_barber_photos.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: bucket con tope de tamano y tipos; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 071 — Foto de perfil del barbero, cargada por el admin
-- ============================================================
-- Mismo patrón que 062_branding_sucursal.sql (logo de la sucursal),
-- aplicado a barberos en vez de sucursales. La sube el ADMIN desde
-- /admin/barberos, no cada barbero desde su propio mobile -- decisión
-- explícita del usuario al pedir esta mejora.
--
-- No hace falta RPC nueva para escribir `avatar_url`: la política
-- `profiles_admin_update` (001_initial_schema.sql) ya deja que un admin
-- actualice cualquier columna de un barbero de su sucursal -- es la misma
-- que ya usa updateBarberProfile() para comisión, sueldo, etc. Agregar una
-- columna no agrega superficie de escritura nueva.
-- ============================================================

alter table profiles
  add column if not exists avatar_url text;

comment on column profiles.avatar_url is
  'Foto de perfil del barbero, cargada por el admin. URL publica del bucket barber-photos.';

-- ------------------------------------------------------------
-- Bucket de fotos
-- ------------------------------------------------------------
-- Público de lectura: la foto se muestra en pantallas propias del sistema
-- (barberos-abm, mobile del barbero), pero no hay necesidad de esconderla
-- detrás de auth -- no es un dato sensible, y mantenerlo público evita
-- tener que firmar URLs cada vez que se muestra.
--
-- Va todo dentro del guard de siempre: el esquema `storage` lo crea Supabase
-- al aprovisionar el proyecto y NO existe en un Postgres pelado. Sin esto,
-- la migración rompería el método de verificación del proyecto (correr
-- supabase/migrations/*.sql de punta a punta en una base limpia).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Tope de 3 MB y solo imagenes (BARBER_PHOTO_MAX_BYTES): viene de la seccion 5 de la 106 de Flowi.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('barber-photos', 'barber-photos', true, 3 * 1024 * 1024,
            array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "barber_photos_public_read" on storage.objects;
    create policy "barber_photos_public_read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'barber-photos');

    -- Escritura solo para admins -- mismo criterio que branch-logos: no se
    -- acota por sucursal, un admin de este sistema ya administra la
    -- instalación entera (1 cliente = 1 deploy).
    drop policy if exists "barber_photos_admin_write" on storage.objects;
    create policy "barber_photos_admin_write" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "barber_photos_admin_update" on storage.objects;
    create policy "barber_photos_admin_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "barber_photos_admin_delete" on storage.objects;
    create policy "barber_photos_admin_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'barber-photos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

  end if;
end $$;
