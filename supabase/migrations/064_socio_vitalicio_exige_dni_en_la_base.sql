-- ============================================================
-- Socio vitalicio: la base exige el socio verificado
--
-- El beneficio con requires_member_document = true (ej: "Socio Vitalicio")
-- tiene que ir acompañado de un socio de la lista (lifetime_member_id).
-- La app ya lo valida, pero la validacion vivia solo en el cliente: una
-- version vieja de la app abierta (o cualquier cliente) podia guardar el
-- corte con el descuento sin DNI. Entre septiembre y octubre se guardaron
-- 8 cortes asi ($53.100 de descuento).
--
-- Regla (trigger BEFORE INSERT OR UPDATE sobre transactions):
--   * INSERT: si el beneficio exige documento, lifetime_member_id es
--     obligatorio y tiene que ser un socio activo y no archivado.
--   * UPDATE: se valida SOLO si cambia benefit_id o lifetime_member_id.
--     Asi no se rompen recalculos ni ediciones de los cortes viejos que
--     quedaron sin socio.
-- ============================================================

create or replace function public.transactions_require_lifetime_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requires boolean;
begin
  if new.benefit_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.benefit_id is not distinct from old.benefit_id
     and new.lifetime_member_id is not distinct from old.lifetime_member_id then
    return new;
  end if;

  select b.requires_member_document into v_requires
  from benefits b
  where b.id = new.benefit_id;

  if coalesce(v_requires, false) = false then
    return new;
  end if;

  if new.lifetime_member_id is null then
    raise exception 'Este beneficio exige el DNI de un socio vitalicio. Si ves este mensaje, cerrá la app y volvé a abrirla para actualizarla.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from lifetime_members m
    where m.id = new.lifetime_member_id
      and m.is_active
      and m.archived_at is null
  ) then
    raise exception 'El socio vitalicio no está activo en la lista. Comunicate con el administrador.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_transactions_require_lifetime_member on public.transactions;
create trigger trg_transactions_require_lifetime_member
  before insert or update on public.transactions
  for each row execute function public.transactions_require_lifetime_member();
