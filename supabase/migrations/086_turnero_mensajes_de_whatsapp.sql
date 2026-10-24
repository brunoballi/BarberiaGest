-- ============================================================
-- 086 — PORT de Flowi.estudio 110_whatsapp_mensajes_y_estados.sql
-- Porte a BarberiaGest/Valhalla del 2026-10-15. NO SE APLICA SIN REVISION DE BRUNO.
-- Ver PORTING.md (turnero). Cambios respecto del original: chequeos NULL-safe
-- (is distinct from 'admin' / not coalesce(..., false)).
-- ============================================================

-- ============================================================
-- 110 — Registro de mensajes de WhatsApp y de su estado de entrega
-- ============================================================
-- Hasta acá la app mandaba la plantilla a Meta, recibía `sent: true` y no
-- volvía a saber nada: Meta ACEPTA el pedido de forma síncrona pero entrega
-- (o no) más tarde, y los motivos de rechazo reales -- método de pago
-- faltante (131042), número sin WhatsApp (131026), plantilla pausada, etc. --
-- llegan solo por el webhook de estados. Sin esto, un mensaje que nunca
-- llega es invisible para la barbería.
--
-- Cómo:
--   · Al enviar, el servidor registra el `wamid` (id del mensaje que
--     devuelve Meta) junto con el turno y el tipo de aviso.
--   · /api/whatsapp/webhook recibe los estados (sent / delivered / read /
--     failed) y los vuelca acá. Los estados pueden llegar desordenados o
--     ANTES de que el servidor termine de registrar el envío, por eso las
--     dos funciones hacen upsert y el estado solo avanza, nunca retrocede.
--   · Solo escribe el service role. El admin lee los de su sucursal.
-- ============================================================

create table if not exists public.whatsapp_messages (
  wamid          text        primary key,
  -- Nulos hasta que el servidor registra el envío (si el estado llegó antes).
  branch_id      uuid        references public.branches(id) on delete cascade,
  appointment_id uuid        references public.appointments(id) on delete set null,
  kind           text        check (kind in ('confirmacion', 'recordatorio', 'cancelacion', 'difusion')),
  recipient      text,
  status         text        not null default 'accepted'
                             check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code     integer,
  error_title    text,
  error_detail   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_branch_created
  on public.whatsapp_messages (branch_id, created_at desc);
create index if not exists idx_whatsapp_messages_appointment
  on public.whatsapp_messages (appointment_id);

alter table public.whatsapp_messages enable row level security;

-- Lectura solo para el admin de la sucursal (el teléfono del cliente está
-- acá). Ninguna política de escritura: escribe el service role.
drop policy if exists whatsapp_messages_admin_read on public.whatsapp_messages;
create policy whatsapp_messages_admin_read on public.whatsapp_messages
  for select to authenticated
  using (branch_id is not null and public._admin_can_manage_branch(branch_id));

revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;

-- ------------------------------------------------------------
-- Orden de los estados. `failed` le gana a accepted/sent pero no a
-- delivered/read: si Meta ya entregó, un "failed" tardío no corresponde.
-- ------------------------------------------------------------
create or replace function public._wa_status_rank(p_status text)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'accepted'  then 0
    when 'sent'      then 1
    when 'failed'    then 2
    when 'delivered' then 3
    when 'read'      then 4
    else -1
  end;
$$;

-- ------------------------------------------------------------
-- Alta del envío (la llama el servidor justo después de mandar).
-- No toca status/error_*: si el webhook llegó primero, se conserva.
-- ------------------------------------------------------------
create or replace function public.register_whatsapp_message(
  p_wamid          text,
  p_branch_id      uuid,
  p_appointment_id uuid,
  p_kind           text,
  p_recipient      text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_wamid, '') = '' then
    return;
  end if;

  insert into whatsapp_messages (wamid, branch_id, appointment_id, kind, recipient)
  values (p_wamid, p_branch_id, p_appointment_id, p_kind, p_recipient)
  on conflict (wamid) do update
    set branch_id      = excluded.branch_id,
        appointment_id = excluded.appointment_id,
        kind           = excluded.kind,
        recipient      = coalesce(excluded.recipient, whatsapp_messages.recipient);
end;
$$;

-- ------------------------------------------------------------
-- Estado que informa el webhook. Upsert monótono: el estado solo avanza.
-- ------------------------------------------------------------
create or replace function public.record_whatsapp_status(
  p_wamid        text,
  p_status       text,
  p_recipient    text,
  p_error_code   integer,
  p_error_title  text,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_wamid, '') = '' or public._wa_status_rank(p_status) < 0 then
    return;
  end if;

  insert into whatsapp_messages (wamid, status, recipient, error_code, error_title, error_detail)
  values (
    p_wamid, p_status, p_recipient,
    case when p_status = 'failed' then p_error_code end,
    case when p_status = 'failed' then left(p_error_title, 200) end,
    case when p_status = 'failed' then left(p_error_detail, 500) end
  )
  on conflict (wamid) do update
    set status = case
          when public._wa_status_rank(excluded.status) > public._wa_status_rank(whatsapp_messages.status)
            then excluded.status
          else whatsapp_messages.status
        end,
        error_code = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_code
          else whatsapp_messages.error_code
        end,
        error_title = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_title
          else whatsapp_messages.error_title
        end,
        error_detail = case
          when excluded.status = 'failed'
           and public._wa_status_rank(whatsapp_messages.status) < 3
            then excluded.error_detail
          else whatsapp_messages.error_detail
        end,
        recipient  = coalesce(whatsapp_messages.recipient, excluded.recipient),
        updated_at = now();
end;
$$;

-- Explícito función por función: el `alter default privileges` de la 063 no
-- protege las funciones nuevas en Supabase (ver ESTADO_SESION 5.22).
revoke execute on function public._wa_status_rank(text) from public, anon, authenticated;
grant  execute on function public._wa_status_rank(text) to service_role;

revoke execute on function public.register_whatsapp_message(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant  execute on function public.register_whatsapp_message(text, uuid, uuid, text, text)
  to service_role;

revoke execute on function public.record_whatsapp_status(text, text, text, integer, text, text)
  from public, anon, authenticated;
grant  execute on function public.record_whatsapp_status(text, text, text, integer, text, text)
  to service_role;
