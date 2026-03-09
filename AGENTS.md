# Antigravity Memory Sync

## 專案概述

這是 **Antigravity Explorer** VS Code 擴充套件及其同步基礎設施的主專案倉庫。
主要功能是管理 Gemini AI 助手的記憶系統（brain/knowledge/skills/distilled），並提供跨機器同步、儀表板視覺化、專案管理等功能。

## 技術棧

- **VS Code Extension**: TypeScript, VS Code Extension API (`^1.85.0`)
- **Sync Scripts**: PowerShell 7+
- **Cloud Sync**: Google Drive REST API (OAuth2)
- **套件管理**: npm, `@vscode/vsce` (打包 VSIX)
- **國際化**: VS Code l10n (繁體中文 `zh-tw`)

## 目錄結構

```
Antigravity-Memory-Sync/
├── antigravity-explorer/          ← VS Code 擴充套件
│   ├── src/
│   │   ├── extension.ts           ← 進入點：註冊所有命令和 tree providers
│   │   ├── autoScheduler.ts       ← 自動同步排程器
│   │   ├── commands/
│   │   │   ├── distillCommand.ts  ← 「粹練大腦」功能（收集 brain + project 資料 → 送到 chat）
│   │   │   ├── projectCommands.ts ← 專案掃描/clone/GitLab 整合（ProjectEntry, ProjectRegistry）
│   │   │   ├── syncCommands.ts    ← 觸發 PowerShell sync 腳本
│   │   │   ├── setupCommand.ts    ← 初始設定精靈
│   │   │   └── gitCommands.ts     ← Git 操作
│   │   ├── providers/
│   │   │   ├── skillsTreeProvider.ts  ← 側邊欄技能樹
│   │   │   ├── brainTreeProvider.ts   ← 側邊欄大腦樹
│   │   │   ├── syncTreeProvider.ts    ← 側邊欄同步狀態
│   │   │   └── projectTreeProvider.ts ← 側邊欄專案列表
│   │   └── webview/
│   │       ├── dashboard.ts       ← 🧩 主儀表板（Skills Grid/List/MindMap + Brain + Distilled）
│   │       └── brainDashboard.ts  ← 🧠 大腦儀表板（對話詳情 + markdown 預覽）
│   ├── l10n/
│   │   ├── bundle.l10n.json       ← 英文字串
│   │   └── bundle.l10n.zh-tw.json ← 繁體中文翻譯
│   └── package.json               ← 擴充套件定義（命令、視圖、設定）
├── scripts/
│   ├── sync.ps1                   ← 同步腳本（API / symlink / manual 模式）
│   ├── setup.ps1                  ← 初始設定（OAuth2、Drive 資料夾建立）
│   └── gdrive-api.ps1             ← Google Drive API 底層函式
├── config.json                    ← 同步設定（sync_targets, folder_ids, refresh_token）
├── .syncignore                    ← 同步排除規則
└── workflows/                     ← Agent 工作流程
    └── sync-memory.md             ← 同步操作 SOP
```

## Antigravity 資料架構（全域）

所有資料存在 `~/.gemini/antigravity/`（跨 workspace 共享）：

| 目錄 | 用途 | 同步 |
|------|------|------|
| `brain/` | 對話成品（task.md, walkthrough.md, implementation_plan.md） | ✅ |
| `knowledge/` | AI 自動粹煉的知識項目 | ✅ |
| `skills/` | 技能指令（SKILL.md + scripts） | ✅ |
| `distilled/` | 粹練報告（手動觸發的分析摘要） | ✅ |

## 目前版本：v0.13.1

### 主要功能清單

1. **側邊欄面板** — Skills / Brain / Sync Status / Projects 四個 tree view
2. **🧩 主儀表板** (`dashboard.ts`)
   - Skills：Grid / List / MindMap(SVG) 三種視圖 + 搜尋 + 自動分類(6 類)
   - Brain Activity：全部分頁顯示 + 點擊查看詳情
   - Distilled Insights：粹練精華卡片 + markdown 預覽
   - 點擊任何卡片 → 覆蓋面板（markdown 預覽 + View Source + VS Code Preview）
3. **🧠 大腦儀表板** (`brainDashboard.ts`)
   - 對話搜尋 + 篩選（Task/Walk/Plan）
   - 點擊對話 → 成品頁籤切換 + markdown 預覽
   - 活動熱力圖（30 天）
4. **粹練大腦** (`distillCommand.ts`)
   - 收集本地專案資料（AGENTS.md / README.md）+ Brain 對話統計
   - 自動複製到剪貼簿 + 開啟聊天面板
5. **同步** — Google Drive API / Symlink / Manual 三種模式
   - 支援 `brain`, `knowledge`, `skills`, `distilled` 四個同步目標
   - 新目標自動建立 Drive 資料夾
6. **專案管理** — 掃描 workspace / GitLab 探索 / Clone / 技術棧偵測

### 近期重要決策

- MindMap 用純 SVG 實作（不引入第三方 JS 庫，避免 CSP 問題）
- Skills 分類用關鍵字推斷（SKILL.md 沒有 category 欄位）
- `distilled/` 加入同步目標，讓粹練結果跨機器共享
- 粹練只包含本地專案（過濾遠端無內容的專案）

## 開發指令

```powershell
# 編譯
cd antigravity-explorer && npm run compile

# 打包 VSIX（會自動先編譯）
npm run package

# 安裝到本機 VS Code
code --install-extension antigravity-explorer-{version}.vsix

# 同步
cd ../scripts
./sync.ps1 -Direction export    # 本地 → 雲端
./sync.ps1 -Direction import    # 雲端 → 本地
./sync.ps1                      # 雙向同步
```

## 版本歷程（重要里程碑）

| 版本 | 功能 |
|------|------|
| 0.13.1 | 粹練自動送聊天（clipboard fallback） |
| 0.13.0 | `distilled` 同步 + 粹練精華頁面 |
| 0.12.x | 粹練大腦加入專案 context + 過濾遠端 |
| 0.11.0 | Skills Dashboard 大升級（搜尋/分類/Grid/List/MindMap） |
| 0.10.0 | Brain Dashboard 對話詳情 + markdown 預覽 |
| 0.9.x  | Brain Dashboard 搜尋/篩選 + UI 改版 |

## 相關專案

- **DiCon-Web-Instrument-Suite** — Web Control Library（同 workspace）
- **PMM-WebService** — PMM 網頁服務（同 workspace）
- **DiConProject-Antigravity-Skills** — 技能倉庫來源
