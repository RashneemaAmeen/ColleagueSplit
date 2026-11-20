-- ColleagueSplit — READ-ONLY report of possible duplicate settlements for MANUAL review.
-- It changes nothing. Run it in the Supabase SQL editor (works before or after migration 0006).
--
-- The old "I paid" / "Received" bug produced two rows for ONE payment: same group, same payer,
-- same receiver, same amount, recorded by different people (the payer and the receiver) close in time.
-- Both rows reduced the balance, so the payer's debt was cleared twice.
--
-- How to fix a real duplicate: open Settle Up -> Settlement history and use "Undo" on the EXTRA
-- payment with a reason like "Duplicate of ...". That reverses its effect, keeps the audit trail,
-- and deletes nothing. Do NOT delete rows by hand.

-- 1) Most likely duplicates: same pair + amount, recorded by two different people, both still active.
select
  g.name                                   as group_name,
  pf.name                                  as payer,
  pt.name                                  as receiver,
  to_char(a.amount_fils / 100.0, 'FM999G999G990D00') as amount_aed,
  a.id                                     as first_settlement_id,
  ca.name                                  as first_recorded_by,
  a.created_at                             as first_recorded_at,
  b.id                                     as second_settlement_id,
  cb.name                                  as second_recorded_by,
  b.created_at                             as second_recorded_at,
  b.created_at - a.created_at              as gap
from public.settlements a
join public.settlements b
  on  b.group_id   = a.group_id
  and b.from_user  = a.from_user
  and b.to_user    = a.to_user
  and b.amount_fils = a.amount_fils
  and b.id         > a.id
  and b.created_by <> a.created_by
  and a.undone_at is null
  and b.undone_at is null
  and abs(extract(epoch from (b.created_at - a.created_at))) < 7 * 24 * 3600
join public.groups   g  on g.id  = a.group_id
join public.profiles pf on pf.id = a.from_user
join public.profiles pt on pt.id = a.to_user
join public.profiles ca on ca.id = a.created_by
join public.profiles cb on cb.id = b.created_by
order by a.created_at desc;

-- 2) Wider net: any pair with several active payments of the same amount on the same day.
--    These can be legitimate (two separate AED 10 payments), so check with the people involved.
select
  g.name as group_name, pf.name as payer, pt.name as receiver, s.settled_on,
  to_char(s.amount_fils / 100.0, 'FM999G999G990D00') as amount_aed,
  count(*) as payments,
  array_agg(s.id order by s.created_at) as settlement_ids
from public.settlements s
join public.groups   g  on g.id  = s.group_id
join public.profiles pf on pf.id = s.from_user
join public.profiles pt on pt.id = s.to_user
where s.undone_at is null
group by g.name, pf.name, pt.name, s.settled_on, s.amount_fils
having count(*) > 1
order by s.settled_on desc;
