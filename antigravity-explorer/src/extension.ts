import * as vscode from 'vscode';
import { SkillsTreeProvider } from './providers/skillsTreeProvider';
import { BrainTreeProvider } from './providers/brainTreeProvider';
import { SyncTreeProvider } from './providers/syncTreeProvider';
import { DashboardPanel } from './webview/dashboard';
import { runSyncCommand } from './commands/syncCommands';

export function activate(context: vscode.ExtensionContext) {
    console.log('Antigravity Explorer is now active');

    const antigravityPath = getAntigravityPath();
    if (!antigravityPath) {
        vscode.window.showWarningMessage(
            'Antigravity directory not found. Expected at ~/.gemini/antigravity/'
        );
        return;
    }

    // ── TreeView Providers ────────────────────────────────────
    const skillsProvider = new SkillsTreeProvider(antigravityPath);
    const brainProvider = new BrainTreeProvider(antigravityPath);
    const syncProvider = new SyncTreeProvider(antigravityPath);

    vscode.window.registerTreeDataProvider('antigravity-skills', skillsProvider);
    vscode.window.registerTreeDataProvider('antigravity-brain', brainProvider);
    vscode.window.registerTreeDataProvider('antigravity-sync', syncProvider);

    // ── Commands ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.refresh', () => {
            skillsProvider.refresh();
            brainProvider.refresh();
            syncProvider.refresh();
            vscode.window.showInformationMessage('Antigravity Explorer refreshed');
        }),

        vscode.commands.registerCommand('antigravity.openDashboard', () => {
            DashboardPanel.createOrShow(context, antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.syncMemory', () => {
            runSyncCommand('both', antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.exportMemory', () => {
            runSyncCommand('export', antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.importMemory', () => {
            runSyncCommand('import', antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.openFile', (uri: vscode.Uri) => {
            vscode.window.showTextDocument(uri);
        })
    );
}

export function deactivate() { }

function getAntigravityPath(): string | undefined {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const fs = require('fs');
    const path = require('path');
    const antigravityPath = path.join(home, '.gemini', 'antigravity');
    if (fs.existsSync(antigravityPath)) {
        return antigravityPath;
    }
    return undefined;
}
