# Antigravity Memory Skills

跨電腦同步 Antigravity AI 助手的記憶（brain、knowledge、skills），並提供 VS Code 延伸模組視覺化管理。

## 專案結構

| 目錄 | 說明 |
|------|------|
| [Antigravity-Memory-Sync](./Antigravity-Memory-Sync/) | Google Drive API 同步模組（PowerShell） |
| [antigravity-explorer](./antigravity-explorer/) | VS Code 延伸模組（TreeView + Dashboard） |

## Quick Start

### 1. 安裝 Memory Sync

```powershell
cd Antigravity-Memory-Sync
.\install.ps1
.\scripts\setup.ps1 -Mode api    # 首次 OAuth2 授權
```

### 2. 安裝 VS Code Extension

```powershell
cd antigravity-explorer
npm install && npm run compile
npx @vscode/vsce package --allow-missing-repository
# 然後安裝產生的 .vsix 檔案
```

或從 [Releases](../../releases) 下載最新的 `.vsix`。

## Release

推送 tag 即自動透過 GitHub Actions 建置並發布 `.vsix`：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

MIT
