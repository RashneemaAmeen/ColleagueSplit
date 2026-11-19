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

  -- balances sum to zero: payer credit - shares - settlements
  select (select coalesce(sum(amount_fils), 0) from public.expenses where group_id = g)
       - (select coalesce(sum(share_fils), 0) from public.expense_splits s join public.expenses x on x.id = s.expense_id where x.group_id = g)
    into bal;
  assert bal = 0, 'expense credits equal expense shares';

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
