# Antigravity Explorer

A Visual Studio Code extension to browse and manage your Antigravity AI coding assistant's memory — skills, brain conversations, knowledge items — and sync them across machines.

## Features

### 🔧 Skills Browser

View all installed Antigravity skills with their names, descriptions, and sources in the sidebar TreeView.

### 🧠 Brain Explorer

Browse your conversation history and artifacts (task checklists, walkthroughs, implementation plans) sorted by most recent activity.

### ☁️ Memory Sync

Sync your Antigravity memory to Google Drive directly from VS Code:

- **Sync**: Bidirectional sync
- **Export**: Upload local → cloud
- **Import**: Download cloud → local

### 📊 Dashboard

A visual overview panel showing:

- Installed skills count with card grid
- Recent brain conversations with artifact badges
- Statistics summary

## Usage

Open the **Antigravity Explorer** panel from the Activity Bar (left sidebar).

### Commands (Ctrl+Shift+P)

| Command | Description |
|---------|-------------|
| `Antigravity: Open Dashboard` | Open the visual dashboard panel |
| `Antigravity: Sync Memory` | Bidirectional sync with cloud |
| `Antigravity: Export to Cloud` | Push local memory to cloud |
| `Antigravity: Import from Cloud` | Pull cloud memory to local |
| `Antigravity: Refresh` | Refresh all TreeViews |

## Requirements

- VS Code 1.85+
- Antigravity (Gemini Code Assist) installed
- For sync: Run `memory-sync/setup.ps1 -Mode api` first

## Development

```bash
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

## Packaging

```bash
npm run package
# Produces antigravity-explorer-0.1.0.vsix
```

Install the `.vsix`:

```
code --install-extension antigravity-explorer-0.1.0.vsix
```
