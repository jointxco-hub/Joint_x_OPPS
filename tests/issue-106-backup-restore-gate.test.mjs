import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const backup=readFileSync('scripts/opps106-backup-production-trinity.ps1','utf8');
const inv=readFileSync('scripts/opps106-production-restore-inventory.sql','utf8');
const guide=readFileSync('docs/OPPS106_PRODUCTION_BACKUP_RESTORE_GATE_20261120.md','utf8');

test('production backup command is opt-in and hard-binds production',()=>{
 assert.match(backup,/ConfirmProductionReadOnlyDump/);
 assert.match(backup,/PRODUCTION_PROJECT_REFERENCE_MISMATCH/);
 assert.match(backup,/slhcvyeuqsduaglddqdb/);
 assert.match(backup,/PGSSLMODE/);
 assert.match(backup,/\bpg_dump --format=custom --no-password/);
 assert.match(backup,/\bpg_restore --list/);
 assert.match(backup,/Get-FileHash.*SHA256/);
 assert.doesNotMatch(backup,/--dbname=\$connection|ProductionConnectionEnvironmentVariable/);
 assert.doesNotMatch(backup,/\b(pg_restore .*--dbname|psql .* -f |DROP DATABASE|DELETE FROM|CREATE DATABASE)\b/i);
});
test('inventory is read-only and inspects RLS/trigger/function drift',()=>{
 assert.match(inv,/pg_trigger/);
 assert.match(inv,/pg_policies/);
 assert.match(inv,/schema_migrations/);
 assert.match(inv,/pg_get_functiondef/);
 assert.match(inv,/qr_schema_present/);
 assert.doesNotMatch(inv,/^\s*(insert|delete|update|alter|drop|create|truncate|grant|revoke|call|do)\s/im);
});
test('release guide preserves no-go status for missing restore and costs',()=>{
 assert.match(guide,/NOT RUN/);
 assert.match(guide,/network-isolated/);
 assert.match(guide,/cost.*not yet confirmed/i);
 assert.match(guide,/not.*full restore/i);
 assert.match(guide,/No production change or live QR activation authorized/);
});
