-- Lookup indexes on Stripe-synced tables. The pipeline only creates primary keys
-- (id, _account_id) and _updated_at indexes, so every per-customer read was a sequential
-- scan. These add no columns and change no data, so the sync keeps writing as before.
-- If the pipeline ever recreates a table (e.g. a full resync), re-run these statements.

-- Wallet view + purchase history: a customer's charges, newest first.
CREATE INDEX IF NOT EXISTS "headshots_charges_customer_created_idx" ON "stripe"."charges" USING btree ("customer", "created");--> statement-breakpoint
-- Wallet view + purchase history: a customer's free ($0) Checkout Sessions.
CREATE INDEX IF NOT EXISTS "headshots_checkout_sessions_customer_created_idx" ON "stripe"."checkout_sessions" USING btree ("customer", "created");--> statement-breakpoint
-- /api/checkout: price by lookup key, promotion code by code.
CREATE INDEX IF NOT EXISTS "headshots_prices_lookup_key_idx" ON "stripe"."prices" USING btree ("lookup_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "headshots_promotion_codes_code_idx" ON "stripe"."promotion_codes" USING btree ("code");
