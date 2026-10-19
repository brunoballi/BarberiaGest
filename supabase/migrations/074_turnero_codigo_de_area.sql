-- ============================================================
-- 074 — PORT de Flowi.estudio 066_whatsapp_default_area_code.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: sin los UPDATE de datos de Flowi; chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 066 — Completado automático del WhatsApp: +54, el 9 de celular,
-- y un código de área por defecto configurable por sucursal.
--
-- Antes, /admin/marca guardaba el WhatsApp tal como se tipeaba, sin
-- agregar el país ni el 9 de celular que wa.me exige. El admin lo cargó
-- como "3417505219" y el link quedaba roto.
--
-- Ahora el admin puede escribir:
--   - el número local completo (área + número, 10 dígitos): "3417505219"
--   - o solo el número, sin área (6 a 8 dígitos): "7505219" -- y el
--     sistema completa el área con el default_area_code de la sucursal.
-- En los dos casos el RPC arma "54 9 <área><número>", el único formato
-- que wa.me acepta.
--
-- El código de área NO va hardcodeado en el código: es un dato de CADA
-- sucursal (default_area_code), porque este sistema se vende a
-- barberías de otras ciudades y cada una tiene el suyo.
-- ============================================================

alter table branches
  add column if not exists default_area_code text;

comment on column branches.default_area_code is
  'Codigo de area por defecto de la sucursal (2 a 4 digitos, sin 0), usado para completar el WhatsApp cuando se carga solo el numero local sin area. Ej: 341 para Rosario, 11 para AMBA.';

-- (Se omitieron dos UPDATE de datos propios de Flowi.estudio: el arreglo del formato viejo
-- de whatsapp_phone y la semilla de default_area_code = '341' para 'Sucursal Central'.
-- En Valhalla la columna whatsapp_phone es nueva y cada sucursal carga su codigo de area
-- desde /admin/marca.)

-- ------------------------------------------------------------
-- RPC de escritura, con la normalización nueva
-- ------------------------------------------------------------
drop function if exists public.update_branch_branding(uuid, text, text, text, text, text, text);

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
  if (select role from profiles where profiles.id = auth.uid()) is distinct from 'admin'
     or not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin permisos para configurar esta sucursal';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'El nombre de la barbería no puede quedar vacío';
  end if;

  v_area := nullif(regexp_replace(coalesce(p_default_area_code, ''), '[^0-9]', '', 'g'), '');
  if v_area is not null and length(v_area) not between 2 and 4 then
    raise exception 'El código de área tiene que tener entre 2 y 4 dígitos: %', v_area;
  end if;

  -- ── Normalización del WhatsApp ──────────────────────────────
  -- Acepta lo que el admin tipee: con o sin +54, con o sin el 0 nacional,
  -- con o sin el 15 pegado al área, y con o sin el área en sí (si falta,
  -- se completa con v_area). El orden de los pasos importa: el 0 nacional
  -- y el "15" pegado son formas de escribir el número SIN país, así que
  -- se resuelven antes de decidir si falta el área; el 9 de celular se
  -- saca al final porque solo aparece cuando el número ya viene completo
  -- (país + 9 + área + número = 11 dígitos tras sacar el 54).
  if p_whatsapp_phone is not null and btrim(p_whatsapp_phone) <> '' then
    v_digits := regexp_replace(p_whatsapp_phone, '[^0-9]', '', 'g');

    if v_digits like '0054%' then v_digits := substr(v_digits, 5); end if;
    if v_digits like '54%'   then v_digits := substr(v_digits, 3); end if;
    if v_digits like '0%'    then v_digits := regexp_replace(v_digits, '^0+', ''); end if;

    -- "15" pegado al área: 341 15 7505219 -> 3417505219
    v_glued := regexp_match(v_digits, '^(\d{2,4})15(\d{6,8})$');
    if v_glued is not null then v_digits := v_glued[1] || v_glued[2]; end if;

    if length(v_digits) = 11 and v_digits like '9%' then v_digits := substr(v_digits, 2); end if;

    if length(v_digits) between 6 and 8 then
      -- Solo vino el número local: falta el código de área.
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

grant execute on function public.update_branch_branding(uuid, text, text, text, text, text, text, text) to authenticated;
