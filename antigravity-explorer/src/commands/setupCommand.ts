import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

/**
 * Find available PowerShell executable. Prefers pwsh.exe (PS7), falls back to powershell.exe (PS5).
 */
export function findPowerShell(): string {
    try {
        cp.execFileSync('pwsh.exe', ['-Version'], { stdio: 'ignore' });
        return 'pwsh.exe';
    } catch {
        return 'powershell.exe';
    }
}

/**
 * Check if bundled file is newer or different from installed file.
 */
function shouldUpdate(srcPath: string, destPath: string): boolean {
    if (!fs.existsSync(destPath)) { return true; }
    if (!fs.existsSync(srcPath)) { return false; }
    const srcStat = fs.statSync(srcPath);
    const destStat = fs.statSync(destPath);
    // Update if source is larger, or size differs (content changed)
    return srcStat.size !== destStat.size;
}

/**
 * Ensure memory-sync scripts are installed & up-to-date at ~/.gemini/antigravity/skills/memory-sync/
 * Copies from bundled-scripts/ within the extension. Always updates if bundled version differs.
 * @returns true if scripts are available
 */
export function ensureScriptsInstalled(context: vscode.ExtensionContext, antigravityPath: string): boolean {
    const skillDest = path.join(antigravityPath, 'skills', 'memory-sync');
    const scriptsDest = path.join(skillDest, 'scripts');

    // Source from extension's bundled-scripts/
    const bundledDir = path.join(context.extensionPath, 'bundled-scripts');
    if (!fs.existsSync(bundledDir)) {
        console.error('Antigravity Explorer: bundled-scripts/ not found in extension');
        return false;
    }

    try {
        // Create destination directories
        fs.mkdirSync(scriptsDest, { recursive: true });

        // Copy/update scripts (always update if content differs)
        let updated = 0;
        const scriptFiles = ['setup.ps1', 'sync.ps1', 'gdrive-api.ps1'];
        for (const file of scriptFiles) {
            const src = path.join(bundledDir, file);
            const dst = path.join(scriptsDest, file);
            if (fs.existsSync(src) && shouldUpdate(src, dst)) {
                fs.copyFileSync(src, dst);
                updated++;
            }
        }

        // Copy credentials.json to memory-sync/ (gdrive-api.ps1 loads from $PSScriptRoot/../credentials.json)
        const credSrc = path.join(bundledDir, 'credentials.json');
        const credDst = path.join(skillDest, 'credentials.json');
        if (fs.existsSync(credSrc) && !fs.existsSync(credDst)) {
            fs.copyFileSync(credSrc, credDst);
        }

        // Copy config.example.json
        const exampleSrc = path.join(bundledDir, 'config.example.json');
        if (fs.existsSync(exampleSrc)) {
            const exDst = path.join(skillDest, 'config.example.json');
            if (shouldUpdate(exampleSrc, exDst)) {
                fs.copyFileSync(exampleSrc, exDst);
            }
        }

        // Copy .syncignore (always update — bundled inside bundled-scripts/)
        const syncignoreDst = path.join(skillDest, '.syncignore');
        const syncignoreSrc = path.join(bundledDir, '.syncignore');
        if (fs.existsSync(syncignoreSrc) && shouldUpdate(syncignoreSrc, syncignoreDst)) {
            fs.copyFileSync(syncignoreSrc, syncignoreDst);
        }

        // Copy SKILL.md
        const skillMd = path.join(bundledDir, 'skill', 'SKILL.md');
        if (fs.existsSync(skillMd)) {
            const skillMdDst = path.join(skillDest, 'SKILL.md');
            if (shouldUpdate(skillMd, skillMdDst)) {
                fs.copyFileSync(skillMd, skillMdDst);
            }
        }

        if (updated > 0) {
            console.log(`Antigravity Explorer: updated ${updated} script(s) at ${scriptsDest}`);
        }

        return true;
    } catch (err) {
        console.error('Antigravity Explorer: failed to install scripts:', err);
        return false;
    }
}

/**
 * Diagnose sync setup state. Returns a diagnostic object.
 */
export interface SyncDiagnosis {
    scriptsInstalled: boolean;
    credentialsExist: boolean;
    configExists: boolean;
    hasRefreshToken: boolean;
    configPath: string;
    message: string;
}

export function diagnoseSyncSetup(antigravityPath: string): SyncDiagnosis {
    const skillDir = path.join(antigravityPath, 'skills', 'memory-sync');
    const scriptsDir = path.join(skillDir, 'scripts');
    const syncScript = path.join(scriptsDir, 'sync.ps1');
    // credentials.json lives in memory-sync/ (copied by ensureScriptsInstalled)
    const credPath = path.join(skillDir, 'credentials.json');
    const configPath = path.join(skillDir, 'config.json');

    const scriptsInstalled = fs.existsSync(syncScript);
    const credentialsExist = fs.existsSync(credPath);

    let configExists = false;
    let hasRefreshToken = false;

    if (fs.existsSync(configPath)) {
        configExists = true;
        try {
            // Strip BOM if present (PowerShell UTF8 may include BOM)
            let raw = fs.readFileSync(configPath, 'utf-8');
            if (raw.charCodeAt(0) === 0xFEFF) { raw = raw.slice(1); }
            const config = JSON.parse(raw);
            hasRefreshToken = !!(config.google_drive?.refresh_token);
        } catch { /* invalid JSON */ }
    }

    let message: string;
    if (!scriptsInstalled) {
        message = 'Scripts not installed';
    } else if (!credentialsExist) {
        message = 'Missing credentials.json (OAuth client)';
    } else if (!configExists) {
        message = 'Needs Setup (no config.json)';
    } else if (!hasRefreshToken) {
        message = 'Needs re-authorization (no refresh_token)';
    } else {
        message = 'Ready';
    }

    return { scriptsInstalled, credentialsExist, configExists, hasRefreshToken, configPath, message };
}

/**
 * Watch config.json for changes after setup. Calls onReady when refresh_token appears.
 * Returns a disposable to stop watching.
 */
export function watchConfigForToken(antigravityPath: string, onReady: () => void): { dispose: () => void } {
    const configPath = path.join(antigravityPath, 'skills', 'memory-sync', 'config.json');
    let disposed = false;

    const interval = setInterval(() => {
        if (disposed) { return; }
        try {
            if (!fs.existsSync(configPath)) { return; }
            let raw = fs.readFileSync(configPath, 'utf-8');
            if (raw.charCodeAt(0) === 0xFEFF) { raw = raw.slice(1); }
            const config = JSON.parse(raw);
            if (config.google_drive?.refresh_token) {
                disposed = true;
                clearInterval(interval);
                onReady();
            }
        } catch { /* not ready yet */ }
    }, 3000);

    // Auto-stop after 5 minutes
    const timeout = setTimeout(() => {
        disposed = true;
        clearInterval(interval);
    }, 300000);

    return {
        dispose: () => {
            disposed = true;
            clearInterval(interval);
            clearTimeout(timeout);
        }
    };
}

/**
 * Run setup.ps1 -Mode api in a terminal.
 * This opens a browser for Google OAuth2 authorization.
 */
export function runSetupCommand(context: vscode.ExtensionContext, antigravityPath: string, onConfigReady?: () => void) {
    // Ensure scripts exist first
    const installed = ensureScriptsInstalled(context, antigravityPath);
    if (!installed) {
        vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to install sync scripts. Please check the extension installation.')
        );
        return;
    }

    // Diagnose current state
    const diagnosis = diagnoseSyncSetup(antigravityPath);
    if (!diagnosis.credentialsExist) {
        vscode.window.showWarningMessage(
            vscode.l10n.t('credentials.json not found. The bundled credentials will be used, but you may need to check the OAuth client setup.'),
        );
    }

    const scriptPath = path.join(antigravityPath, 'skills', 'memory-sync', 'scripts', 'setup.ps1');

    const terminal = vscode.window.createTerminal({
        name: 'Antigravity Setup',
        shellPath: findPowerShell()
    });
    terminal.show();
    terminal.sendText(`& "${scriptPath}" -Mode api`);

    vscode.window.showInformationMessage(
        vscode.l10n.t('Antigravity: Setup started. Please authorize in the browser window.')
    );

    // Watch for config.json to get the refresh_token, then auto-refresh tree
    if (onConfigReady) {
        const watcher = watchConfigForToken(antigravityPath, () => {
            onConfigReady();
            vscode.window.showInformationMessage('✅ Antigravity: Authorization complete! Sync is ready.');
        });
        // Clean up watcher when terminal closes
        const disposable = vscode.window.onDidCloseTerminal(t => {
            if (t === terminal) {
                // Give a few extra seconds for file writes to complete
                setTimeout(() => {
                    watcher.dispose();
                    onConfigReady(); // Refresh tree anyway on terminal close
                }, 2000);
                disposable.dispose();
            }
        });
    }
}
