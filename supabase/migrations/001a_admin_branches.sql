-- ============================================================
-- VALHALLA BARBERSHOP — admin_branches (recupera schema drift)
-- Esta tabla existía en el proyecto original pero NO estaba en
-- ninguna migración (se creó a mano). Se recrea aquí, idempotente,
-- para que 005_fk_indexes y 006_rls_initplan puedan referenciarla.
-- Asignación admin ↔ sucursal (muchos a muchos).
-- ============================================================

create table if not exists admin_branches (
  admin_id   uuid        not null references profiles(id) on delete cascade,
  branch_id  uuid        not null references branches(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid        references profiles(id) on delete no action,
  primary key (admin_id, branch_id)
);

alter table admin_branches enable row level security;
