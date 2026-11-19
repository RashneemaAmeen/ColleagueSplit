-- ColleagueSplit — 0003: transactional write API (RPC)
--
-- Every function: runs as SECURITY DEFINER with a pinned search_path, derives the caller from
-- auth.uid() (never from a parameter), checks membership/role, validates input again server-side,
-- writes an activity-log row, and is atomic (a function call is a single transaction).

create or replace function public.log_activity(
  p_group uuid, p_action text, p_entity_type text, p_entity uuid, p_summary text
) returns void language sql security definer set search_path = public as $$
  insert into public.activity_logs (group_id, actor_id, action, entity_type, entity_id, summary)
  values (p_group, auth.uid(), p_action, p_entity_type, p_entity, left(p_summary, 300));
$$;
revoke all on function public.log_activity(uuid, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.fmt_aed(p_fils bigint)
returns text language sql immutable as $$
  select 'AED ' || to_char(p_fils / 100.0, 'FM999G999G990D00');
$$;

-- ---------------------------------------------------------------- groups
create or replace function public.create_group(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Group name must be 1-60 characters' using errcode = '22023';
  end if;
  insert into public.groups (name, created_by) values (v_name, v_uid) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_uid, 'admin');
  perform public.log_activity(v_id, 'group_created', 'group', v_id, 'Created the group "' || v_name || '"');
  return v_id;
end;
$$;

-- Invitation codes: 48 bits from a CSPRNG, expire after p_days, limited uses, revocable.
create or replace function public.create_invitation(p_group uuid, p_days int default 7, p_max_uses int default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code text;
  v_exp  timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'Only group admins can invite people' using errcode = '42501';
  end if;
  v_code := upper(encode(gen_random_bytes(6), 'hex'));
  v_exp  := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
  insert into public.group_invitations (group_id, code, created_by, expires_at, max_uses)
  values (p_group, v_code, auth.uid(), v_exp, greatest(1, least(coalesce(p_max_uses, 10), 100)));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.group_invitations%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_inv from public.group_invitations
   where code = upper(btrim(coalesce(p_code, '')))
     and revoked_at is null and expires_at > now() and use_count < max_uses
   for update;
  -- One generic error for unknown / expired / revoked / used-up codes: no information leak.
  if not found then
    raise exception 'This invitation is invalid or has expired' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return v_inv.group_id;   -- already a member: don't consume the invitation
  end if;
  insert into public.group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update public.group_invitations set use_count = use_count + 1 where id = v_inv.id;
  select name into v_name from public.profiles where id = v_uid;
  perform public.log_activity(v_inv.group_id, 'member_joined', 'member', v_uid, v_name || ' joined the group');
  return v_inv.group_id;
end;
$$;

-- ---------------------------------------------------------------- expenses
-- p_splits: [{"user_id": "...", "share_fils": 3000, "percent_bp": null}, ...]
-- p_expense_id null => create (idempotent on p_client_request_id); otherwise edit.
create or replace function public.save_expense(
  p_expense_id uuid, p_group uuid, p_client_request_id uuid, p_description text,
  p_amount_fils bigint, p_date date, p_paid_by uuid, p_category text, p_split_method text,
  p_notes text, p_receipt_path text, p_splits jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_desc  text := btrim(coalesce(p_description, ''));
  v_sum   bigint;
  v_bp    int;
  v_count int;
  v_distinct int;
  v_old   public.expenses%rowtype;
  v_msg   text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;

  -- validation (mirrors src/lib/core/validate.ts)
  if char_length(v_desc) not between 1 and 120 then raise exception 'Description must be 1-120 characters' using errcode = '22023'; end if;
  if p_amount_fils is null or p_amount_fils <= 0 or p_amount_fils > 100000000 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  if p_date is null then raise exception 'Date is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_paid_by) then
    raise exception 'Payer must be a group member' using errcode = '22023';
  end if;
  if p_receipt_path is not null and p_receipt_path not like p_group::text || '/%' then
    raise exception 'Invalid receipt path' using errcode = '22023';
  end if;
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'Select at least one person to split with' using errcode = '22023';
  end if;

  select count(*), count(distinct (s ->> 'user_id')), coalesce(sum((s ->> 'share_fils')::bigint), 0),
         coalesce(sum(coalesce((s ->> 'percent_bp')::int, 0)), 0)
    into v_count, v_distinct, v_sum, v_bp
    from jsonb_array_elements(p_splits) s;
  if v_count <> v_distinct then raise exception 'A person appears twice in the split' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_splits) s
    where (s ->> 'share_fils')::bigint < 0
       or not exists (select 1 from public.group_members m
                      where m.group_id = p_group and m.user_id = (s ->> 'user_id')::uuid)
  ) then raise exception 'Split includes an invalid share or someone outside the group' using errcode = '22023'; end if;
  if v_sum <> p_amount_fils then raise exception 'Shares must add up exactly to the total' using errcode = '22023'; end if;
  if p_split_method = 'percent' and v_bp <> 10000 then raise exception 'Percentages must total 100%%' using errcode = '22023'; end if;

  if p_expense_id is null then
    -- idempotency: a repeated submission returns the original expense
    select id into v_id from public.expenses where group_id = p_group and client_request_id = p_client_request_id;
    if found then return v_id; end if;
    insert into public.expenses (group_id, description, amount_fils, expense_date, paid_by, category,
                                 split_method, notes, receipt_path, client_request_id, created_by)
    values (p_group, v_desc, p_amount_fils, p_date, p_paid_by, p_category, p_split_method,
            btrim(coalesce(p_notes, '')), p_receipt_path, p_client_request_id, v_uid)
    returning id into v_id;
    v_msg := 'Added "' || v_desc || '" · ' || public.fmt_aed(p_amount_fils);
    perform public.log_activity(p_group, 'expense_added', 'expense', v_id, v_msg);
  else
    select * into v_old from public.expenses
     where id = p_expense_id and group_id = p_group and deleted_at is null for update;
    if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
    if not (public.is_group_admin(p_group) or v_old.created_by = v_uid or v_old.paid_by = v_uid) then
      raise exception 'Only the person who added or paid for this expense, or a group admin, can edit it' using errcode = '42501';
    end if;
    v_id := v_old.id;
    update public.expenses set description = v_desc, amount_fils = p_amount_fils, expense_date = p_date,
           paid_by = p_paid_by, category = p_category, split_method = p_split_method,
           notes = btrim(coalesce(p_notes, '')), receipt_path = p_receipt_path
     where id = v_id;
    delete from public.expense_splits where expense_id = v_id;
    v_msg := 'Edited "' || v_desc || '" · ' ||
             case when v_old.amount_fils = p_amount_fils then public.fmt_aed(p_amount_fils)
                  else public.fmt_aed(v_old.amount_fils) || ' → ' || public.fmt_aed(p_amount_fils) end;
    perform public.log_activity(p_group, 'expense_edited', 'expense', v_id, v_msg);
  end if;

  insert into public.expense_splits (expense_id, user_id, share_fils, percent_bp)
  select v_id, (s ->> 'user_id')::uuid, (s ->> 'share_fils')::bigint,
         case when p_split_method = 'percent' then (s ->> 'percent_bp')::int end
    from jsonb_array_elements(p_splits) s;

  return v_id;
end;
$$;

create or replace function public.delete_expense(p_group uuid, p_expense uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_e   public.expenses%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  select * into v_e from public.expenses
   where id = p_expense and group_id = p_group and deleted_at is null for update;
  if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  if not (public.is_group_admin(p_group) or v_e.created_by = v_uid or v_e.paid_by = v_uid) then
    raise exception 'Only the person who added or paid for this expense, or a group admin, can delete it' using errcode = '42501';
  end if;
  update public.expenses set deleted_at = now(), deleted_by = v_uid where id = p_expense;
  perform public.log_activity(p_group, 'expense_deleted', 'expense', p_expense,
          'Deleted "' || v_e.description || '" · ' || public.fmt_aed(v_e.amount_fils));
end;
$$;

-- ---------------------------------------------------------------- settlements
create or replace function public.record_settlement(
  p_group uuid, p_client_request_id uuid, p_from uuid, p_to uuid, p_amount_fils bigint,
  p_method text, p_date date, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_from text;
  v_to   text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  if p_from = p_to then raise exception 'Payer and receiver must be different people' using errcode = '22023'; end if;
  if p_amount_fils is null or p_amount_fils <= 0 or p_amount_fils > 100000000 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  if (select count(*) from public.group_members where group_id = p_group and user_id in (p_from, p_to)) <> 2 then
    raise exception 'Both people must be group members' using errcode = '22023';
  end if;
  if not (public.is_group_admin(p_group) or v_uid = p_from or v_uid = p_to) then
    raise exception 'You can only record payments you made or received' using errcode = '42501';
  end if;

  select id into v_id from public.settlements where group_id = p_group and client_request_id = p_client_request_id;
  if found then return v_id; end if;   -- duplicate submission

  insert into public.settlements (group_id, client_request_id, from_user, to_user, amount_fils, method,
                                  settled_on, note, created_by)
  values (p_group, p_client_request_id, p_from, p_to, p_amount_fils, p_method, p_date,
          btrim(coalesce(p_note, '')), v_uid)
  returning id into v_id;
  select name into v_from from public.profiles where id = p_from;
  select name into v_to   from public.profiles where id = p_to;
  perform public.log_activity(p_group, 'settlement_added', 'settlement', v_id,
          v_from || ' paid ' || v_to || ' ' || public.fmt_aed(p_amount_fils));
  return v_id;
end;
$$;

create or replace function public.undo_settlement(p_group uuid, p_settlement uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s   public.settlements%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_from text;
  v_to   text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 200 then
    raise exception 'Please give a reason (up to 200 characters)' using errcode = '22023';
  end if;
  select * into v_s from public.settlements where id = p_settlement and group_id = p_group for update;
  if not found then raise exception 'Settlement not found' using errcode = 'P0002'; end if;
  if v_s.undone_at is not null then raise exception 'This settlement was already undone' using errcode = '22023'; end if;
  if not (public.is_group_admin(p_group) or v_s.created_by = v_uid or v_s.from_user = v_uid or v_s.to_user = v_uid) then
    raise exception 'Only the people involved or a group admin can undo this settlement' using errcode = '42501';
  end if;
  update public.settlements set undone_at = now(), undone_by = v_uid, undo_reason = v_reason where id = p_settlement;
  select name into v_from from public.profiles where id = v_s.from_user;
  select name into v_to   from public.profiles where id = v_s.to_user;
  perform public.log_activity(p_group, 'settlement_undone', 'settlement', p_settlement,
          'Undid ' || v_from || ' → ' || v_to || ' ' || public.fmt_aed(v_s.amount_fils) || ' (' || v_reason || ')');
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function
  public.create_group(text), public.create_invitation(uuid, int, int), public.join_group(text),
  public.save_expense(uuid, uuid, uuid, text, bigint, date, uuid, text, text, text, text, jsonb),
  public.delete_expense(uuid, uuid),
  public.record_settlement(uuid, uuid, uuid, uuid, bigint, text, date, text),
  public.undo_settlement(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.create_group(text), public.create_invitation(uuid, int, int), public.join_group(text),
  public.save_expense(uuid, uuid, uuid, text, bigint, date, uuid, text, text, text, text, jsonb),
  public.delete_expense(uuid, uuid),
  public.record_settlement(uuid, uuid, uuid, uuid, bigint, text, date, text),
  public.undo_settlement(uuid, uuid, text)
  to authenticated;
