-- ============================================================
-- PERFORMANCE — Índices para foreign keys sin cobertura
-- Detectados por el linter de Supabase (unindexed_foreign_keys).
-- Mejoran JOINs y filtros por estas columnas. Tablas chicas → creación
-- instantánea. Idempotente. También elimina un índice duplicado en advances.
-- ============================================================

create index if not exists idx_admin_branches_branch     on admin_branches(branch_id);
create index if not exists idx_admin_branches_granted_by  on admin_branches(granted_by);

create index if not exists idx_advances_deducted_in       on advances(deducted_in);
create index if not exists idx_advances_registered_by     on advances(registered_by);
create index if not exists idx_advances_week              on advances(week_id);

create index if not exists idx_audit_log_changed_by       on audit_log(changed_by);

create index if not exists idx_expenses_paid_by           on expenses(paid_by);
create index if not exists idx_expenses_registered_by     on expenses(registered_by);

create index if not exists idx_settlements_branch         on settlements(branch_id);

create index if not exists idx_transactions_created_by    on transactions(created_by);
create index if not exists idx_transactions_service       on transactions(service_id);

create index if not exists idx_weeks_closed_by            on weeks(closed_by);
create index if not exists idx_weeks_month                on weeks(month_id);

-- Índice duplicado en advances (idx_advances_barber == idx_advances_barber_status)
drop index if exists idx_advances_barber_status;
