-- ColleagueSplit — 0005: tamper-resistant expense revision history
--
-- Every time an expense is created, edited or deleted, a FULL snapshot (amount, payer, date,
-- category, split method, notes, receipt, and every person's share) is appended to
-- public.expense_revisions together with who did it and when.
--
-- How it stays reliable:
--  * It is written by a DEFERRED constraint trigger on public.expenses, so it fires at COMMIT,
--    after save_expense()/delete_expense() have finished writing the expense_splits rows. The app
--    cannot forget or skip it, and it needs no change to the functions from 0003.
--  * Clients can only SELECT. Rows can never be updated, and direct deletes are blocked
--    (cascades from a parent delete are allowed so that a group could still be removed).
--  * changed_by is auth.uid(); it is NULL when the change was made directly in the database
--    (e.g. the SQL editor), which the UI shows as "Direct database change".
--
-- Run AFTER 0001-0004. Safe to run once; it does not touch existing expenses.

create table public.expense_revisions (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  revision   int  not null check (revision >= 1),
  action     text not null check (action in ('baseline', 'created', 'edited', 'deleted')),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  snapshot   jsonb not null,
  unique (expense_id, revision)
);
create index expense_revisions_expense_idx on public.expense_revisions (expense_id, revision);
create index expense_revisions_group_idx   on public.expense_revisions (group_id, changed_at desc);

-- ---------------------------------------------------------------- snapshot helper
create or replace function public.expense_snapshot(p_expense uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'description',  e.description,
    'amount_fils',  e.amount_fils,
    'date',         e.expense_date,
    'paid_by',      e.paid_by,
    'category',     e.category,
    'split_method', e.split_method,
    'notes',        e.notes,
    'receipt_path', e.receipt_path,
    'splits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', s.user_id, 'share_fils', s.share_fils, 'percent_bp', s.percent_bp
             ) order by s.user_id)
        from public.expense_splits s where s.expense_id = e.id
    ), '[]'::jsonb)
  )
  from public.expenses e where e.id = p_expense;
$$;
revoke all on function public.expense_snapshot(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- append-only guard
create or replace function public.prevent_revision_change()
returns trigger language plpgsql as $$
begin
  -- A cascading delete (parent row removed) runs this trigger at depth > 1; allow only that.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Expense history is append-only' using errcode = '42501';
end;
$$;
create trigger expense_revisions_immutable before update or delete on public.expense_revisions
  for each row execute function public.prevent_revision_change();

-- ---------------------------------------------------------------- recorder
create or replace function public.log_expense_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_rev    int;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'deleted';
  elsif new.deleted_at is not null then
    return null;                       -- already deleted: nothing further to record
  else
    v_action := 'edited';
  end if;

  select coalesce(max(revision), 0) + 1 into v_rev
    from public.expense_revisions where expense_id = new.id;

  insert into public.expense_revisions (expense_id, group_id, revision, action, changed_by, snapshot)
  values (new.id, new.group_id, v_rev, v_action, auth.uid(), public.expense_snapshot(new.id));
  return null;
end;
$$;

-- Deferred: fires at COMMIT, when the expense AND its splits are final.
create constraint trigger expenses_revision_trg after insert or update on public.expenses
  deferrable initially deferred for each row execute function public.log_expense_revision();

-- ---------------------------------------------------------------- existing data
-- Expenses that already exist get a "baseline" entry: their CURRENT state. Any edits made before
-- this migration were not captured in detail (only in the activity log), so history starts here.
insert into public.expense_revisions (expense_id, group_id, revision, action, changed_by, changed_at, snapshot)
select e.id, e.group_id, 1, 'baseline', e.created_by, now(), public.expense_snapshot(e.id)
  from public.expenses e
 where e.deleted_at is null
   and not exists (select 1 from public.expense_revisions r where r.expense_id = e.id);

-- ---------------------------------------------------------------- access
alter table public.expense_revisions enable row level security;
revoke all on public.expense_revisions from anon, authenticated;
grant select on public.expense_revisions to authenticated;

create policy expense_revisions_select on public.expense_revisions for select to authenticated
  using (public.is_group_member(group_id));
