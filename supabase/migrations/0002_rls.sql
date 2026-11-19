-- ColleagueSplit — 0002: Row Level Security
--
-- Model: clients may READ rows of groups they belong to. ALL writes to groups, members,
-- invitations, expenses, splits, settlements and activity go through the SECURITY DEFINER
-- functions in 0003 (atomic + validated + audit-logged). Direct writes are revoked.

-- ---------------------------------------------------------------- helper functions
-- SECURITY DEFINER so policies don't recurse into group_members' own RLS.
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid());
$$;

create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.shares_group_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

revoke all on function public.is_group_member(uuid), public.is_group_admin(uuid),
  public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid),
  public.shares_group_with(uuid) to authenticated;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.profiles          enable row level security;
alter table public.groups            enable row level security;
alter table public.group_members     enable row level security;
alter table public.group_invitations enable row level security;
alter table public.expenses          enable row level security;
alter table public.expense_splits    enable row level security;
alter table public.settlements       enable row level security;
alter table public.activity_logs     enable row level security;

-- ---------------------------------------------------------------- privileges (defence in depth)
revoke all on public.profiles, public.groups, public.group_members, public.group_invitations,
  public.expenses, public.expense_splits, public.settlements, public.activity_logs from anon, authenticated;

grant select on public.profiles, public.groups, public.group_members, public.group_invitations,
  public.expenses, public.expense_splits, public.settlements, public.activity_logs to authenticated;
grant update (name, avatar_url, color_index) on public.profiles to authenticated;
grant update (name) on public.groups to authenticated;

-- ---------------------------------------------------------------- policies
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update_admin on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy members_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id));

-- Only admins can see invitation codes.
create policy invitations_select_admin on public.group_invitations for select to authenticated
  using (public.is_group_admin(group_id));

create policy expenses_select on public.expenses for select to authenticated
  using (deleted_at is null and public.is_group_member(group_id));

create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e
                 where e.id = expense_id and e.deleted_at is null and public.is_group_member(e.group_id)));

create policy settlements_select on public.settlements for select to authenticated
  using (public.is_group_member(group_id));

create policy activity_select on public.activity_logs for select to authenticated
  using (public.is_group_member(group_id));
-- No INSERT / UPDATE / DELETE policies exist for the tables above (except the two UPDATE
-- policies on profiles/groups): writes are only possible through the functions in 0003.
