DROP VIEW "app"."credit_balances";
CREATE VIEW "app"."credit_balances" AS (
      with purchased as (
        select c.user_id,
               sum(
                 floor(
                   coalesce(ch.metadata ->> 'credits', pi.metadata ->> 'credits', '0')::numeric
                   * (ch.amount - ch.amount_refunded) / nullif(ch.amount, 0)
                 )
               )::int as credits
          from app.customers c
          join stripe.charges ch on ch.customer = c.stripe_customer_id
          left join stripe.payment_intents pi on pi.id = ch.payment_intent
         where ch.status = 'succeeded'
           and ch.paid
           and not ch.disputed
         group by c.user_id
      ),
      free_orders as (
        select c.user_id, sum(coalesce(cs.metadata ->> 'credits', '0')::int)::int as credits
          from app.customers c
          join stripe.checkout_sessions cs on cs.customer = c.stripe_customer_id
         where cs.mode = 'payment'
           and cs.status = 'complete'
           and cs.payment_status = 'no_payment_required'
           and cs.amount_total = 0
         group by c.user_id
      ),
      spent as (
        select j.user_id, sum(j.cost)::int as credits
          from app.jobs j
         where j.status in ('processing', 'succeeded')
         group by j.user_id
      )
      select c.user_id,
             coalesce(p.credits, 0) + coalesce(f.credits, 0) as purchased,
             coalesce(s.credits, 0) as spent,
             coalesce(p.credits, 0) + coalesce(f.credits, 0) - coalesce(s.credits, 0) as balance
        from app.customers c
        left join purchased p on p.user_id = c.user_id
        left join free_orders f on f.user_id = c.user_id
        left join spent s on s.user_id = c.user_id
    );