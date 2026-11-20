# OPPS-106 — Independent production backup and restore gate

**Prepared: 20 November 2026. Status: BACKUP NOT TAKEN / RESTORE NOT TESTED.**
Do not enable live payments or apply production migrations based on this runbook alone.

## 1. Current production facts, read-only
- Project: `slhcvyeuqsduaglddqdb` (EU-West-2, PostgreSQL 17.6).
- On 20 November, production had **202** tables in `public,commerce,auth,storage`, **140** non-internal triggers, **420** `public/commerce` functions and **382** RLS policies in `public,commerce,storage`.
- The QR private schema is absent, no live QR settlement RPC exists and 0 named OPPS-106 migrations are recorded.
- Reproduce and compare these counts and the key finance hashes with `scripts/opps106-production-restore-inventory.sql`. Counts may change as the live system evolves; record timestamp and explain discrepancies rather than applying changes blindly.

## 2. Do not confuse a branch with a production backup
- Supabase development branches start from migrations and do **not** include production data. Branch creation may incur additional usage charges, and the exact organisation-specific price is **not yet confirmed or approved**.
- Supabase's *Restore to a New Project* can copy a database backup including existing database data/roles (if the project's backup and plan qualify), but **may create a billable project** and may also bring along secrets or scheduled jobs. It is **not safe to use such a clone directly** for live payment or messaging tests. The connector in this session has no backup download/restore action, so no hosted backup restoration was performed.
- Read the official Supabase documents: [Database Backups](https://supabase.com/docs/guides/platform/backups), [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
- No backup, source database or existing hosted credentials must be pasted into ChatGPT, committed to GitHub, or uploaded to a public storage provider.

## 3. Trinity backup procedure (operator-assisted; NOT RUN)
Use a trusted Windows 11 workstation (Trinity) with PostgreSQL **17** client tools `pg_dump` and `pg_restore`. Ensure adequate free disk space and use an **encrypted, non-synced** destination. Do not use the older 31 Oct backup as if it were current.

In a local PowerShell process, configure the standard PostgreSQL environment variables **privately** from your existing secure credential store:
`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE=postgres`, `PGSSLMODE=require` (or stricter), and `PGPASSWORD`. Verify host/user belong to the correct production project. Avoid passing a password-containing URI as a command-line argument.

With those variables configured locally, run:
```powershell
.\scripts\opps106-backup-production-trinity.ps1 -DestinationDirectory 'D:\PrivateEncryptedJointXBackups' -ConfirmProductionReadOnlyDump
```
The script is **read-only to production**: `pg_dump -Fc` creates the local archive, `pg_restore --list` validates readability, then a companion SHA-256 file records the byte count, UTC time and source project identifier. The archive **does not include Storage object bytes**, external secrets or global PostgreSQL role definitions. Do not print/commit the dump. Clear temporary credential environment variables when finished.

Do not claim backup success until the script reports success, archive/hash are recorded, encrypted offline copy is verified, and `pg_restore` has restored the data into an isolated target.

## 4. Isolated restore and test requirements
- Prefer a **network-isolated local PostgreSQL/Supabase development environment** or a strictly segregated hosting project with approved cost and independent credentials. A backup containing real auth tokens, customer details, database webhooks or scheduled tasks must be treated as sensitive.
- Do **not** expose the restored database to the public internet or give it production service/API keys. Disable outbound HTTP/email/WhatsApp/PayFast callbacks, foreign data wrappers, cron jobs and webhooks before allowing the restore to run unattended. A cloned database can otherwise execute scheduled jobs unexpectedly.
- If network-exposed extensions, Vault, storage and Auth features are necessary, reproduce only what is needed and use **synthetic test accounts**. Production data must not be used for destructive payment acceptance tests.
- Import roles/extensions and run `pg_restore` using the current Supabase/PostgreSQL restore guide appropriate to the backup format; confirm that permissions, RLS, security-definer functions, constraints and extensions are present. A `--no-acl` restore cannot by itself prove RLS/GRANT parity.
- Run `scripts/opps106-production-restore-inventory.sql` **before** migration on the isolated restore and compare its results against production; mark any mismatch.
- Apply review-only migrations **A → B1 → B2 foundation → live gateway SQL (policy OFF) → B3**, transactionally as appropriate, with current function MD5 guards and verified approvals. Do not insert data from staging.
- Confirm both `qr_payments.issuance_controls` switches OFF and `qr_payments.live_gateway_policy` OFF after each step. For sandbox or live callback tests, use simulated ITNs unless an explicitly approved controlled payment test has its own procedures.
- Execute regression cases: Café Counter cash/card, invoice→order→payment, duplicate and late ITN, wrong merchant and amount, unmatched capture quarantine, cross-tenant access, staff permissions, OPPS linked order, Finance test exclusion, review flags, and unrelated existing invoices.
- Retain the sanitized CI report, restore timestamp, hash verification evidence, detected schema drift and sign-off as restricted release evidence.

## 5. Mandatory stop conditions
No live activation if the backup is unverified, restore differs materially, a trigger runs externally, permissions widen, production function hashes change, Finance creates duplicate revenue, live QR classification is ambiguous, or pending PayFast callbacks cannot be reconciled. Closing new QR issuance must **not** silence already-opened verified provider notifications.

## 6. Current evidence and remaining decision
The data-free PostgreSQL rehearsal **passed all four GitHub jobs** in run #44753334301, but only synthetic tables and pinned production function definitions were used. That is **not** a full restore.

**Still required:** create and verify a *fresh* backup on Trinity; establish a network-isolated restore target; compare the restored full schema and restore output; then perform release regression and sign-off. Hosted branch/project spend needs cost confirmation before provisioning. **No production change or live QR activation authorized.**
