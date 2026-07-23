# Fast production database deployment script - CLEAN VERSION
# Deletes database first for completely fresh start
# Run from server folder: ./deploy-production-clean.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulePath = $scriptDir
$outDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\client\src\generated"))
$authIssuerUrl = if ($env:AUTH_ISSUER_URL) { $env:AUTH_ISSUER_URL } else { $env:ISSUER_URL }
if (-not $authIssuerUrl) {
  throw "[SECURITY] Set AUTH_ISSUER_URL (or ISSUER_URL) to the production HTTPS auth issuer before publishing."
}
$parsedIssuer = $null
if (-not [Uri]::TryCreate($authIssuerUrl, [UriKind]::Absolute, [ref]$parsedIssuer) -or $parsedIssuer.Scheme -ne "https") {
  throw "[SECURITY] AUTH_ISSUER_URL must be an absolute HTTPS URL."
}
$env:AUTH_ISSUER_URL = $authIssuerUrl.TrimEnd("/")
$env:AUTH_CLIENT_ID = if ($env:AUTH_CLIENT_ID) { $env:AUTH_CLIENT_ID } else { "vibe-survival-game-client" }
if ($env:CONFIRM_PRODUCTION_RESET -ne "spacetimedb-auth-demo") {
  throw "[SAFETY] Set CONFIRM_PRODUCTION_RESET=spacetimedb-auth-demo to confirm the destructive production reset."
}

function Assert-LastExit([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "[ERROR] $stepName failed with exit code $LASTEXITCODE."
  }
}

# Run from server directory so -p . resolves correctly
Set-Location $modulePath

Write-Host "[DELETE] Deleting production database first..." -ForegroundColor Red
$deleteProc = Start-Process -FilePath "spacetime" -ArgumentList "delete","--no-config","--server","maincloud","spacetimedb-auth-demo","-y" -Wait -NoNewWindow -PassThru
if ($deleteProc.ExitCode -ne 0) {
  Write-Host "[DELETE] Database not found (404) or already gone - continuing with fresh publish." -ForegroundColor DarkYellow
}

Write-Host "[BUILD] Building and deploying to fresh production database..." -ForegroundColor Yellow
spacetime publish --no-config --server maincloud -p . spacetimedb-auth-demo -y
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Publish failed. Ensure you are logged in: spacetime login" -ForegroundColor Red
  Write-Host "[ERROR] If this DB does not exist in your account, create it once in the SpacetimeDB dashboard." -ForegroundColor Red
  exit 1
}

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --no-config -p . -l typescript -o "$outDir" -y
Assert-LastExit "Generate TypeScript bindings"

Write-Host "[SUCCESS] Clean production deployment complete!" -ForegroundColor Green
Write-Host "[DB] Database: spacetimedb-auth-demo on maincloud" -ForegroundColor Cyan
Write-Host "[CLEAN] Production database was completely wiped and recreated" -ForegroundColor Magenta
Write-Host "[INFO] Review and commit regenerated bindings separately; this script never changes Git state." -ForegroundColor Blue
