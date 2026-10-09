# Headshot Studio

Upload one selfie, get studio headshots. A reference app for **Stripe real-time sync to
Postgres** on **Neon**, with no Stripe webhooks anywhere.

```
 Browser ──Checkout──▶ Stripe ══ real-time sync ══▶ Neon: stripe.charges, stripe.payment_intents
    │                                                          │
    │ POST /api/jobs ─▶ presigned PUT                           ▼
    └──── selfie ──────▶ Object Storage: selfies/uploads/…   app.credit_balances (VIEW)
                               │ storage_object_created            ▲
                               ▼                                   │ claim = debit
                      Neon Function `onupload` ────────────────────┘
                               │ AI Gateway (Responses API, image_generation)
                               ▼
                      Object Storage: headshots/…  ──▶ presigned GET ──▶ Browser
```

| Piece                                | Used for                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Stripe Data Pipeline → Neon          | `stripe.*` tables; the wallet is a SQL view over them                              |
| Neon Auth (Managed Better Auth)      | sign-up/in; users live in `neon_auth.*`                                            |
| Neon Object Storage + `aws4fetch`    | `selfies` (inputs) and `headshots` (outputs), both private; SigV4 via fetch        |
| Neon Functions + triggers            | `onupload` (storage trigger) and `sweeper` (cron, every 5 min)                     |
| Neon AI Gateway                      | image generation, no provider keys                                                 |
| Next.js 16 on Vercel `cle1`          | UI and API routes, next to the Neon project in `aws-us-east-2`                     |
| `@neondatabase/serverless` + Drizzle | app queries on pooled `DATABASE_URL`; schema/migrations on `DATABASE_URL_UNPOOLED` |
| valibot + `@dotenvx/dotenvx/config`  | env validation; dotenv loading for `neon.ts`, drizzle and the scripts              |

## Why there are no webhooks

- **Credits are derived, not stored.** `app.credit_balances` = credits on succeeded,
  undisputed charges (pro-rated for refunds) − cost of jobs in `processing`/`succeeded`.
  - A refund in the Dashboard lowers the balance seconds later.
  - A failed generation returns its credits because the job leaves the "spent" states.
  - Nothing can be double-credited, because nothing increments a balance.
- **The upload is the queue.** The selfie landing in the bucket fires `onupload`. The
  function claims the job in one transaction under a per-user advisory lock, and that
  claim is the debit. Redeliveries are no-ops.
- **Writes go to Stripe's API, reads come from Postgres.** `/api/checkout` creates the
  session. After Checkout, the studio polls `/api/credits` until the synced charge appears.

Preview caveats, built into the design:

- Creates in `checkout_sessions` and updates to `payment_intents` can take up to
  10 minutes to sync. So the wallet keys off `charges` and the user ↔ customer mapping
  lives in `app.customers`.
- Rows can briefly show an earlier state, which the polling UI tolerates.

### Switching Stripe accounts or modes

Use the same Stripe account (or sandbox) for both `STRIPE_SECRET_KEY` and the Neon pipeline.
In the account you switch to:

- **Catalog:** create the three prices with lookup keys `headshots_starter`, `headshots_pro`
  and `headshots_studio`, plus the `HEADSHOTS100` promotion code. Checkout finds them by
  lookup key and code, so no ids live in the code.
- **Customers:** nothing to do. `ensureStripeCustomer` re-checks each stored customer id
  against the current account and creates a fresh customer when the id is unknown there.
- **Wallet view:** if you drop the `stripe` schema, `CASCADE` also drops
  `app.credit_balances`. Re-create it from `drizzle/0001_wallet_free_orders.sql` once the
  pipeline has synced again.

## API routes

| Route                 | Method | What it does                                                    |
| --------------------- | ------ | --------------------------------------------------------------- |
| `/api/auth/[...path]` | \*     | Neon Auth proxy                                                 |
| `/api/checkout`       | POST   | `{ pack }` → Stripe Checkout URL                                |
| `/api/credits`        | GET    | wallet (from the view) + purchases (from `stripe.charges`)      |
| `/api/jobs`           | GET    | your 20 latest jobs                                             |
| `/api/jobs`           | POST   | `{ style, variants, contentType }` → job + presigned upload URL |
| `/api/jobs/[id]`      | GET    | job + presigned download URLs once it succeeds                  |

The functions are triggered by Neon, not called by the app:

- `functions/onupload.ts` fires on `storage_object_created` in `selfies/uploads/`.
- `functions/sweeper.ts` runs on the `*/5 * * * *` schedule.

## Setup

You need:

- Node 22.18+ (Neon Functions run on Node 24).
- A **paid** Neon plan with AI Gateway credits.
- Stripe real-time sync preview access ([request it here](https://docs.stripe.com/data/data-pipeline/real-time-sync-to-postgres)).

```bash
npm install
```

1. **Neon project.** Use **AWS US East (Ohio) `aws-us-east-2`**, which Vercel's `cle1`
   sits next to and which supports Storage, Functions and AI Gateway. Already created:
   `headshot-studio` (`orange-bread-48156978`), with Managed Better Auth enabled on
   `main`. Link it:

   ```bash
   npx neon link
   ```

2. **Your secrets.** Copy `.env.example` to `.env`, then set `NEON_AUTH_COOKIE_SECRET`
   and `STRIPE_SECRET_KEY`.

3. **Provision everything in `neon.ts`.** This sets up Auth, AI Gateway, both buckets,
   both functions and both triggers, and writes the Neon variables into `.env`:

   ```bash
   npm run neon:plan
   npx neon deploy
   ```

4. **Stripe pipeline.** In the Stripe Dashboard, go to Data management → Pipelines →
   **Neon**. Authorize with OAuth, pick this project, and keep schema `stripe`. Enable at
   least `customers`, `charges`, `payment_intents`, `refunds` and `disputes`.

5. **Migrate.** The view needs the `stripe` tables, so the script checks for them first:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

6. **CORS** on the selfies bucket, so browsers can PUT to it:

   ```bash
   npm run storage:cors
   ```

7. **Run it:**

   ```bash
   npm run dev
   ```

   Buy a pack with card `4242 4242 4242 4242` and watch the credits arrive with no
   webhook. Then upload a selfie.

### Deploy to Vercel

- `vercel.json` pins functions to `cle1`.
- Add the Neon variables to the Vercel project. Vercel reserves the `AWS_*` names, so
  put the storage credentials in `NEON_STORAGE_ACCESS_KEY_ID`,
  `NEON_STORAGE_SECRET_ACCESS_KEY`, `NEON_STORAGE_ENDPOINT` and `NEON_STORAGE_REGION`.
  `src/env.ts` accepts either set.
- `APP_URL` falls back to the Vercel URLs when it isn't set.
- Allow the production origin on the bucket:

  ```bash
  APP_ORIGINS="https://your-app.vercel.app" npm run storage:cors
  ```

### Sign-in

One page, `/auth`, built on Neon UI's `AuthForm`:

- **Try the demo account** signs into one shared login. `DEMO_USERNAME` and `DEMO_PASSWORD`
  live only on the server, and the account is created on first use.
- **Create an account** asks for name, username and password. **Sign in** asks for
  username and password.

How usernames work:

- Neon Auth's email/password method requires an email, and the Better Auth username plugin
  isn't available on Neon.
- So `src/app/auth/actions.ts` maps each username to a placeholder address on a reserved,
  non-routable TLD (`<username>@users.headshot-studio.invalid`).
- Email verification is off on the branch, so nothing is ever sent there.
- Email/password is enabled on `main`. Magic links and OAuth aren't used.

## Debugging

The fun part: a branch copies the database, the files, the auth users and the synced
Stripe rows, so you can reproduce a customer's exact state. See
[docs/debugging.md](docs/debugging.md).
