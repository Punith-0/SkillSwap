$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$adminUser = Read-Host 'MySQL administrator username (Enter for root)'
if (-not $adminUser) { $adminUser = 'root' }
$securePassword = Read-Host 'MySQL administrator password (hidden)' -AsSecureString
$credential = [System.Net.NetworkCredential]::new($adminUser, $securePassword)
try {
    @{ user = $adminUser; password = $credential.Password } | ConvertTo-Json -Compress | & node scripts/setup-local.js
    if ($LASTEXITCODE -eq 0) { & node scripts/migrate.js }
} finally { $credential = $null; $securePassword = $null }
Read-Host 'Press Enter to close'
