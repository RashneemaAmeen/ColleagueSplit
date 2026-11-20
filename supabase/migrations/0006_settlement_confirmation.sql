-- ColleagueSplit — 0006: two-sided settlement confirmation
--
-- Problem fixed: "I paid" (payer) and "Received" (receiver) each inserted their own settlement
-- row for the same real-world payment, so the balance was reduced twice.
--
-- New model: ONE settlement row per payment.
--   * It is recorded by one side and takes effect on balances immediately (balances only depend on
--     "not undone", so confirming never changes a balance a second time).
--   * The OTHER party can confirm it (confirm_settlement) — that updates the same row.
--   * status is derived:  undone_at set -> undone | confirmed_at set -> confirmed | else awaiting.
--   * If the other party records the same payment instead of confirming (stale screen, other
--     device, simultaneous tap), record_settlement() turns that into a confirmation of the
--     existing row rather than inserting a second one.
--   * A per-pair advisory lock serialises record/confirm for the same two people, so two
--     transactions racing each other cannot both insert.
--   * Separate / partial payments are NOT blocked: a payment only merges with an existing
--     UNCONFIRMED one from the OTHER party with the same direction and the same amount.
--
-- Does not modify earlier migrations and does not delete or change any existing money rows.
-- Existing settlements are marked confirmed (they predate this feature) — see the notes below.
-- Run AFTER 0001-0005.

-- ---------------------------------------------------------------- columns
alter table public.settlements
  add column confirmed_by       uuid references public.profiles (id),
  add column confirmed_at       timestamptz,
  add column confirm_request_id uuid;   -- idempotency key of the call that confirmed it

-- Legacy rows were recorded under the old one-sided model: treat them as confirmed so nobody is
-- asked to confirm old payments. (Possible old duplicates are NOT touched — review them with
-- supabase/tests/find_duplicate_settlements.sql and undo any extras from the Settle Up screen.)
update public.settlements
   set confirmed_by = created_by, confirmed_at = created_at
 where confirmed_at is null;

alter table public.settlements
  add constraint settlements_confirmed_pair_chk check ((confirmed_at is null) = (confirmed_by is null));

create unique index settlements_confirm_request_uidx
  on public.settlements (group_id, confirm_request_id) where confirm_request_id is not null;

-- fast lookup of unconfirmed payments for one direction/amount
create index settlements_awaiting_idx
  on public.settlements (group_id, from_user, to_user, amount_fils)
  where undone_at is null and confirmed_at is null;

-- ---------------------------------------------------------------- audit action
alter table public.activity_logs drop constraint if exists activity_logs_action_check;
alter table public.activity_logs add constraint activity_logs_action_check check (action in (
  'group_created','member_joined','expense_added','expense_edited','expense_deleted',
  'settlement_added','settlement_confirmed','settlement_undone'));

-- ---------------------------------------------------------------- pair lock
create or replace function public.lock_settlement_pair(p_group uuid, p_a uuid, p_b uuid)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended(
    p_group::text || ':' ||
    case when p_a::text < p_b::text then p_a::text || ':' || p_b::text else p_b::text || ':' || p_a::text end, 0));
$$;
revoke all on function public.lock_settlement_pair(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- record (replaces 0003 version)
create or replace function public.record_settlement(
  p_group uuid, p_client_request_id uuid, p_from uuid, p_to uuid, p_amount_fils bigint,
  p_method text, p_date date, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_pending public.settlements%rowtype;
  v_from    text;
  v_to      text;
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

  -- Everything below is serialised per pair of people, so concurrent calls cannot both insert.
  perform public.lock_settlement_pair(p_group, p_from, p_to);

  -- repeated submission of the same request (double tap, retry): return what it created / confirmed
  select id into v_id from public.settlements
   where group_id = p_group and (client_request_id = p_client_request_id or confirm_request_id = p_client_request_id);
  if found then return v_id; end if;

  -- The other side already recorded this exact payment and it is still unconfirmed:
  -- this call is a confirmation, not a new payment. Balances are unchanged (already applied).
  if v_uid in (p_from, p_to) then
    select * into v_pending from public.settlements
     where group_id = p_group and from_user = p_from and to_user = p_to and amount_fils = p_amount_fils
       and undone_at is null and confirmed_at is null and created_by <> v_uid
     order by created_at, id
     limit 1
     for update;
    if found then
      update public.settlements
         set confirmed_by = v_uid, confirmed_at = now(), confirm_request_id = p_client_request_id
       where id = v_pending.id;
      select name into v_from from public.profiles where id = p_from;
      select name into v_to   from public.profiles where id = p_to;
      perform public.log_activity(p_group, 'settlement_confirmed', 'settlement', v_pending.id,
              case when v_uid = p_to then v_to || ' confirmed receiving ' || public.fmt_aed(p_amount_fils) || ' from ' || v_from
                   else v_from || ' confirmed paying ' || public.fmt_aed(p_amount_fils) || ' to ' || v_to end);
      return v_pending.id;
    end if;
  end if;

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

-- ---------------------------------------------------------------- confirm
-- Only the payer or the receiver — and never the person who recorded it — can confirm.
-- Idempotent: confirming an already-confirmed payment is a harmless no-op.
create or replace function public.confirm_settlement(p_group uuid, p_settlement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s   public.settlements%rowtype;
  v_from text;
  v_to   text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;

  select * into v_s from public.settlements where id = p_settlement and group_id = p_group;
  if not found then raise exception 'Settlement not found' using errcode = 'P0002'; end if;

  perform public.lock_settlement_pair(p_group, v_s.from_user, v_s.to_user);
  select * into v_s from public.settlements where id = p_settlement and group_id = p_group for update;

  if v_s.undone_at is not null then
    raise exception 'This payment was undone' using errcode = '22023';
  end if;
  if v_s.confirmed_at is not null then
    return;                                         -- already confirmed: nothing to do
  end if;
  if v_uid not in (v_s.from_user, v_s.to_user) then
    raise exception 'Only the payer or the receiver can confirm this payment' using errcode = '42501';
  end if;
  if v_uid = v_s.created_by then
    raise exception 'You recorded this payment, so the other person needs to confirm it' using errcode = '42501';
  end if;

  update public.settlements set confirmed_by = v_uid, confirmed_at = now() where id = p_settlement;
  select name into v_from from public.profiles where id = v_s.from_user;
  select name into v_to   from public.profiles where id = v_s.to_user;
  perform public.log_activity(p_group, 'settlement_confirmed', 'settlement', p_settlement,
          case when v_uid = v_s.to_user then v_to || ' confirmed receiving ' || public.fmt_aed(v_s.amount_fils) || ' from ' || v_from
               else v_from || ' confirmed paying ' || public.fmt_aed(v_s.amount_fils) || ' to ' || v_to end);
end;
$$;

revoke all on function
  public.record_settlement(uuid, uuid, uuid, uuid, bigint, text, date, text),
  public.confirm_settlement(uuid, uuid)
  from public, anon;
grant execute on function
  public.record_settlement(uuid, uuid, uuid, uuid, bigint, text, date, text),
  public.confirm_settlement(uuid, uuid)
  to authenticated;
