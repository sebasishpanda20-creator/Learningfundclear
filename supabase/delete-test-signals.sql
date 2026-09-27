-- One-off cleanup: remove the rows created while testing the two-secret deploy
-- (27/28 Sep 2026). Delete-then-verify: run the SELECT after the DELETE and it
-- must return zero rows. Safe: RLS still holds, anon has no delete policy, and
-- these details strings are unique to the tests.

delete from public.signal_events
where details in ('two-secret deploy test chart', 'two-secret deploy test scan');

-- verify (expect 0 rows)
select symbol, action, price, details, created_at
from public.signal_events
where details like 'two-secret deploy test%';
