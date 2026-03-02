import * as vscode from 'vscode';
import * as path from 'path';

export function runSyncCommand(direction: 'both' | 'export' | 'import', antigravityPath: string) {
    const scriptPath = path.join(antigravityPath, 'skills', 'memory-sync', 'scripts', 'sync.ps1');

    const dirFlag = direction === 'both' ? '' : ` -Direction ${direction}`;
    const command = `& "${scriptPath}"${dirFlag}`;

    const terminal = vscode.window.createTerminal({
        name: `Antigravity Sync (${direction})`,
        shellPath: 'pwsh.exe'
    });
    terminal.show();
    terminal.sendText(command);

    vscode.window.showInformationMessage(`Antigravity: ${direction} sync started`);
}
