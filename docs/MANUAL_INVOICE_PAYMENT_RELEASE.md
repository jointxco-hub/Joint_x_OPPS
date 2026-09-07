# Manual Invoice Payment — Release Manifest

Feature: canonical manual (off-platform / EFT / cash / card) invoice-payment
ledger for OPPS, plus private proof-of-payment attachments and a payment-history
UI in the invoice drawer.

Release branch: `release/manual-invoice-payment`
Base: `main` @ `c36c7a7` (PR #62)

---

## 1. Production migration allowlist (exact, ordered)

Apply **only** these three files, **in this order**, to production
(`slhcvyeuqsduaglddqdb`). Each file is a single `begin; … commit;` transaction
with its own preflight guard.

| # | File | What it adds | Idempotent re-run |
|---|------|--------------|-------------------|
| 1 | `supabase/migrations/20260907120000_record_manual_invoice_payment.sql` | `invoice_payments_manual_ref_once` partial unique index; `public.record_manual_invoice_payment(uuid,numeric,text,timestamptz,text,text)` (6-arg) | yes (`create index if not exists`, `create or replace function`) |
| 2 | `supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql` | `invoice_payments.client_operation_key` + `invoice_payments_manual_opkey_once`; `public.payment_attachments` table + `_payment_attachments_immutable` trigger + RLS (SELECT-only, finance+tenant); supersedes the RPC with the **7-arg** `record_manual_invoice_payment(…, p_operation_key text)`; `stage_payment_proof`, `attach_payment_proof`, `supersede_payment_attachment`, `remove_staged_payment_proof`, `cleanup_abandoned_payment_proof` + internal `_link_staged_payment_attachments`, `_assert_manual_payment_matches` | yes (`add column if not exists`, `create table if not exists`, `create or replace`) |
| 3 | `supabase/migrations/20260907140000_payment_proof_storage_hardening.sql` | revoke anon/`public` SELECT on `payment_attachments`; `public._payment_proof_object_locked(text,text)`; two **RESTRICTIVE** `storage.objects` policies (`payment_proof_object_locked_delete`, `_update`) that make a `linked`/`superseded` proof object immutable through the Storage API | yes (`drop policy if exists` + `create policy`, `create or replace function`) |

**Do NOT apply** `20260907150000_staging_storage_perimeter_alignment.sql` — it is
staging-only and is **not in this branch** (see §4).

**Do NOT `supabase db push`.** Push would also sweep any other pending repo
migration and (on a checkout that still carries it) the staging-only file. Apply
the three files explicitly, one at a time, then record each with
`supabase migration repair --status applied <version>` (bookkeeping row for SQL
that genuinely ran — never for SQL that did not).

### Preflight dependency check (must pass before #1)

`20260907120000` hard-aborts unless **all** of these already exist in production
(verified present on `slhcvyeuqsduaglddqdb`, 2026-09-07):

* `public.invoice_payments` (P1A ledger) + `trg_invoice_payments_refresh_cache` + `trg_invoice_payments_set_tenant`
* `public.invoice_amount_paid(uuid)`, `invoice_balance_due(uuid)`, `invoice_payment_status(uuid)`, `_invoice_payment_projection(uuid)`
* `public.opps_invoice_activity`
* `public.orders`, `public.xlab_orders`, `public.xlab_payments` (the order/payment bridge — the cross-source safeguard fails **closed** without it)
* `invoice_payments.source` CHECK already allows `'manual'` (it does: `('manual','payfast','order_sync')`)

`20260907130000` additionally needs `public.private_upload_path_tenant_id(text)`,
`is_opps_staff()`, `user_finance_level()`, `can_access_tenant(uuid)`,
`is_app_admin()`, `public.tenants`, and `storage.objects` — all present.

---

## 2. Source-history drift (P1A / P3 / P6) — READ BEFORE RELEASE

Production runs the entire invoice payment-ledger foundation live:

* `invoice_payments` table + `trg_invoice_payments_refresh_cache` (P1A cache) + `trg_invoice_payments_set_tenant`
* `invoice_amount_paid` / `invoice_balance_due` / `invoice_payment_status` / `_invoice_payment_projection` / `get_invoice_payment_summary` / `invoice_is_overdue`
* `invoice_payments_payfast_ref_once` (P6), `invoice_payments_xlab_fold_once` (P3 order-sync fold)
* a ledger-reading `_public_invoice_projection` behind `get_public_invoice` / `get_public_invoice_by_email`

**None of this has a migration file in the repo and none has a
`schema_migrations` row.** Production migration history stops at
`20260831150000`; a query for `202609%` / `20260904%` versions and for any
`%p1a%`, `%p3%`, `%p6%`, `%payment_ledger%`, `%invoice_payment%` migration name
returns nothing.

Consequences:

* This release is **safe on production today** — every dependency is live.
* A database **rebuilt from repo migrations alone cannot apply this release** —
  `20260907120000`'s preflight raises `MANUAL_PAYMENT: public.invoice_payments
  (P1A) is not present`.
* This is a disaster-recovery / environment-parity gap, tracked alongside
  `docs/SHARED_SUPABASE_MIGRATION_RECONCILIATION_2026-09-01.md`.

**Action (separate, separately-reviewed PR — not this one):** backfill the actual
P1A/P3/P6 DDL as migration files with versions `< 20260907120000`, then
`supabase migration repair --status applied <each>` on every environment where
that schema already exists. Do **not** delete or rewrite existing
`schema_migrations` rows to do this.

---

## 3. Database-before-frontend requirement

The new frontend bundle **must not go live before migrations #1–#3 are applied
and verified**. It:

* calls `supabase.rpc("record_manual_invoice_payment", { …, p_operation_key })` — the 7-arg overload (migration #2)
* calls `stage_payment_proof` / `attach_payment_proof` / `supersede_payment_attachment` / `remove_staged_payment_proof` / `cleanup_abandoned_payment_proof` (migration #2)
* `SELECT`s `invoice_payments.client_operation_key` and reads `public.payment_attachments` in `listInvoicePaymentsWithProof` (migration #2) — these 400 against a DB without #2

`get_invoice_payment_summary` is already in production, so the read-only summary
path degrades gracefully, but the write path and the history list do not.

`buildPublicInvoiceUrl` (commit `aca1bcd`) is production-safe: production leaves
`VITE_PUBLIC_INVOICE_BASE_URL` **unset**, so the share URL falls back to the
hardcoded `https://xlab.jointx.co.za/i` — byte-identical to today. The override
is only ever set in a local `.env.local` for staging work.

---

## 4. Staging-only migration isolation & go-forward convention

`20260907150000_staging_storage_perimeter_alignment.sql` brings staging's
`phd_staging_*` bring-up storage policies in line with the canonical production
perimeter (`202606270001` + `20260817173003`). Production **already has** that
perimeter, so the migration is meaningless there — and worse, its preflight
would *pass* on production (it keys on `private_uploads_insert_by_tenant`, which
production has) and it would needlessly drop/recreate nine live storage policies.

**Isolation approach used here:**

* The staging file and its two test artifacts live **only** on branch
  `feat/manual-invoice-payment-ledger` (commits `921d0b7`, `40542ee`). That
  branch is **not merged** and is **not** the base of this PR.
* This release branch (`release/manual-invoice-payment`) is `main` + the nine
  production feature commits (`238cb3b … aca1bcd`) — it has **never contained**
  `20260907150000`. Nothing was moved, squashed, or history-rewritten.
* Staging's `schema_migrations` already has the
  `20260907150000 staging_storage_perimeter_alignment` row (applied 2026-09-07,
  verified against the exact file). That row is **left untouched** — not
  deleted, not marked, not rewritten.
* We do **not** run `migration repair --status applied 20260907150000` on
  production — that would falsely record SQL that never ran there.

**Go-forward rule (add to CONTRIBUTING / migration runbook):**

1. `supabase/migrations/*.sql` is the **production** history. Every file here is
   expected to reach production, in filename order, and staging gets the same
   set. `supabase db push` / `migration up` operate on this directory only.
2. A migration that must run on **staging but never production** goes in
   `supabase/migrations-staging/` (sibling directory — the CLI does not read
   it). Apply it to staging explicitly by path
   (`supabase db query --linked -f supabase/migrations-staging/<file>`), then it
   shows in staging's `schema_migrations` as a remote-only row. `supabase
   migration list` against staging will list it under "remote" with no local
   match in `supabase/migrations/` — that is expected and benign for a
   deliberately-isolated migration.
3. After this release merges, a follow-up chore PR should relocate
   `20260907150000_staging_storage_perimeter_alignment.sql` from the
   `feat/manual-invoice-payment-ledger` branch into `supabase/migrations-staging/`
   on `main` for discoverability, with its README. Staging history is preserved
   because the file content and its `schema_migrations` row are unchanged — only
   the repo path changes.
4. Production migration rollouts always follow an **explicit allowlist** (this
   document's §1), never an unfiltered `db push`.

---

## 5. Test results (release branch)

| Suite | Result |
|-------|--------|
| Focused static (`record-manual-invoice-payment`, `manual-payment-operation-key-and-proof`, `payment-proof-ui`, `invoice-public-share-ui`) | pass |
| Full static suite (`node --test tests/*.test.mjs`) | 1085 pass / 0 fail (release branch; the 5 staging-perimeter static tests live on `feat/manual-invoice-payment-ledger`) |
| Production build (`vite build`) | exit 0 |
| `supabase/tests/record_manual_invoice_payment_run.sh` (fresh `postgres:16`) | PASS — 23 assertions |
| `supabase/tests/payment_operation_key_and_proof_run.sh` | PASS — 24 assertions |
| `supabase/tests/payment_proof_storage_hardening_run.sh` | PASS — 6 assertions |

Pre-existing, **not** introduced by this branch (verified identical on `main`):
`npm run check:xos-boundary` exits 1; `tsc -p jsconfig.json` prints ~14 errors
in `src/pages/xos/*` and `src/utils/archiveEntity.js`. None touch payment code.

---

## 6. User-accepted staging browser tests

Accepted with the user against staging (`tijiamrfnxrbitafiflj`), invoice
OPPS-INV-2026-0002 and disposable invoices:

* record a manual EFT with an **optional** bank reference (blank allowed)
* record a **partial** payment, then settle the remainder to `paid`
* proof-of-payment: upload during the modal, add to an already-recorded payment, retire a linked proof with a mandatory reason (retired proof stays visible, struck through)
* blocked-request **retry**: same operation key replays with no second ledger row and no duplicate proof
* public invoice `/i/:token` refreshes to Paid / R0 / no Pay button after settlement

### Remaining production checks (non-financial only — see §7)

* schema/permission verification after each migration (§7 step 4)
* invoice list + drawer render for an existing approved invoice
* `get_invoice_payment_summary` + `get_public_invoice` read correctly for an existing invoice
* **No production smoke *payment*** without explicit finance authorization.

---

## 7. Deployment sequence (execute only on release approval)

> Runs against production `slhcvyeuqsduaglddqdb`. Read-only preflight first.
> `supabase link --project-ref slhcvyeuqsduaglddqdb` for the session; `supabase
> unlink` after.

1. **Preflight (read-only).** Run `docs`-tracked preflight query (or equivalent):
   confirm §1 dependency list present; confirm `record_manual_invoice_payment`,
   `payment_attachments`, `client_operation_key`, `invoice_payments_manual_ref_once`,
   `invoice_payments_manual_opkey_once`, `payment_proof_object_locked_*` are
   **absent**; capture `schema_migrations` head; snapshot OPPS-INV-2026-0085.

2. **Apply migration #1.**
   `supabase db query --linked -f supabase/migrations/20260907120000_record_manual_invoice_payment.sql`
   then `supabase migration repair --status applied 20260907120000 --linked`.

3. **Apply migration #2.**
   `supabase db query --linked -f supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql`
   then `supabase migration repair --status applied 20260907130000 --linked`.

4. **Apply migration #3.**
   `supabase db query --linked -f supabase/migrations/20260907140000_payment_proof_storage_hardening.sql`
   then `supabase migration repair --status applied 20260907140000 --linked`.

5. **Post-migration verification (read-only, non-financial).**
   * `record_manual_invoice_payment` has the 7-arg signature, `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` only.
   * `payment_attachments` exists; RLS enabled; `authenticated` has `SELECT` only; `anon`/`public` have nothing; `_payment_attachments_immutable` trigger present `BEFORE INSERT OR UPDATE OR DELETE`.
   * `invoice_payments.client_operation_key` column present; both `invoice_payments_manual_ref_once` and `invoice_payments_manual_opkey_once` partial unique indexes present.
   * `storage.objects` has RESTRICTIVE `payment_proof_object_locked_delete` and `payment_proof_object_locked_update`; `uploads` bucket still `public = false`; the nine canonical perimeter policies unchanged.
   * `schema_migrations` now has rows `20260907120000`, `20260907130000`, `20260907140000` and **no** `20260907150000`.
   * an existing approved invoice still renders in the drawer; `get_invoice_payment_summary(<existing id>)` and `get_public_invoice(<existing token>)` return correctly.
   * OPPS-INV-2026-0085 unchanged vs the step-1 snapshot.

6. **Deploy frontend.** Ship the `release/manual-invoice-payment` build with
   `VITE_PUBLIC_INVOICE_BASE_URL` **unset**. Confirm the Invoices page loads and
   the payment modal opens.

7. **Optional non-financial smoke.** Open the payment modal on a test/disposable
   approved invoice, confirm it reads the ledger-derived outstanding balance and
   validates input — **do not submit** without finance authorization.

8. `supabase unlink`.

### OPPS-INV-2026-0085 (kept separate)

Real R1715 EFT, UUID `a915d032-04ca-4171-bb13-d5f98ad8b210`, order-linked
`ORD-MTPLF2DP`. Status `paid` via a legacy direct write; canonical ledger empty
(`invoice_amount_paid()=0`), so the customer public view shows R1715
outstanding. There is currently **no `xlab_payments` row** on the linked order,
so it is a genuine off-platform EFT with nothing to double-count.

Reconcile **only after** this release is deployed, as a **separate** one-row
action, with: migrations #1–#2 live; a **verified bank reference and value
date**; confirmation the R1715 is not already on another invoice
(`select … from invoice_payments where reference = '<ref>'` → 0 rows) and not a
completed platform payment on the linked order (re-check `xlab_payments`); one
fresh operation key recorded for retry-safety. Then a single
`record_manual_invoice_payment(0085, 1715.00, '<ref>', '<date>', 'eft', '<note>',
'<opkey>')`. Invoice `status` stays `paid` (the compat mirror only advances from
approved/partially_paid/overdue). Do not hand-edit status; do not initiate
PayFast; the linked `xlab_orders` row being `pending_payment` is an X LAB-side
matter, out of scope here.

---

## 8. Rollback

Frontend: redeploy the previous bundle. The old build calls no manual-payment
RPCs, so it is unaffected by the migrations being present.

Migrations (only if a defect is found before real payments exist):

```sql
begin;
-- #3
drop policy if exists payment_proof_object_locked_update on storage.objects;
drop policy if exists payment_proof_object_locked_delete on storage.objects;
drop function if exists public._payment_proof_object_locked(text, text);
-- #2  (safe only while public.payment_attachments has 0 rows)
drop function if exists public.supersede_payment_attachment(uuid, text);
drop function if exists public.attach_payment_proof(uuid, text, text, text, bigint);
drop function if exists public.cleanup_abandoned_payment_proof(text, integer);
drop function if exists public.remove_staged_payment_proof(uuid);
drop function if exists public.stage_payment_proof(uuid, text, text, text, text, bigint);
drop function if exists public._assert_manual_payment_matches(public.invoice_payments, numeric, timestamptz, text, text, text);
drop function if exists public._link_staged_payment_attachments(uuid, text, uuid, uuid);
drop function if exists public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text);
drop table if exists public.payment_attachments;
drop index if exists public.invoice_payments_manual_opkey_once;
alter table public.invoice_payments drop column if exists client_operation_key;
-- #1
drop function if exists public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text);
drop index if exists public.invoice_payments_manual_ref_once;
commit;
```

Then `supabase migration repair --status reverted 20260907140000 20260907130000 20260907120000 --linked`.

**Once any real `invoice_payments` row with `source='manual'` exists, do not drop
`record_manual_invoice_payment` or `payment_attachments`** — forward-fix instead.
The ledger rows themselves are financial records; a `payment_attachments` row is
never destructive to money but the proof evidence should be preserved.

---

## 9. Release blockers

1. **Deployment discipline** — this release must be applied by the §1 allowlist,
   not `db push`. (Mitigated: `20260907150000` is not in this branch.)
2. **Database before frontend** (§3) — hard ordering requirement.
3. **P1A/P3/P6 drift** (§2) — not a blocker for *this* production deploy, but
   blocks fresh-environment provisioning and should get its own reconciliation
   PR.
4. **Pre-existing repo hygiene** (§5) — `check:xos-boundary` / `tsc` failures on
   `main`; disclose, do not fix here.
5. **Production browser acceptance** of the payment write path is pending finance
   authorization for a smoke payment (§6/§7). Staging browser acceptance is
   done.
