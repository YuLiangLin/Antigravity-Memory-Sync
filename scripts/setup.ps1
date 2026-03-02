<#
.SYNOPSIS
    Antigravity Memory Sync — First-time setup script.
.DESCRIPTION
    Sets up synchronization for Antigravity's brain, knowledge, and skills.
    Supports two modes:
      - symlink: Uses cloud drive app (Google Drive for Desktop, OneDrive, Dropbox)
      - api: Direct Google Drive REST API (no app install needed, OAuth2 browser login)
.PARAMETER Mode
    'symlink' (default) or 'api'
.PARAMETER CloudPath
    Path to cloud sync folder (symlink mode only).
.PARAMETER SyncFolderName
    Name of the sync folder. Default: "AntigravitySync"
.PARAMETER DryRun
    Preview all changes without applying.
.PARAMETER NoSymlinks
    Alias for -Mode manual (backward compat).
.EXAMPLE
    .\setup.ps1                              # Symlink mode (auto-detect)
    .\setup.ps1 -Mode api                    # API mode (browser OAuth2)
    .\setup.ps1 -CloudPath "G:\My Drive"     # Symlink mode with path
    .\setup.ps1 -Mode api -DryRun            # Preview API setup
#>
param(
    [ValidateSet('symlink', 'api', 'manual')]
    [string]$Mode = 'symlink',
    [string]$CloudPath,
    [string]$SyncFolderName = "AntigravitySync",
    [switch]$DryRun,
    [switch]$NoSymlinks
)

$ErrorActionPreference = "Stop"
if ($NoSymlinks) { $Mode = 'manual' }

# --- Helpers ---
function Write-Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Dry($msg) { Write-Host "  🧪 [DRY-RUN] $msg" -ForegroundColor Magenta }

# --- Paths ---
$antigravityPath = Join-Path $env:USERPROFILE ".gemini\antigravity"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "..\config.json"
$targets = @("brain", "knowledge", "skills")

if (-not (Test-Path $antigravityPath)) {
    Write-Host "❌ Antigravity directory not found at: $antigravityPath" -ForegroundColor Red
    exit 1
}
Write-Host "🔍 Antigravity found at: $antigravityPath" -ForegroundColor Green

# =================================================================
# API MODE
# =================================================================
if ($Mode -eq 'api') {
    Write-Step "Setting up Google Drive API mode..."

    # Load API module
    . (Join-Path $scriptDir "gdrive-api.ps1")

    # OAuth2 Authorization
    Write-Step "Google OAuth2 Authorization"
    if ($DryRun) {
        Write-Dry "Would open browser for Google authorization"
        Write-Dry "Would save refresh_token to config.json"
    }
    else {
        $tokenResp = Invoke-GDriveAuth
        $refreshToken = $tokenResp.refresh_token
        $accessToken = $tokenResp.access_token

        if (-not $refreshToken) {
            Write-Host "❌ No refresh_token received. Please try again." -ForegroundColor Red
            exit 1
        }
        Write-Ok "Authorized successfully"
    }

    # Create folder structure on Drive
    Write-Step "Creating folder structure on Google Drive..."
    if ($DryRun) {
        Write-Dry "Would create: AntigravitySync/"
        foreach ($t in $targets) { Write-Dry "Would create: AntigravitySync/$t/" }
    }
    else {
        $rootFolderId = Get-OrCreateFolder -Token $accessToken -PathParts @($SyncFolderName)
        Write-Ok "Root folder: $SyncFolderName (ID: $rootFolderId)"

        $folderIds = @{}
        foreach ($t in $targets) {
            $fid = Get-OrCreateFolder -Token $accessToken -ParentId $rootFolderId -PathParts @($t)
            $folderIds[$t] = $fid
            Write-Ok "  $t/ (ID: $fid)"
        }
    }

    # Save config
    Write-Step "Saving config..."
    $config = @{
        sync_mode        = 'api'
        sync_folder_name = $SyncFolderName
        sync_targets     = $targets
        google_drive     = @{
            refresh_token  = $refreshToken
            root_folder_id = $rootFolderId
            folder_ids     = $folderIds
            last_sync      = $null
        }
        skills_manifest  = @(
            (Get-ChildItem (Join-Path $antigravityPath "skills") -Directory -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name)
        )
    } | ConvertTo-Json -Depth 4

    if ($DryRun) {
        Write-Dry "Would write config to: $configPath"
    }
    else {
        Set-Content -Path $configPath -Value $config -Encoding UTF8
        Write-Ok "Config saved: $configPath"
    }

    # Initial export
    Write-Step "Initial upload (local → Google Drive)..."
    if ($DryRun) {
        Write-Dry "Would upload existing data to Google Drive"
    }
    else {
        foreach ($t in $targets) {
            $localDir = Join-Path $antigravityPath $t
            if (Test-Path $localDir) {
                Write-Host "  📂 $t/" -ForegroundColor Gray
                $result = Sync-GDriveFolder -Token $accessToken -DriveFolderId $folderIds[$t] `
                    -LocalPath $localDir -Direction export -Recursive
                Write-Ok "${t}: $($result.Uploaded) uploaded, $($result.Skipped) skipped"
            }
        }
    }

    # Summary
    Write-Host "`n$("=" * 50)" -ForegroundColor Cyan
    Write-Host "🎉 API mode setup complete!" -ForegroundColor Green
    Write-Host "   Mode: Google Drive API (direct, no app needed)" -ForegroundColor White
    Write-Host "   Sync: Run sync.ps1 to synchronize" -ForegroundColor White
    if ($DryRun) {
        Write-Host "`n   ⚠️  This was a DRY RUN. No changes were made." -ForegroundColor Yellow
    }
    exit 0
}

# =================================================================
# SYMLINK / MANUAL MODE (original behavior)
# =================================================================

function Find-CloudDrive {
    $candidates = @(
        (Join-Path $env:USERPROFILE "Google Drive"),
        "G:\My Drive",
        "G:\我的雲端硬碟",
        $env:OneDrive,
        (Join-Path $env:USERPROFILE "OneDrive"),
        (Join-Path $env:USERPROFILE "Dropbox")
    ) | Where-Object { $_ -and (Test-Path $_) }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return $null
}

if (-not $CloudPath) {
    Write-Step "Detecting cloud drive..."
    $CloudPath = Find-CloudDrive
    if ($CloudPath) {
        Write-Ok "Found: $CloudPath"
        $confirm = Read-Host "  Use this path? (Y/n)"
        if ($confirm -eq 'n') { $CloudPath = Read-Host "  Enter your cloud drive path" }
    }
    else {
        Write-Warn "No cloud drive detected."
        $CloudPath = Read-Host "  Enter your cloud drive path (e.g., G:\My Drive)"
    }
}

if (-not (Test-Path $CloudPath)) {
    Write-Host "❌ Cloud path not found: $CloudPath" -ForegroundColor Red
    exit 1
}

$syncRoot = Join-Path $CloudPath $SyncFolderName
Write-Host "☁️  Sync folder: $syncRoot" -ForegroundColor Cyan

# Create cloud folders
Write-Step "Creating cloud sync folders..."
foreach ($target in $targets) {
    $cloudTarget = Join-Path $syncRoot $target
    if (-not (Test-Path $cloudTarget)) {
        if ($DryRun) { Write-Dry "Would create: $cloudTarget" }
        else {
            New-Item -ItemType Directory -Path $cloudTarget -Force | Out-Null
            Write-Ok "Created: $cloudTarget"
        }
    }
    else { Write-Ok "Exists: $cloudTarget" }
}

# Backup & Link
Write-Step "Setting up synchronization..."
$useSymlinks = ($Mode -eq 'symlink')

foreach ($target in $targets) {
    $localPath = Join-Path $antigravityPath $target
    $cloudPath_ = Join-Path $syncRoot $target
    $backupPath = Join-Path $antigravityPath "${target}_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

    Write-Host "`n  📂 $target" -ForegroundColor White

    if ((Get-Item $localPath -ErrorAction SilentlyContinue).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Write-Ok "Already symlinked → $((Get-Item $localPath).Target)"
        continue
    }

    if ($useSymlinks) {
        if (Test-Path $localPath) {
            if ($DryRun) {
                Write-Dry "Would copy → cloud, backup, create symlink"
            }
            else {
                robocopy $localPath $cloudPath_ /E /XO /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
                Rename-Item -Path $localPath -NewName (Split-Path $backupPath -Leaf)
                Write-Ok "Backup: $backupPath"
                New-Item -ItemType SymbolicLink -Path $localPath -Target $cloudPath_ | Out-Null
                Write-Ok "Symlink: $localPath → $cloudPath_"
            }
        }
        else {
            if ($DryRun) { Write-Dry "Would create symlink" }
            else {
                New-Item -ItemType SymbolicLink -Path $localPath -Target $cloudPath_ | Out-Null
                Write-Ok "Symlink: $localPath → $cloudPath_"
            }
        }
    }
    else { Write-Ok "Manual sync mode — use sync.ps1" }
}

# Save config
Write-Step "Saving config..."
$config = @{
    sync_mode        = $Mode
    cloud_drive_path = $CloudPath
    sync_folder_name = $SyncFolderName
    sync_targets     = $targets
    use_symlinks     = $useSymlinks
    skills_manifest  = @(
        (Get-ChildItem (Join-Path $antigravityPath "skills") -Directory -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Name)
    )
} | ConvertTo-Json -Depth 3

if ($DryRun) { Write-Dry "Would write config" }
else {
    Set-Content -Path $configPath -Value $config -Encoding UTF8
    Write-Ok "Config saved: $configPath"
}

# Summary
Write-Host "`n$("=" * 50)" -ForegroundColor Cyan
Write-Host "🎉 Setup complete!" -ForegroundColor Green
Write-Host "   Mode: $(if ($useSymlinks) {'Symlink (auto)'} else {'Manual (sync.ps1)'})" -ForegroundColor White
Write-Host "   Cloud: $syncRoot" -ForegroundColor White
if ($DryRun) { Write-Host "`n   ⚠️  DRY RUN — no changes made." -ForegroundColor Yellow }
