#requires -Version 5.1
<#
.OPPS-106
  Controlled production database backup on the operator's own workstation.
  NEVER commit, upload to GitHub, or share the backup through chat.
  A current backup is not the same thing as a tested restore.
  Run only on a trusted workstation with PostgreSQL 17 client tools.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DestinationDirectory,
  [switch]$ConfirmProductionReadOnlyDump
)
$ErrorActionPreference='Stop'
if(-not $ConfirmProductionReadOnlyDump) { throw 'Explicit -ConfirmProductionReadOnlyDump is required.' }
# Never pass credentials via a connection-string CLI argument (process-list leak).
# Set PGHOST, PGUSER, PGPORT, PGDATABASE, PGSSLMODE and PGPASSWORD
# from a trusted local credential source in this current process only.
foreach($key in @('PGHOST','PGUSER','PGPORT','PGDATABASE','PGSSLMODE','PGPASSWORD')) {
  if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key,'Process'))) {
    throw "Missing private PostgreSQL environment variable: $key"
  }
}
if($env:PGHOST -notmatch '^(db\.slhcvyeuqsduaglddqdb\.supabase\.co|[a-z0-9.-]*pooler\.supabase\.com)$'
  -or ($env:PGHOST -match 'pooler' -and $env:PGUSER -notmatch 'slhcvyeuqsduaglddqdb')) {
  throw 'PRODUCTION_PROJECT_REFERENCE_MISMATCH'
}
if($env:PGSSLMODE -notin @('require','verify-ca','verify-full')) { throw 'TLS_REQUIRED' }
if($env:PGDATABASE -ne 'postgres') { throw 'EXPECTED_POSTGRES_DB' }
foreach($app in @('pg_dump','pg_restore')) {
  if(-not (Get-Command $app -ErrorAction SilentlyContinue)) {
    throw "Missing PostgreSQL client command $app"
  }
}
$dir=[IO.Path]::GetFullPath($DestinationDirectory)
if($dir -match '(?i)(github|joint_x_opps|onedrive|dropbox|google drive|\\public\\)') {
  throw 'Backup destination appears to be a repo or synced/public location. Use a private encrypted drive.'
}
if(-not (Test-Path -LiteralPath $dir)) {
  [void](New-Item -ItemType Directory -Path $dir -Force)
}
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$file=Join-Path $dir "opps106_prod_$stamp.dump"
$manifest=Join-Path $dir "opps106_prod_$stamp.manifest.txt"
# -Fc provides a searchable archive with table data and schema. Database
# roles/globals and Storage objects are separate and are not included.
& pg_dump --format=custom --no-password --file=$file
if($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue; throw 'pg_dump failed' }
& pg_restore --list $file | Out-Null
if($LASTEXITCODE -ne 0) { throw 'Archive failed pg_restore --list validation' }
$bytes=(Get-Item -LiteralPath $file).Length
if($bytes -lt 10240) { throw 'Backup file unexpectedly small' }
$hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
@(
 'OPPS-106 production backup (not a restore verification)'
 "UTC=$stamp",
 'SourceProjectRef=slhcvyeuqsduaglddqdb',
 "ArchiveBytes=$bytes",
 "SHA256=$hash",
 'Includes=pg_dump custom-format database contents only',
 'Excludes=Storage object bytes, external credentials, global DB roles',
 'RestoreStatus=NOT_TESTED',
 'ReleaseAuthorization=NO'
) | Set-Content -LiteralPath $manifest -Encoding UTF8
Write-Host "Backup created; checksum manifest: $manifest"
Write-Host 'Store the dump encrypted, then rehearse a restore in a separate isolated database.'
