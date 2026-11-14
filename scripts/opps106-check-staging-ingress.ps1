# OPPS-106 staging ingress check (Trinity / Windows PowerShell)
# No API key, password, passphrase, payment token or real transaction needed.
$ErrorActionPreference = 'Stop'
$uri = 'https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/opps106-staging-ingress-check'
$fake = '203.0.113.9'
Write-Host 'Testing Supabase staging gateway with a forged CF-Connecting-IP header...'
$raw = & curl.exe --silent --show-error --fail --max-time 15 --header "CF-Connecting-IP: $fake" "$uri"
if ($LASTEXITCODE -ne 0) { throw "HTTP probe failed: curl exited $LASTEXITCODE. No security conclusion is possible." }
$check = $raw | ConvertFrom-Json
$check | Format-List
if ($check.forged_header_survived) {
  Write-Warning 'UNSAFE: spoofed value reached the function. Never enable the PayFast source-gateway flag.'
  exit 2
}
if (-not $check.ingress_header_present) {
  Write-Warning 'INCONCLUSIVE: proxy did not supply cf-connecting-ip. Never enable the PayFast source-gateway flag.'
  exit 3
}
Write-Host 'PASS for this HTTP path: forged header was replaced with another value.'
Write-Warning 'This does not prove every possible ingress route is protected. Verify the full gateway contract.'
$required = @('sandbox_explicitly_enabled','merchant_id_configured','merchant_key_configured','passphrase_configured','trusted_return_origin_configured','source_gateway_flag_enabled','source_header_configured','sandbox_ip_allowlist_configured')
$missing = @($required | Where-Object { -not $check.$_ })
if ($missing.Count -gt 0) {
  Write-Warning ("Config not ready: " + ($missing -join ', '))
  exit 4
}
Write-Host 'Sandbox environment flags appear configured. This is NOT a successful PayFast payment test.'
