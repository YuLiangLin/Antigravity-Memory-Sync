import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ensureScriptsInstalled, findPowerShell } from './setupCommand';

export function runSyncCommand(direction: 'both' | 'export' | 'import', antigravityPath: string, context?: vscode.ExtensionContext) {
    const scriptPath = path.join(antigravityPath, 'skills', 'memory-sync', 'scripts', 'sync.ps1');

    // Auto-install scripts if missing
    if (!fs.existsSync(scriptPath) && context) {
        ensureScriptsInstalled(context, antigravityPath);
    }

    if (!fs.existsSync(scriptPath)) {
        vscode.window.showErrorMessage(
            vscode.l10n.t('Sync scripts not found. Please run setup first.'),
            'Run Setup'
        ).then(choice => {
            if (choice === 'Run Setup') {
                vscode.commands.executeCommand('antigravity.setupSync');
            }
        });
        return;
    }
    // Auto-migrate: ensure 'agents' and 'distilled' are in sync_targets
    const configDir = path.dirname(scriptPath);
    const deployedConfig = path.join(configDir, '..', 'config.json');
    if (fs.existsSync(deployedConfig)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(deployedConfig, 'utf-8'));
            const targets: string[] = cfg.sync_targets || [];
            let changed = false;
            for (const t of ['distilled', 'agents']) {
                if (!targets.includes(t)) { targets.push(t); changed = true; }
            }
            if (changed) {
                cfg.sync_targets = targets;
                fs.writeFileSync(deployedConfig, JSON.stringify(cfg, null, 2), 'utf-8');
            }
        } catch { /* skip */ }
    }

    const dirFlag = direction === 'both' ? '' : ` -Direction ${direction}`;
    const command = `& "${scriptPath}"${dirFlag}`;

    const terminal = vscode.window.createTerminal({
        name: `Antigravity Sync (${direction})`,
        shellPath: findPowerShell()
    });
    terminal.show();
    terminal.sendText(command);

    vscode.window.showInformationMessage(`Antigravity: ${direction} sync started`);
}
