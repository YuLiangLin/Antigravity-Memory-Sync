---
name: Memory Sync
description: Cross-machine synchronization of Antigravity brain, knowledge, and skills via Google Drive API or cloud storage. Use when setting up a new machine, syncing memory between computers, or managing skills across accounts.
---

# Memory Sync Skill

## Overview

Synchronize Antigravity's memory (brain, knowledge, skills) across multiple machines and accounts. Supports two modes:

- **API Mode** — Direct Google Drive REST API sync (recommended, no app install)
- **Symlink Mode** — Uses cloud drive app (Google Drive for Desktop / OneDrive / Dropbox)

## Quick Commands

### API Mode Setup (Recommended)

```powershell
# First-time: OAuth2 browser authorization
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\setup.ps1" -Mode api
```

### Sync

```powershell
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\sync.ps1"                    # Bidirectional
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\sync.ps1" -Direction import  # Cloud → Local
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\sync.ps1" -Direction export  # Local → Cloud
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\sync.ps1" -Target skills     # Skills only
```

### Symlink Mode Setup

```powershell
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\setup.ps1"
& "$env:USERPROFILE\.gemini\antigravity\skills\memory-sync\scripts\setup.ps1" -CloudPath "G:\My Drive" -DryRun
```

## When to Use

- **New machine setup**: Run `setup.ps1 -Mode api` to authorize and sync
- **Daily sync**: Run `sync.ps1` (API mode) or auto-sync (symlink mode)
- **After account switch**: Run `setup.ps1` on the new account
- **Backup before changes**: `sync.ps1 -Direction export`

## Config Location

`config.json` in the project root (gitignored, machine-specific).
