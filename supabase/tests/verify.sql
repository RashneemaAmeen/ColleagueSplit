-- ColleagueSplit — live verification script. Run in the Supabase SQL editor AFTER the migrations.
-- NOT YET EXECUTED by the author: treat a failure here as a bug report.
--
-- It impersonates users by setting the JWT claims for the current transaction, runs checks,
-- raises an exception on the first failure, and ROLLS BACK so no data is left behind.
-- Expected result: a NOTICE saying "ALL CHECKS PASSED" and no error.

begin;

-- Impersonate a user for the rest of this transaction (both claim formats used by Supabase versions).
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$f$;

do $$
declare
  u_admin uuid := gen_random_uuid();
  u_b     uuid := gen_random_uuid();
  u_out   uuid := gen_random_uuid();
  g       uuid;
  code    text;
  rid     uuid := gen_random_uuid();
  e1      uuid;
  e2      uuid;
  s1      uuid;
  n       int;
  bal     bigint;
  failed  boolean;
begin
  -- throw-away auth users (the on_auth_user_created trigger creates their profiles)
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (u_admin, 'admin@test.invalid', '{"name":"Admin"}', 'authenticated', 'authenticated'),
         (u_b,     'b@test.invalid',     '{"name":"B"}',     'authenticated', 'authenticated'),
         (u_out,   'out@test.invalid',   '{"name":"Out"}',   'authenticated', 'authenticated');

  -- act as admin: create group + invitation
  perform pg_temp.act_as(u_admin);
  g    := public.create_group('Verify crew');
  code := (public.create_invitation(g) ->> 'code');
  assert code ~ '^[A-F0-9]{12}$', 'invite code format';

  -- B joins with the code
  perform pg_temp.act_as(u_b);
  perform public.join_group(code);

  -- outsider: cannot see the group, cannot write, cannot join with a bad code
  perform pg_temp.act_as(u_out);
  select count(*) into n from public.groups where id = g;
  assert n = 0, 'RLS: outsider must not see the group';
  failed := false;
  begin
    perform public.save_expense(null, g, gen_random_uuid(), 'x', 1000, current_date, u_out, 'lunch', 'equal', '', null,
      jsonb_build_array(jsonb_build_object('user_id', u_out, 'share_fils', 1000)));
  exception when others then failed := true; end;
  assert failed, 'outsider must not create expenses';
  failed := false;
  begin perform public.join_group('000000000000'); exception when others then failed := true; end;
  assert failed, 'bad invite code must fail';

  -- admin: AED 120.00 split equally between admin and B
  perform pg_temp.act_as(u_admin);
  e1 := public.save_expense(null, g, rid, 'Lunch', 12000, current_date, u_admin, 'lunch', 'equal', '', null,
    jsonb_build_array(jsonb_build_object('user_id', u_admin, 'share_fils', 6000),
                      jsonb_build_object('user_id', u_b,     'share_fils', 6000)));
  -- duplicate submission returns the same row
  e2 := public.save_expense(null, g, rid, 'Lunch', 12000, current_date, u_admin, 'lunch', 'equal', '', null,
    jsonb_build_array(jsonb_build_object('user_id', u_admin, 'share_fils', 6000),
                      jsonb_build_object('user_id', u_b,     'share_fils', 6000)));
  assert e1 = e2, 'idempotent save_expense';
  select count(*) into n from public.expenses where group_id = g;
  assert n = 1, 'only one expense stored';

  -- shares that do not add up are rejected
  failed := false;
  begin
    perform public.save_expense(null, g, gen_random_uuid(), 'Bad', 12000, current_date, u_admin, 'lunch', 'exact', '', null,
      jsonb_build_array(jsonb_build_object('user_id', u_admin, 'share_fils', 5000),
                        jsonb_build_object('user_id', u_b,     'share_fils', 5000)));
  exception when others then failed := true; end;
  assert failed, 'mismatching shares must be rejected';

  -- B (not creator / payer / admin) cannot delete it
  perform pg_temp.act_as(u_b);
  failed := false;
  begin perform public.delete_expense(g, e1); exception when others then failed := true; end;
  assert failed, 'non-owner cannot delete';

  -- B pays admin 30.00 (partial), then undo requires a reason
  perform public.record_settlement(g, gen_random_uuid(), u_b, u_admin, 3000, 'cash', current_date, '');
  select coalesce(sum(case when to_user = u_admin then amount_fils else -amount_fils end), 0)
    into bal from public.settlements where group_id = g and undone_at is null;
  assert bal = 3000, 'settlement recorded';
  failed := false;
  begin perform public.undo_settlement(g, (select id from public.settlements where group_id = g limit 1), ' '); exception when others then failed := true; end;
  assert failed, 'undo needs a reason';

  -- ---- two-sided settlement confirmation (migration 0006) ----
  -- B's 30.00 payment (recorded by B above) takes effect immediately but awaits the receiver.
  select id into s1 from public.settlements where group_id = g;
  select count(*) into n from public.settlements where group_id = g and confirmed_at is null and undone_at is null;
  assert n = 1, 'settlement starts awaiting confirmation';
  -- the person who recorded it cannot confirm their own payment
  failed := false;
  begin perform public.confirm_settlement(g, s1); exception when others then failed := true; end;
  assert failed, 'recorder cannot confirm own payment';
  -- receiver (admin) taps "Received" on a stale screen, with a NEW request id:
  -- it must merge into the existing row instead of inserting a duplicate
  perform pg_temp.act_as(u_admin);
  assert public.record_settlement(g, gen_random_uuid(), u_b, u_admin, 3000, 'cash', current_date, '') = s1,
    'stale "Received" returns the existing settlement';
  select count(*) into n from public.settlements where group_id = g;
  assert n = 1, 'no duplicate settlement row';
  select count(*) into n from public.settlements
   where id = s1 and confirmed_by = u_admin and confirmed_at is not null;
  assert n = 1, 'merged call confirmed the existing row';
  -- confirming again is a harmless no-op and is logged only once
  perform public.confirm_settlement(g, s1);
  select count(*) into n from public.activity_logs where group_id = g and action = 'settlement_confirmed';
  assert n = 1, 'confirmation logged once';
  -- a separate payment of the same amount after the first was confirmed is allowed
  perform pg_temp.act_as(u_b);
  perform public.record_settlement(g, gen_random_uuid(), u_b, u_admin, 3000, 'cash', current_date, '');
  select count(*) into n from public.settlements where group_id = g;
  assert n = 2, 'separate same-amount payment is allowed';
  -- a non-member cannot confirm
  perform pg_temp.act_as(u_out);
  failed := false;
  begin perform public.confirm_settlement(g, s1); exception when others then failed := true; end;
  assert failed, 'outsider cannot confirm';
  perform pg_temp.act_as(u_b);

  -- balances sum to zero: payer credit - shares - settlements
  select (select coalesce(sum(amount_fils), 0) from public.expenses where group_id = g)
       - (select coalesce(sum(share_fils), 0) from public.expense_splits s join public.expenses x on x.id = s.expense_id where x.group_id = g)
    into bal;
  assert bal = 0, 'expense credits equal expense shares';

  -- ---- expense history (migration 0005) ----
  -- admin edits the expense amount 120.00 -> 140.00 (shares 70 / 70)
  perform pg_temp.act_as(u_admin);
  perform public.save_expense(e1, g, gen_random_uuid(), 'Lunch', 14000, current_date, u_admin, 'lunch', 'equal', '', null,
    jsonb_build_array(jsonb_build_object('user_id', u_admin, 'share_fils', 7000),
                      jsonb_build_object('user_id', u_b,     'share_fils', 7000)));
  -- history is written by a DEFERRED trigger; force it to run now instead of waiting for COMMIT
  set constraints all immediate;
  select count(*) into n from public.expense_revisions where expense_id = e1 and action = 'created';
  assert n = 1, 'history: created entry';
  select count(*) into n from public.expense_revisions
   where expense_id = e1 and action = 'edited' and changed_by = u_admin
     and (snapshot ->> 'amount_fils')::bigint = 14000 and jsonb_array_length(snapshot -> 'splits') = 2;
  assert n = 1, 'history: edited entry with who + full snapshot';
  set constraints all deferred;

  -- history cannot be altered, even by a member
  failed := false;
  begin update public.expense_revisions set action = 'created' where expense_id = e1; exception when others then failed := true; end;
  assert failed, 'history is append-only (update)';
  failed := false;
  begin delete from public.expense_revisions where expense_id = e1; exception when others then failed := true; end;
  assert failed, 'history is append-only (delete)';

  -- members can read it, outsiders cannot
  select count(*) into n from public.expense_revisions where expense_id = e1;
  assert n >= 2, 'members can read history';
  perform pg_temp.act_as(u_out);
  select count(*) into n from public.expense_revisions where expense_id = e1;
  assert n = 0, 'RLS: outsider must not read history';

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
