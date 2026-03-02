import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SyncTreeProvider implements vscode.TreeDataProvider<SyncItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SyncItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private antigravityPath: string) { }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SyncItem): vscode.TreeItem {
        return element;
    }

    getChildren(): SyncItem[] {
        const config = this.loadConfig();
        const items: SyncItem[] = [];

        if (!config) {
            items.push(new SyncItem(
                '⚠️ Not configured',
                'Run setup.ps1 -Mode api',
                'warning'
            ));
        } else {
            // Mode
            const mode = config.sync_mode || 'symlink';
            items.push(new SyncItem(
                `Mode: ${mode}`,
                mode === 'api' ? 'Google Drive API' : 'Symlink / Manual',
                'cloud'
            ));

            // Last sync time
            if (config.google_drive?.last_sync) {
                const lastSync = new Date(config.google_drive.last_sync);
                const ago = this.timeAgo(lastSync);
                items.push(new SyncItem(
                    `Last sync: ${ago}`,
                    lastSync.toLocaleString(),
                    'history'
                ));
            }
        }

        // Always show action items
        items.push(new SyncItem('↕️  Sync Now', 'Bidirectional sync', 'sync', 'antigravity.syncMemory'));
        items.push(new SyncItem('⬆️  Export', 'Local → Cloud', 'cloud-upload', 'antigravity.exportMemory'));
        items.push(new SyncItem('⬇️  Import', 'Cloud → Local', 'cloud-download', 'antigravity.importMemory'));

        return items;
    }

    private loadConfig(): any {
        const configPaths = [
            // Installed skill location
            path.join(this.antigravityPath, 'skills', 'memory-sync', 'config.json'),
            // Direct project paths
            path.join(this.antigravityPath, 'skills', 'memory-sync', '..', '..', '..', 'config.json'),
        ];

        // Also search workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const base = folder.uri.fsPath;
                configPaths.push(path.join(base, 'config.json'));
                configPaths.push(path.join(base, 'Antigravity-Memory-Sync', 'config.json'));

                // Search subdirectories one level deep
                try {
                    const subdirs = fs.readdirSync(base, { withFileTypes: true })
                        .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules');
                    for (const sub of subdirs) {
                        configPaths.push(path.join(base, sub.name, 'config.json'));
                    }
                } catch { /* ignore */ }
            }
        }

        for (const cp of configPaths) {
            if (fs.existsSync(cp)) {
                try { return JSON.parse(fs.readFileSync(cp, 'utf-8')); }
                catch { continue; }
            }
        }
        return null;
    }

    private timeAgo(date: Date): string {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) { return 'just now'; }
        if (seconds < 3600) { return `${Math.floor(seconds / 60)} min ago`; }
        if (seconds < 86400) { return `${Math.floor(seconds / 3600)}h ago`; }
        return `${Math.floor(seconds / 86400)}d ago`;
    }
}

class SyncItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        icon: string,
        commandId?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon);
        if (commandId) {
            this.command = { command: commandId, title: label };
        }
    }
}
