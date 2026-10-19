-- ============================================================
-- 072 — PORT de Flowi.estudio 062_branding_sucursal.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: bucket con tope de tamano y tipos; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- Marca de la sucursal en la reserva pública
-- ============================================================
-- Hasta ahora /reservar mostraba solo `name` y `address` de la sucursal: la
-- barbería no tenía forma de aparecer con su propia identidad ante SUS
-- clientes. Se agregan tres campos editables desde el panel, más el logo:
--
--   logo_url            imagen de la barbería (bucket branch-logos, ver abajo)
--   welcome_title       el "bienvenido" -- el encabezado de la portada
--   welcome_description texto que se muestra una vez elegida la sucursal
--
-- Los tres son opcionales y anulables a propósito: si están vacíos, la
-- pantalla cae al comportamiento de siempre (nombre + dirección) sin que
-- nadie tenga que configurar nada. Una instalación nueva sigue andando.
-- ============================================================

alter table branches
  add column if not exists logo_url            text,
  add column if not exists welcome_title       text,
  add column if not exists welcome_description text;

-- ------------------------------------------------------------
-- Bucket de logos
-- ------------------------------------------------------------
-- Público de lectura a propósito: el logo se muestra en /reservar, que es una
-- pantalla SIN login. La escritura queda restringida a admins autenticados.
--
-- Va todo dentro de un guard: el esquema `storage` lo crea Supabase al
-- aprovisionar el proyecto y NO existe en un Postgres pelado. Sin esto, la
-- migración rompería al correr supabase/migrations/*.sql de punta a punta en
-- una base limpia (el método de verificación de este proyecto, ver
-- ESTADO_SESION.md sección 3).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Tope de 2 MB y solo imagenes (LOGO_MAX_BYTES): viene de la seccion 5 de la 106 de Flowi.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branch-logos', 'branch-logos', true, 2 * 1024 * 1024,
            array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
    on conflict (id) do update set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    -- Lectura pública: cualquiera puede ver el logo (lo necesita /reservar).
    drop policy if exists "branch_logos_public_read" on storage.objects;
    create policy "branch_logos_public_read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'branch-logos');

    -- Escritura solo para admins. No se acota por sucursal a propósito: el
    -- nombre del archivo lo elige el panel y un admin de este sistema ya
    -- administra la instalación entera (1 cliente = 1 deploy).
    drop policy if exists "branch_logos_admin_write" on storage.objects;
    create policy "branch_logos_admin_write" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "branch_logos_admin_update" on storage.objects;
    create policy "branch_logos_admin_update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

    drop policy if exists "branch_logos_admin_delete" on storage.objects;
    create policy "branch_logos_admin_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'branch-logos'
        and (select role from profiles where profiles.id = auth.uid()) = 'admin'
      );

  end if;
end $$;

-- ------------------------------------------------------------
-- RPC de lectura pública: ahora devuelven también la marca
-- ------------------------------------------------------------
-- Siguen sin exponer NADA interno de la sucursal: solo lo que se dibuja en
-- la portada. Mismo criterio que 059.
--
-- El drop es obligatorio, no cosmético: `create or replace` NO puede cambiar
-- el tipo de retorno de una función que ya existe, y estas dos pasan de
-- devolver 3 columnas a devolver 6. Sin el drop, la migración falla con
-- "cannot change return type of existing function" (mismo gotcha que ya
-- había aparecido con report_by_period, ver ESTADO_SESION.md sección 3).
drop function if exists public.get_public_branch(uuid);
drop function if exists public.list_public_branches();

create or replace function public.get_public_branch(p_branch_id uuid default null)
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description
    from branches b
   where b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by b.name
   limit 1;
$function$;

create or replace function public.list_public_branches()
returns table (
  id                  uuid,
  name                text,
  address             text,
  logo_url            text,
  welcome_title       text,
  welcome_description text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.name, b.address, b.logo_url, b.welcome_title, b.welcome_description
    from branches b
   where b.is_active
   order by b.name;
$function$;

-- ------------------------------------------------------------
-- RPC de escritura: solo el admin de la sucursal
-- ------------------------------------------------------------
-- Mismo patrón de permisos que el resto del panel (ver 056_appointments.sql):
-- admin de la sucursal, o dueño de su propia sucursal.
create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  -- Los textos vacíos se guardan como null, no como '': así la pantalla
  -- pública tiene una sola condición que evaluar para caer al default.
  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), '')
   where id = p_branch_id;
end;
$function$;

grant execute on function public.get_public_branch(uuid)     to anon, authenticated;
grant execute on function public.list_public_branches()      to anon, authenticated;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text) to authenticated;
