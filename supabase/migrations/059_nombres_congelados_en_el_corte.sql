-- ============================================================
-- 059: CONGELAR EN EL CORTE EL NOMBRE DEL SERVICIO, DEL BENEFICIO Y DEL SOCIO
-- ============================================================
-- Primera mitad del cambio que permite BORRAR de verdad servicios, beneficios y
-- socios vitalicios. Esta migracion es puramente aditiva: agrega columnas,
-- backfillea y extiende el trigger. No dropea ni modifica nada existente. La
-- segunda mitad (FK a ON DELETE SET NULL y unicidad parcial) va en la 060.
--
-- POR QUE
-- La 058 dejo "eliminar" con un techo: como transactions.service_id y
-- transactions.benefit_id son NO ACTION, cualquier servicio con un solo corte
-- terminaba archivado. En la practica los 19 servicios tienen cortes, asi que
-- ninguno se podia borrar nunca.
--
-- Se verifico que lo unico que ata el corte al servicio es el NOMBRE:
--   * ningun calculo usa transactions.service_id — el tramo del barbero nuevo
--     usa profiles.classic_service_id, que es otra columna;
--   * benefit_id quedo como fallback desde que la 056 congelo el flag VIP en
--     benefit_full_amount_snap;
--   * el resto es display: la lista de cortes joinea para mostrar el nombre.
--
-- Entonces se aplica el patron de las 049-057: congelar el dato en el corte.
-- Con el nombre guardado, el vinculo deja de ser necesario y la 060 puede
-- soltar las FK sin que el historial pierda nada de lo que el cliente ve.
--
-- EL TRIGGER
-- set_transaction_snapshots reemplaza y absorbe a set_benefit_full_amount_snap
-- (056). Se usa CREATE OR REPLACE TRIGGER sobre el nombre existente para no
-- dropear nada; el trigger conserva su nombre historico
-- (trg_transactions_benefit_vip_snap) y la 060 se encarga de la limpieza.
--
-- Ojo con service_name_snap: cuando service_id viene en null el nombre NO se
-- borra si la fila ya existia. Despues de la 060, un servicio eliminado deja
-- service_id en null y el nombre es lo unico que queda del historial.
-- ============================================================

alter table public.transactions
  add column if not exists service_name_snap         text,
  add column if not exists benefit_name_snap         text,
  add column if not exists lifetime_member_name_snap text;

comment on column public.transactions.service_name_snap is
  'Nombre del servicio tal como estaba al registrar el corte. Permite borrar el servicio del catalogo sin perder que decia el historial.';
comment on column public.transactions.benefit_name_snap is 'Ver service_name_snap.';
comment on column public.transactions.lifetime_member_name_snap is 'Ver service_name_snap.';

update public.transactions t
set service_name_snap = sc.name
from public.service_catalog sc
where sc.id = t.service_id and t.service_name_snap is null;

update public.transactions t
set benefit_name_snap = b.name
from public.benefits b
where b.id = t.benefit_id and t.benefit_name_snap is null;

update public.transactions t
set lifetime_member_name_snap = lm.full_name
from public.lifetime_members lm
where lm.id = t.lifetime_member_id and t.lifetime_member_name_snap is null;

create or replace function public.set_transaction_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Flag VIP + nombre del beneficio (el flag viene de la 056)
  if NEW.benefit_id is null then
    NEW.benefit_full_amount_snap := null;
    if TG_OP = 'INSERT' then NEW.benefit_name_snap := null; end if;
  elsif TG_OP = 'INSERT'
     or NEW.benefit_id is distinct from OLD.benefit_id
     or NEW.benefit_full_amount_snap is null then
    select coalesce(b.full_amount_to_barber, false), b.name
      into NEW.benefit_full_amount_snap, NEW.benefit_name_snap
    from benefits b where b.id = NEW.benefit_id;
  end if;

  if NEW.service_id is null then
    if TG_OP = 'INSERT' then NEW.service_name_snap := null; end if;
  elsif TG_OP = 'INSERT'
     or NEW.service_id is distinct from OLD.service_id
     or NEW.service_name_snap is null then
    select sc.name into NEW.service_name_snap
    from service_catalog sc where sc.id = NEW.service_id;
  end if;

  if NEW.lifetime_member_id is null then
    if TG_OP = 'INSERT' then NEW.lifetime_member_name_snap := null; end if;
  elsif TG_OP = 'INSERT'
     or NEW.lifetime_member_id is distinct from OLD.lifetime_member_id
     or NEW.lifetime_member_name_snap is null then
    select lm.full_name into NEW.lifetime_member_name_snap
    from lifetime_members lm where lm.id = NEW.lifetime_member_id;
  end if;

  return NEW;
end;
$fn$;

create or replace trigger trg_transactions_benefit_vip_snap
  before insert or update on public.transactions
  for each row execute function public.set_transaction_snapshots();
