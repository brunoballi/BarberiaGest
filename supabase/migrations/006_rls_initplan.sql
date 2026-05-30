-- ============================================================
-- PERFORMANCE — RLS initplan: envolver auth.*/current_user_* en (select ...)
-- Evalua las funciones una sola vez por query (no por fila). Logica identica.
-- Recomendacion oficial Supabase (lint 0003_auth_rls_initplan). Idempotente.
-- ============================================================

drop policy if exists "admin_branches_admin_delete" on admin_branches;
create policy "admin_branches_admin_delete" on admin_branches for delete to authenticated
  using ((select auth_role()) = 'admin'::user_role);

drop policy if exists "admin_branches_admin_insert" on admin_branches;
create policy "admin_branches_admin_insert" on admin_branches for insert to authenticated
  with check ((select auth_role()) = 'admin'::user_role);

drop policy if exists "admin_branches_admin_update" on admin_branches;
create policy "admin_branches_admin_update" on admin_branches for update to authenticated
  using ((select auth_role()) = 'admin'::user_role)
  with check ((select auth_role()) = 'admin'::user_role);

drop policy if exists "admin_branches_self_read" on admin_branches;
create policy "admin_branches_self_read" on admin_branches for select to authenticated
  using (admin_id = (select auth.uid()));

drop policy if exists "admin_all_advances" on advances;
create policy "admin_all_advances" on advances for all to authenticated
  using ((select auth_role()) = 'admin'::user_role);

drop policy if exists "advances_admin_all" on advances;
create policy "advances_admin_all" on advances for all to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())))
  with check (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "advances_barber_insert" on advances;
create policy "advances_barber_insert" on advances for insert to authenticated
  with check ((barber_id = (select auth.uid())) AND (registered_by = (select auth.uid())));

drop policy if exists "advances_barber_read" on advances;
create policy "advances_barber_read" on advances for select to authenticated
  using (barber_id = (select auth.uid()));

drop policy if exists "barber_read_own_advances" on advances;
create policy "barber_read_own_advances" on advances for select to authenticated
  using (((select auth_role()) = 'barber'::user_role) AND (barber_id = (select auth.uid())));

drop policy if exists "admin_all_months" on months;
create policy "admin_all_months" on months for all to authenticated
  using ((select auth_role()) = 'admin'::user_role)
  with check ((select auth_role()) = 'admin'::user_role);

drop policy if exists "admins_all_months" on months;
create policy "admins_all_months" on months for all to authenticated
  using (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::user_role) AND (profiles.branch_id = months.branch_id))))
  with check (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::user_role) AND (profiles.branch_id = months.branch_id))));

drop policy if exists "barbers_read_own_months" on months;
create policy "barbers_read_own_months" on months for select to authenticated
  using (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'barber'::user_role) AND (profiles.branch_id = months.branch_id))));

drop policy if exists "admin_all_profiles" on profiles;
create policy "admin_all_profiles" on profiles for all to authenticated
  using ((select auth_role()) = 'admin'::user_role);

drop policy if exists "barber_read_own_profile" on profiles;
create policy "barber_read_own_profile" on profiles for select to authenticated
  using (((select auth_role()) = 'barber'::user_role) AND (id = (select auth.uid())));

drop policy if exists "barber_update_own_profile" on profiles;
create policy "barber_update_own_profile" on profiles for update to authenticated
  using (((select auth_role()) = 'barber'::user_role) AND (id = (select auth.uid())))
  with check (id = (select auth.uid()));

drop policy if exists "profiles_admin_update" on profiles;
create policy "profiles_admin_update" on profiles for update to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())))
  with check (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "profiles_read_branch" on profiles;
create policy "profiles_read_branch" on profiles for select to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "profiles_read_own" on profiles;
create policy "profiles_read_own" on profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "admin_all_settlements" on settlements;
create policy "admin_all_settlements" on settlements for all to authenticated
  using ((select auth_role()) = 'admin'::user_role);

drop policy if exists "barber_read_own_settlements" on settlements;
create policy "barber_read_own_settlements" on settlements for select to authenticated
  using (((select auth_role()) = 'barber'::user_role) AND (barber_id = (select auth.uid())));

drop policy if exists "settlements_admin_read" on settlements;
create policy "settlements_admin_read" on settlements for select to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "settlements_admin_update" on settlements;
create policy "settlements_admin_update" on settlements for update to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())))
  with check (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "settlements_barber_read" on settlements;
create policy "settlements_barber_read" on settlements for select to authenticated
  using (barber_id = (select auth.uid()));

drop policy if exists "admin_all_transactions" on transactions;
create policy "admin_all_transactions" on transactions for all to authenticated
  using ((select auth_role()) = 'admin'::user_role);

drop policy if exists "barber_insert_own_transactions" on transactions;
create policy "barber_insert_own_transactions" on transactions for insert to authenticated
  with check (((select auth_role()) = 'barber'::user_role) AND (barber_id = (select auth.uid())) AND (branch_id = (select auth_branch_id())) AND (is_manual_override = false));

drop policy if exists "barber_read_own_transactions" on transactions;
create policy "barber_read_own_transactions" on transactions for select to authenticated
  using (((select auth_role()) = 'barber'::user_role) AND (barber_id = (select auth.uid())));

drop policy if exists "transactions_admin_read" on transactions;
create policy "transactions_admin_read" on transactions for select to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "transactions_admin_update" on transactions;
create policy "transactions_admin_update" on transactions for update to authenticated
  using (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())))
  with check (((select current_user_role()) = 'admin'::user_role) AND (branch_id = (select current_user_branch())));

drop policy if exists "transactions_barber_insert" on transactions;
create policy "transactions_barber_insert" on transactions for insert to authenticated
  with check (barber_id = (select auth.uid()));

drop policy if exists "transactions_barber_read" on transactions;
create policy "transactions_barber_read" on transactions for select to authenticated
  using (barber_id = (select auth.uid()));

