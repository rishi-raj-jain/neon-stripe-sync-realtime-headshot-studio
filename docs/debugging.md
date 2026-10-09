# Debugging journeys

Every journey below starts the same way: **branch first, then poke**. A Neon branch
carries the Postgres data (including `neon_auth.*` and the synced `stripe.*` rows), its
own Object Storage namespace, and copies of the triggers, which start _disabled_. So a
debug branch can never email, charge or process anything on its own.

> Stripe sync only writes to the branch the pipeline is connected to. A debug branch's
> `stripe.*` tables are a frozen snapshot, which is exactly what you want while
> investigating. Treat them as scratch data there, and never write to them on `main`.

---

## 1. "I paid $29 and got nothing"

**Find the job.** Search for the user's email:

```sql
select j.id, j.status, j.error, j.invocation_id, j.created_at, j.started_at, j.finished_at
  from app.jobs j
  join neon_auth."user" u on u.id = j.user_id
 where u.email = 'customer@example.com'
 order by j.created_at desc;
```

**Read what the function said.** Every log line carries `invocation=… key=…`:

```bash
npx neon logs query --source function
```

**Branch from the moment it happened** and point your workspace at it:

```bash
npx neon branches create --name debug/headshots-1042 --parent 2026-10-08T10:42:00Z
npx neon checkout debug/headshots-1042      # pulls that branch's env into .env
```

Check that the selfie is in the branch's `selfies` bucket. Branches copy storage, but
confirm the object exists for your parent point before replaying.

**Replay the exact upload locally** against the branch's data and files:

```bash
npx neon dev                                            # serves onupload on :8787
scripts/replay-upload.sh uploads/<userId>/<jobId>.jpg   # in another terminal
```

To re-run a job, put it back in the queue (debug branch only):

```sql
update app.jobs
   set status = 'awaiting_upload', error = null, started_at = null, finished_at = null
 where id = '<jobId>';
```

Fix the code and replay until it's green. The outputs land in the branch's `headshots`
bucket and production is never touched. Then ship the fix and delete the branch:

```bash
npx neon branches delete debug/headshots-1042
```

## 2. "Does a refund really claw back credits?"

On a debug branch, act as Stripe and refund the charge in the snapshot:

```sql
-- debug branch ONLY: stripe.* is Stripe-owned on main
update stripe.charges set amount_refunded = amount / 2 where id = 'ch_…';
select * from app.credit_balances where user_id = '<userId>';
```

The balance drops by half the pack straight away, with no handler and nothing to
replay. Try `disputed = true` as well. The same check against the real thing:

- refund in the Stripe Dashboard (test mode)
- watch `stripe.charges._updated_at` move on `main`
- watch the wallet follow within seconds

## 3. "The sweeper failed my job while it was still running"

Each sweeper run logs `scheduledAt`. Branch the database at that instant to see exactly
what the sweeper saw:

```bash
npx neon branches create --name debug/sweeper --parent 2026-10-08T11:05:00Z
```

```sql
select id, status, started_at, now() - started_at as running_for
  from app.jobs where status = 'processing';
```

If a 4-variant job legitimately runs for 20+ minutes, raise `STUCK_AFTER` in
`functions/sweeper.ts` or generate variants sequentially with a heartbeat column. Then
deploy to the branch and watch the next scheduled run:

```bash
npx neon deploy    # applies neon.ts to the checked-out branch and re-enables its triggers
```

## 4. Changing the wallet without breaking it

The wallet is one view, so pricing and policy changes are SQL you can diff and test.

1. On a debug branch, snapshot the current balances:

   ```sql
   create table app.balances_before as select * from app.credit_balances;
   ```

2. Edit `creditBalances` in `src/db/schema/app.ts`, then run
   `npm run db:generate && npm run db:migrate` against the branch.
3. List every customer whose balance would change:

   ```sql
   select user_id, b.balance as before, a.balance as after
     from app.balances_before b
     join app.credit_balances a using (user_id)
    where b.balance <> a.balance;
   ```

4. Review the DDL against `main`:

   ```bash
   npx neon branches schema-diff main debug/wallet-v2
   ```

Ship it only when the list of changed balances is the one you expected.
