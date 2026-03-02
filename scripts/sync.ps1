<#
.SYNOPSIS
    Antigravity Memory Sync — Synchronization script.
.DESCRIPTION
    Auto-detects sync mode from config.json:
      - symlink: robocopy-based sync (for cloud drive app)
      - api: Google Drive REST API sync (no app needed)
.PARAMETER Direction
    'both' (default), 'import' (cloud→local), 'export' (local→cloud)
.PARAMETER Target
    Specific target to sync: 'brain', 'knowledge', 'skills', or 'all'
.PARAMETER DryRun
    Preview changes without applying.
.EXAMPLE
    .\sync.ps1                          # Bidirectional sync (all targets)
    .\sync.ps1 -Direction import        # Cloud → Local
    .\sync.ps1 -Direction export        # Local → Cloud
    .\sync.ps1 -Target skills -DryRun   # Sync skills only, preview
#>
param(
    [ValidateSet('both', 'import', 'export')]
    [string]$Direction = 'both',
    [ValidateSet('all', 'brain', 'knowledge', 'skills')]
    [string]$Target = 'all',
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "..\config.json"
$antigravityPath = Join-Path $env:USERPROFILE ".gemini\antigravity"

# --- Load Config ---
if (-not (Test-Path $configPath)) {
    Write-Host "❌ config.json not found. Run setup.ps1 first." -ForegroundColor Red
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$targets = if ($Target -eq 'all') { $config.sync_targets } else { @($Target) }
$syncMode = if ($config.sync_mode) { $config.sync_mode } elseif ($config.use_symlinks) { 'symlink' } else { 'manual' }

Write-Host "`n🔄 Antigravity Memory Sync" -ForegroundColor Cyan
Write-Host "   Mode: $syncMode | Direction: $Direction | Targets: $($targets -join ', ')" -ForegroundColor Gray

# =================================================================
# API MODE
# =================================================================
if ($syncMode -eq 'api') {
    . (Join-Path $scriptDir "gdrive-api.ps1")

    $gd = $config.google_drive
    if (-not $gd -or -not $gd.refresh_token) {
        Write-Host "❌ No refresh_token in config. Run: setup.ps1 -Mode api" -ForegroundColor Red
        exit 1
    }

    # Get access token
    Write-Host "`n  🔑 Refreshing access token..." -ForegroundColor Cyan
    $token = Get-GDriveToken -RefreshToken $gd.refresh_token
    Write-Host "  ✅ Token ready" -ForegroundColor Green

    $totalUp = 0; $totalDown = 0; $totalSkip = 0

    foreach ($t in $targets) {
        $localDir = Join-Path $antigravityPath $t
        $folderId = $gd.folder_ids.$t

        if (-not $folderId) {
            Write-Host "  ⚠️  No folder ID for '$t' — skipping" -ForegroundColor Yellow
            continue
        }
        if (-not (Test-Path $localDir)) {
            New-Item -ItemType Directory -Path $localDir -Force | Out-Null
        }

        Write-Host "`n  📂 $t/" -ForegroundColor White
        $result = Sync-GDriveFolder -Token $token -DriveFolderId $folderId `
            -LocalPath $localDir -Direction $Direction -DryRun:$DryRun -Recursive
        $totalUp += $result.Uploaded
        $totalDown += $result.Downloaded
        $totalSkip += $result.Skipped
    }

    # Update last_sync in config
    if (-not $DryRun) {
        $config.google_drive.last_sync = (Get-Date).ToUniversalTime().ToString('o')
        $config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding UTF8
    }

    Write-Host "`n$("=" * 50)" -ForegroundColor Cyan
    Write-Host "✅ Sync complete!" -ForegroundColor Green
    Write-Host "   ⬆️ Uploaded: $totalUp | ⬇️ Downloaded: $totalDown | ⏭️ Skipped: $totalSkip" -ForegroundColor White
    if ($DryRun) { Write-Host "   ⚠️  DRY RUN — no changes made." -ForegroundColor Yellow }
    exit 0
}

# =================================================================
# SYMLINK / MANUAL MODE
# =================================================================
if ($syncMode -eq 'symlink') {
    Write-Host "`n  ✅ Symlink mode — sync is automatic via cloud drive." -ForegroundColor Green
    Write-Host "   No manual sync needed." -ForegroundColor Gray
    exit 0
}

# Manual mode — robocopy
$syncRoot = Join-Path $config.cloud_drive_path $config.sync_folder_name

if (-not (Test-Path $syncRoot)) {
    Write-Host "❌ Sync folder not found: $syncRoot" -ForegroundColor Red
    exit 1
}

foreach ($t in $targets) {
    $localDir = Join-Path $antigravityPath $t
    $cloudDir = Join-Path $syncRoot $t
    Write-Host "`n  📂 $t" -ForegroundColor White

    $robocopyArgs = @('/E', '/XO', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS')
    if ($DryRun) { $robocopyArgs += '/L' }

    if ($Direction -eq 'export' -or $Direction -eq 'both') {
        Write-Host "    ⬆️ Local → Cloud" -ForegroundColor Cyan
        robocopy $localDir $cloudDir @robocopyArgs | Out-Null
    }
    if ($Direction -eq 'import' -or $Direction -eq 'both') {
        Write-Host "    ⬇️ Cloud → Local" -ForegroundColor Cyan
        robocopy $cloudDir $localDir @robocopyArgs | Out-Null
    }
}

Write-Host "`n✅ Sync complete!" -ForegroundColor Green
if ($DryRun) { Write-Host "   ⚠️  DRY RUN — no changes made." -ForegroundColor Yellow }
