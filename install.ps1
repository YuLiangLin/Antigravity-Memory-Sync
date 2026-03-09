<#
.SYNOPSIS
    Install antigravity-memory-sync as an Antigravity Skill + Workflows.
.DESCRIPTION
    Installs:
      1. Skill    → ~/.gemini/antigravity/skills/memory-sync/
      2. Scripts  → ~/.gemini/antigravity/skills/memory-sync/scripts/
      3. Workflows → current project's .agents/workflows/ (optional)
.PARAMETER WorkflowTarget
    Path to install workflows. Default: current directory's .agents/workflows/
    Use -NoWorkflows to skip workflow installation.
.PARAMETER NoWorkflows
    Skip workflow installation.
.PARAMETER Uninstall
    Remove the installed skill.
.EXAMPLE
    .\install.ps1
    .\install.ps1 -WorkflowTarget "D:\MyProject\.agents\workflows"
    .\install.ps1 -NoWorkflows
    .\install.ps1 -Uninstall
#>
param(
    [string]$WorkflowTarget,
    [switch]$NoWorkflows,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDest = Join-Path $env:USERPROFILE ".gemini\antigravity\skills\memory-sync"

function Write-Ok($msg) { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  📂 $msg" -ForegroundColor Cyan }

# ─── Uninstall ────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host "`n🗑️  Uninstalling memory-sync skill..." -ForegroundColor Yellow
    if (Test-Path $skillDest) {
        Remove-Item -Recurse -Force $skillDest
        Write-Ok "Removed: $skillDest"
    }
    else {
        Write-Host "  Not installed." -ForegroundColor Gray
    }
    exit 0
}

# ─── Install Skill + Scripts ─────────────────────────────────
Write-Host "`n🔧 Installing antigravity-memory-sync" -ForegroundColor Cyan
Write-Host ""

# 1. Skill (SKILL.md)
Write-Host "▶ Installing Skill..." -ForegroundColor Cyan
if (-not (Test-Path $skillDest)) { New-Item -ItemType Directory -Path $skillDest -Force | Out-Null }
Copy-Item -Path (Join-Path $repoDir "skill\SKILL.md") -Destination $skillDest -Force
Write-Ok "SKILL.md → $skillDest"

# 2. Scripts (setup.ps1, sync.ps1, gdrive-api.ps1)
$scriptsDest = Join-Path $skillDest "scripts"
if (-not (Test-Path $scriptsDest)) { New-Item -ItemType Directory -Path $scriptsDest -Force | Out-Null }
Copy-Item -Path (Join-Path $repoDir "scripts\setup.ps1") -Destination $scriptsDest -Force
Copy-Item -Path (Join-Path $repoDir "scripts\sync.ps1") -Destination $scriptsDest -Force
Copy-Item -Path (Join-Path $repoDir "scripts\gdrive-api.ps1") -Destination $scriptsDest -Force
Copy-Item -Path (Join-Path $repoDir "config.example.json") -Destination $skillDest -Force
Write-Ok "scripts/ → $scriptsDest"

# 2b. Config files (credentials, syncignore — copy if they exist)
$credSrc = Join-Path $repoDir "credentials.json"
if (Test-Path $credSrc) {
    Copy-Item -Path $credSrc -Destination $scriptsDest -Force
    Write-Ok "credentials.json → $scriptsDest"
}
$syncignoreSrc = Join-Path $repoDir ".syncignore"
if (Test-Path $syncignoreSrc) {
    Copy-Item -Path $syncignoreSrc -Destination $skillDest -Force
    Write-Ok ".syncignore → $skillDest"
}

# 3. Workflows (optional)
if (-not $NoWorkflows) {
    if (-not $WorkflowTarget) {
        # Default: .agents/workflows/ in current working directory
        $WorkflowTarget = Join-Path (Get-Location) ".agents\workflows"
    }

    Write-Host ""
    Write-Host "▶ Installing Workflows..." -ForegroundColor Cyan
    if (-not (Test-Path $WorkflowTarget)) { New-Item -ItemType Directory -Path $WorkflowTarget -Force | Out-Null }
    
    $wfSource = Join-Path $repoDir "workflows"
    Get-ChildItem -Path $wfSource -Filter "*.md" | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $WorkflowTarget -Force
        Write-Ok "$($_.Name) → $WorkflowTarget"
    }
}

# ─── Summary ─────────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 50) -ForegroundColor Cyan
Write-Host "🎉 Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Info "Skill:     $skillDest"
Write-Info "Scripts:   $scriptsDest"
if (-not $NoWorkflows) {
    Write-Info "Workflows: $WorkflowTarget"
}
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "    1. Run setup:  & `"$scriptsDest\setup.ps1`"" -ForegroundColor White
Write-Host "    2. Use slash commands: /sync-memory, /import-memory, /export-memory" -ForegroundColor White
Write-Host ""
