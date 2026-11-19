-- ColleagueSplit — 0001: core schema
-- All money is stored as integer fils (1 AED = 100 fils). Never floats.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  avatar_url  text,
  color_index int  not null default 0 check (color_index between 0 and 11),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, color_index)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Member'), 60),
    abs(hashtext(new.id::text)) % 8
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- groups
-- `currency` is stored per group so multi-currency can be added later.
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  currency   text not null default 'AED' check (currency = 'AED'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invitations (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  code       text not null unique check (code ~ '^[A-F0-9]{12}$'),
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  max_uses   int  not null default 10 check (max_uses between 1 and 100),
  use_count  int  not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invitations_group_idx on public.group_invitations (group_id);

-- ---------------------------------------------------------------- expenses
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  description       text not null check (char_length(btrim(description)) between 1 and 120),
  amount_fils       bigint not null check (amount_fils > 0 and amount_fils <= 100000000),
  expense_date      date not null,
  paid_by           uuid not null references public.profiles (id),
  category          text not null check (category in
                      ('lunch','breakfast','dinner','coffee','snacks','groceries','transport','other')),
  split_method      text not null check (split_method in ('equal','exact','percent')),
  notes             text not null default '' check (char_length(notes) <= 500),
  receipt_path      text,
  client_request_id uuid not null,            -- idempotency key: prevents duplicate submissions
  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,              -- soft delete keeps the audit trail
  deleted_by        uuid references public.profiles (id),
  unique (group_id, client_request_id)
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc) where deleted_at is null;
create index expenses_paid_by_idx on public.expenses (paid_by);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

create table public.expense_splits (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  share_fils bigint not null check (share_fils >= 0),
  percent_bp int check (percent_bp is null or percent_bp between 0 and 10000),
  primary key (expense_id, user_id)
);
create index expense_splits_user_idx on public.expense_splits (user_id);

-- DB-level invariant: the shares of an expense always add up to its total.
-- Deferred, so it is checked at COMMIT after the expense and all its splits are written.
create or replace function public.assert_expense_splits_balance()
returns trigger language plpgsql as $$
declare
  v_id    uuid;
  v_total bigint;
  v_sum   bigint;
begin
  if tg_table_name = 'expenses' then
    v_id := new.id;
  else
    v_id := new.expense_id;
  end if;
  select amount_fils into v_total from public.expenses where id = v_id;
  if v_total is null then
    return null;  -- expense was removed in the same transaction
  end if;
  select coalesce(sum(share_fils), 0) into v_sum from public.expense_splits where expense_id = v_id;
  if v_sum <> v_total then
    raise exception 'Expense shares (%) must add up to the total (%)', v_sum, v_total
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger expenses_balance_chk after insert or update on public.expenses
  deferrable initially deferred for each row execute function public.assert_expense_splits_balance();
create constraint trigger expense_splits_balance_chk after insert or update on public.expense_splits
  deferrable initially deferred for each row execute function public.assert_expense_splits_balance();

-- ---------------------------------------------------------------- settlements
-- A settlement records a payment made outside the app (cash / bank transfer).
-- It changes balances but is never counted as spending.
create table public.settlements (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  from_user         uuid not null references public.profiles (id),
  to_user           uuid not null references public.profiles (id),
  amount_fils       bigint not null check (amount_fils > 0 and amount_fils <= 100000000),
  method            text not null check (method in ('cash','bank_transfer','other')),
  settled_on        date not null,
  note              text not null default '' check (char_length(note) <= 300),
  client_request_id uuid not null,
  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),
  undone_at         timestamptz,
  undone_by         uuid references public.profiles (id),
  undo_reason       text check (undo_reason is null or char_length(undo_reason) between 1 and 200),
  check (from_user <> to_user),
  check ((undone_at is null) = (undone_by is null)),
  unique (group_id, client_request_id)
);
create index settlements_group_idx on public.settlements (group_id, created_at desc);

-- ---------------------------------------------------------------- activity log
create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  actor_id    uuid not null references public.profiles (id),
  action      text not null check (action in ('group_created','member_joined','expense_added',
                'expense_edited','expense_deleted','settlement_added','settlement_undone')),
  entity_type text not null check (entity_type in ('group','expense','settlement','member')),
  entity_id   uuid,
  summary     text not null check (char_length(summary) <= 300),
  created_at  timestamptz not null default now()
);
create index activity_group_idx on public.activity_logs (group_id, created_at desc);
