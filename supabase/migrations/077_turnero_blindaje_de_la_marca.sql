-- ============================================================
-- 077 — PORT de Flowi.estudio 069_revocar_anon_update_branding.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 069 — 🔴 SEGURIDAD: update_branch_branding era ejecutable por `anon`
-- ============================================================
--
-- Encontrado el 2026-08-26 mientras se armaba 068 (recordatorios de
-- WhatsApp): al revisar el ACL real de update_branch_branding en
-- producción, tenía `anon=X` -- cualquiera SIN sesión podía llamarla.
--
-- Causa raíz: el `alter default privileges in schema public revoke
-- execute on functions from public` con el que termina
-- 063_fix_grant_public_rpc.sql NO SIRVE en este proyecto de Supabase.
-- Se verificó en vivo, contra la base real: después de correr ese
-- default y crear una función de prueba nueva, `anon` la pudo ejecutar
-- igual. Supabase aplica su PROPIO default (grant a
-- anon/authenticated/service_role) a toda función nueva del esquema
-- public, y el intento de 063 no lo pisa -- ni apuntando a PUBLIC ni a
-- los roles por nombre. La ÚNICA forma que se comprobó efectiva es el
-- `revoke` EXPLÍCITO sobre la función puntual, después de crearla (el
-- mismo mecanismo que 063 ya usaba para reset_admin_password y
-- create_admin_auth_user en su sección 4 -- ahí sí funcionaba, porque
-- era explícito por función, no un default).
--
-- update_branch_branding es una función nueva (062, con firma
-- reemplazada en 065 y 066), creada DESPUÉS de 063 -- exactamente el
-- caso que el default (ineficaz) de 063 debía cubrir y no cubrió.
--
-- Impacto real: cualquiera en internet, sin login, podía reescribir el
-- nombre, dirección, logo, mensaje de bienvenida y WhatsApp de la
-- sucursal que se muestra en /reservar.
--
-- Se revoca el acceso Y se blinda la lógica interna (que tenía su
-- propio problema: con auth.uid() = null, la condición del chequeo
-- daba NULL en vez de TRUE/FALSE, y en PL/pgSQL un `IF NULL THEN` NO
-- dispara -- la función seguía de largo. Con coalesce(..., true) un
-- NULL ahora se trata como "sin permiso", no como "permitido"). Las dos
-- capas quedan: aunque alguna vuelva a fallar, la otra sigue cerrando.
-- ============================================================

revoke execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  from anon, public;

create or replace function public.update_branch_branding(
  p_branch_id           uuid,
  p_name                text,
  p_address             text default null,
  p_logo_url            text default null,
  p_welcome_title       text default null,
  p_welcome_description text default null,
  p_whatsapp_phone      text default null,
  p_default_area_code   text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_area   text;
  v_digits text;
  v_phone  text;
  v_glued  text[];
begin
  -- coalesce(..., true): si CUALQUIER parte de la condición da NULL
  -- (auth.uid() sin perfil, por ejemplo), se trata como "hay que
  -- bloquear" y no como "no hay que bloquear". Antes, un llamador sin
  -- sesión hacía que toda la expresión diera NULL, y un `IF NULL` en
  -- PL/pgSQL no dispara el `raise exception` -- la función seguía.
  if coalesce(
       (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
       or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false),
       true
     )
  then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      if v_area is null then
        raise exception 'Falta el código de área. Escribilo junto al número (ej: 3417505219), o cargá primero el código de área por defecto de la sucursal.';
      end if;
      v_digits := v_area || v_digits;
    end if;

    if length(v_digits) <> 10 then
      raise exception 'Número de WhatsApp inválido (quedaron % dígitos entre área y número, se esperan 10): %', length(v_digits), p_whatsapp_phone;
    end if;

    v_phone := '549' || v_digits;
  end if;

  update branches
     set name                = btrim(p_name),
         address             = nullif(btrim(coalesce(p_address, '')), ''),
         logo_url            = nullif(btrim(coalesce(p_logo_url, '')), ''),
         welcome_title       = nullif(btrim(coalesce(p_welcome_title, '')), ''),
         welcome_description = nullif(btrim(coalesce(p_welcome_description, '')), ''),
         whatsapp_phone      = v_phone,
         default_area_code   = v_area
   where id = p_branch_id;
end;
$function$;

-- CREATE OR REPLACE preserva los grants existentes, pero se re-afirma
-- el revoke igual: si algo llegó a re-otorgarle a anon entre medio (por
-- ejemplo, un `create or replace` sin este statement en el futuro),
-- esta migración por sí sola vuelve a dejarlo cerrado.
revoke execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  from anon, public;
grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text)
  to authenticated;
