# antigravity-memory-sync

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## 🌐 English

Sync your [Antigravity](https://antigravity.google) brain, knowledge, and skills across multiple machines and accounts via **Google Drive API** (no app install needed) or symlink to a cloud folder.

### Features

- 🔄 **Cross-machine sync** — Share memory/knowledge/skills across computers
- 👥 **Cross-account sync** — Multiple user accounts see the same data via symlinks
- 🌐 **API Mode (NEW)** — Direct Google Drive sync via OAuth2, no app install required
- ☁️ **Symlink Mode** — Works with Google Drive for Desktop / OneDrive / Dropbox
- 📦 **Skills auto-install** — Maintains a manifest of skills to install on new machines
- 🛡️ **Safe setup** — Backs up existing data before creating symlinks
- 🧪 **Dry-run mode** — Preview all changes before applying

### Installation

```powershell
git clone https://github.com/user/antigravity-memory-sync.git
cd antigravity-memory-sync
.\install.ps1
```

### Quick Start — API Mode (Recommended)

No Google Drive for Desktop needed. Just authorize with your Google account in the browser:

```powershell
# First-time setup: opens browser for Google OAuth2 login
.\scripts\setup.ps1 -Mode api

# Daily sync
.\scripts\sync.ps1                    # Bidirectional sync
.\scripts\sync.ps1 -Direction import  # Pull from cloud
.\scripts\sync.ps1 -Direction export  # Push to cloud
```

### Quick Start — Symlink Mode

Uses an installed cloud drive app (Google Drive / OneDrive / Dropbox):

```powershell
# First-time setup
.\scripts\setup.ps1

# Sync is automatic — no manual steps needed
```

### Configuration

After running `setup.ps1`, a local `config.json` is generated:

**API Mode:**

```json
{
    "sync_mode": "api",
    "sync_folder_name": "AntigravitySync",
    "sync_targets": ["brain", "knowledge", "skills"],
    "google_drive": {
        "refresh_token": "1//0xxx...",
        "root_folder_id": "1abc...",
        "folder_ids": { "brain": "...", "knowledge": "...", "skills": "..." },
        "last_sync": "2026-03-02T12:30:00Z"
    }
}
```

**Symlink Mode:**

```json
{
    "sync_mode": "symlink",
    "cloud_drive_path": "G:\\My Drive",
    "sync_folder_name": "AntigravitySync",
    "sync_targets": ["brain", "knowledge", "skills"],
    "use_symlinks": true
}
```

> **Note:** `config.json` contains tokens/paths and is `.gitignore`d. Each machine has its own copy.

### How It Works

**API Mode:**

```
Machine A                     Google Drive REST API              Machine B
brain/ ←── sync.ps1 ──────→ AntigravitySync/brain/ ←── sync.ps1 ──→ brain/
knowledge/ ← sync.ps1 ────→ AntigravitySync/knowledge/ ← sync.ps1 → knowledge/
skills/ ←── sync.ps1 ──────→ AntigravitySync/skills/ ←── sync.ps1 ──→ skills/
```

**Symlink Mode:**

```
Machine A (.gemini/antigravity/)         Cloud Drive Folder           Machine B
brain/ ──── symlink ──────→ AntigravitySync/brain/ ←── symlink ──── brain/
```

### Project Structure

```
antigravity-memory-sync/
├── install.ps1              ← One-command installer
├── config.example.json      ← Config template
├── scripts/
│   ├── gdrive-api.ps1       ← Google Drive REST API module (OAuth2 + sync)
│   ├── setup.ps1            ← First-time setup (API / symlink / manual)
│   └── sync.ps1             ← Bidirectional sync (auto-detects mode)
├── skill/
│   └── SKILL.md             ← Antigravity Skill definition
└── workflows/
    ├── sync-memory.md       ← /sync-memory slash command
    ├── import-memory.md     ← /import-memory slash command
    └── export-memory.md     ← /export-memory slash command
```

### Requirements

- Windows 10/11 (PowerShell 5.1+)
- **API Mode:** A web browser (for one-time OAuth2 login)
- **Symlink Mode:** Cloud drive app + Administrator privileges

### License

MIT

---

<a id="中文"></a>

## 🌐 中文

使用 **Google Drive API**（不需安裝任何應用程式）或 symlink 雲端資料夾，在多台電腦和帳號間同步你的 [Antigravity](https://antigravity.google) brain、knowledge 和 skills。

### 功能特色

- 🔄 **跨電腦同步** — 在不同電腦間共享 memory / knowledge / skills
- 👥 **跨帳號同步** — 透過 symlink 讓多個使用者帳號看到同一份資料
- 🌐 **API 模式（新功能）** — 透過 OAuth2 直接同步 Google Drive，免安裝
- ☁️ **Symlink 模式** — 支援 Google Drive for Desktop / OneDrive / Dropbox
- 📦 **Skills 自動安裝** — 維護 skills 清單，新電腦可快速對齊
- 🛡️ **安全設定** — 建立 symlink 前自動備份現有資料
- 🧪 **Dry-run 模式** — 預覽所有變更，確認後再執行

### 安裝

```powershell
git clone https://github.com/user/antigravity-memory-sync.git
cd antigravity-memory-sync
.\install.ps1
```

### 快速開始 — API 模式（推薦）

不需要安裝 Google Drive for Desktop，只要在瀏覽器授權 Google 帳號：

```powershell
# 首次設定：開啟瀏覽器進行 Google OAuth2 登入
.\scripts\setup.ps1 -Mode api

# 日常同步
.\scripts\sync.ps1                    # 雙向同步
.\scripts\sync.ps1 -Direction import  # 從雲端拉到本機
.\scripts\sync.ps1 -Direction export  # 從本機推到雲端
```

### 快速開始 — Symlink 模式

使用已安裝的雲端硬碟應用程式（Google Drive / OneDrive / Dropbox）：

```powershell
# 首次設定
.\scripts\setup.ps1

# 同步是自動的，不需要手動操作
```

### 設定檔

執行 `setup.ps1` 後會產生本機的 `config.json`：

**API 模式：**

```json
{
    "sync_mode": "api",
    "sync_folder_name": "AntigravitySync",
    "sync_targets": ["brain", "knowledge", "skills"],
    "google_drive": {
        "refresh_token": "1//0xxx...",
        "root_folder_id": "1abc...",
        "folder_ids": { "brain": "...", "knowledge": "...", "skills": "..." },
        "last_sync": "2026-03-02T12:30:00Z"
    }
}
```

**Symlink 模式：**

```json
{
    "sync_mode": "symlink",
    "cloud_drive_path": "G:\\My Drive",
    "sync_folder_name": "AntigravitySync",
    "sync_targets": ["brain", "knowledge", "skills"],
    "use_symlinks": true
}
```

> **注意：** `config.json` 包含 token 和本機路徑，已加入 `.gitignore`。每台電腦各有一份。

### 運作原理

**API 模式：**

```
電腦 A                      Google Drive REST API              電腦 B
brain/ ←── sync.ps1 ──────→ AntigravitySync/brain/ ←── sync.ps1 ──→ brain/
knowledge/ ← sync.ps1 ────→ AntigravitySync/knowledge/ ← sync.ps1 → knowledge/
skills/ ←── sync.ps1 ──────→ AntigravitySync/skills/ ←── sync.ps1 ──→ skills/
```

**Symlink 模式：**

```
電腦 A (.gemini/antigravity/)         雲端硬碟資料夾              電腦 B
brain/ ──── symlink ──────→ AntigravitySync/brain/ ←── symlink ──── brain/
```

### 專案結構

```
antigravity-memory-sync/
├── install.ps1              ← 一鍵安裝腳本
├── config.example.json      ← 設定範本
├── scripts/
│   ├── gdrive-api.ps1       ← Google Drive REST API 模組（OAuth2 + 同步）
│   ├── setup.ps1            ← 首次設定（API / symlink / 手動）
│   └── sync.ps1             ← 雙向同步（自動偵測模式）
├── skill/
│   └── SKILL.md             ← Antigravity Skill 定義
└── workflows/
    ├── sync-memory.md       ← /sync-memory 指令
    ├── import-memory.md     ← /import-memory 指令
    └── export-memory.md     ← /export-memory 指令
```

### 系統需求

- Windows 10/11（PowerShell 5.1+）
- **API 模式：** 瀏覽器（僅首次 OAuth2 登入需要）
- **Symlink 模式：** 雲端硬碟應用程式 + 系統管理員權限

### 授權

MIT
