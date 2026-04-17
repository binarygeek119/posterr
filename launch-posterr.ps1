$ErrorActionPreference = "Stop"

Write-Host "Configuring persistent Jellyfin sync environment variables..."
setx POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_LIMIT "60" | Out-Null
setx POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_FALLBACK_LIMIT "20" | Out-Null
setx POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_TIMEOUT_MS "45000" | Out-Null
setx POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT "150" | Out-Null
setx POSTERR_SYNC_DEBUG "true" | Out-Null

# Also set current-process values so this launch uses them immediately.
$env:POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_LIMIT = "60"
$env:POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_FALLBACK_LIMIT = "20"
$env:POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_TIMEOUT_MS = "45000"
$env:POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT = "150"
$env:POSTERR_SYNC_DEBUG = "true"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host "Starting Posterr from $repoRoot ..."
node ".\index.js"
