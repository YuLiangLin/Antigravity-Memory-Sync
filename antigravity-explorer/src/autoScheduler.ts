import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

let syncTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;

interface AutoSyncState {
    lastSyncTime: number;
    lastDistillConvCount: number;
}

const STATE_KEY = 'antigravity.autoSyncState';

export function startAutoScheduler(context: vscode.ExtensionContext, antigravityPath: string) {
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    statusBarItem.command = 'antigravity.syncMemory';
    context.subscriptions.push(statusBarItem);

    // Read config
    const config = vscode.workspace.getConfiguration('antigravity');
    const autoSyncEnabled = config.get<boolean>('autoSync', true);
    const syncIntervalMin = config.get<number>('autoSyncInterval', 30);
    const autoDistillEnabled = config.get<boolean>('autoDistill', true);
    const distillThreshold = config.get<number>('autoDistillThreshold', 5);

    if (!autoSyncEnabled) {
        statusBarItem.text = '$(sync-ignored) Antigravity';
        statusBarItem.tooltip = vscode.l10n.t('Auto-sync is disabled');
        statusBarItem.show();
        return;
    }

    // Load state
    const state = context.globalState.get<AutoSyncState>(STATE_KEY, {
        lastSyncTime: 0,
        lastDistillConvCount: 0
    });

    // Show status
    updateStatusBar('idle');

    // Start periodic sync
    const intervalMs = syncIntervalMin * 60 * 1000;
    console.log(`Antigravity: Auto-sync every ${syncIntervalMin} min`);

    // Run initial sync after 30 seconds (let IDE fully load)
    const startupDelay = setTimeout(() => {
        runBackgroundSync(context, antigravityPath, state);

        // Check if distillation milestone reached
        if (autoDistillEnabled) {
            checkDistillMilestone(context, antigravityPath, state, distillThreshold);
        }
    }, 30_000);

    // Schedule periodic sync
    syncTimer = setInterval(() => {
        runBackgroundSync(context, antigravityPath, state);
    }, intervalMs);

    context.subscriptions.push({
        dispose: () => {
            if (syncTimer) { clearInterval(syncTimer); }
            clearTimeout(startupDelay);
        }
    });
}

function updateStatusBar(status: 'idle' | 'syncing' | 'done' | 'error') {
    switch (status) {
        case 'idle':
            statusBarItem.text = '$(cloud) Antigravity';
            statusBarItem.tooltip = vscode.l10n.t('Auto-sync active. Click to sync now.');
            break;
        case 'syncing':
            statusBarItem.text = '$(sync~spin) Syncing...';
            statusBarItem.tooltip = vscode.l10n.t('Syncing brain...');
            break;
        case 'done':
            statusBarItem.text = '$(cloud) Antigravity ✓';
            statusBarItem.tooltip = vscode.l10n.t('Last sync: {0}', new Date().toLocaleTimeString());
            setTimeout(() => updateStatusBar('idle'), 10_000);
            break;
        case 'error':
            statusBarItem.text = '$(cloud) Antigravity ✗';
            statusBarItem.tooltip = vscode.l10n.t('Sync failed. Click to retry.');
            break;
    }
    statusBarItem.show();
}

let consecutiveFailures = 0;

function runBackgroundSync(
    context: vscode.ExtensionContext,
    antigravityPath: string,
    state: AutoSyncState
) {
    const scriptPath = path.join(antigravityPath, 'skills', 'memory-sync', 'scripts', 'sync.ps1');
    if (!fs.existsSync(scriptPath)) { return; }

    // Check if config exists (skip sync if not configured — avoids useless pwsh process)
    const configPath = path.join(antigravityPath, 'skills', 'memory-sync', 'config.json');
    if (!fs.existsSync(configPath)) {
        console.log('Antigravity: Skipping background sync — no config.json (run Setup first)');
        return;
    }

    updateStatusBar('syncing');

    // Run sync silently in background (no terminal popup)
    const child = cp.spawn('pwsh.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-Direction', 'both'
    ], {
        cwd: path.dirname(scriptPath),
        stdio: 'pipe',
        windowsHide: true
    });

    let output = '';
    child.stdout?.on('data', (data) => { output += data.toString(); });
    child.stderr?.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
        if (code === 0) {
            updateStatusBar('done');
            state.lastSyncTime = Date.now();
            context.globalState.update(STATE_KEY, state);
            consecutiveFailures = 0;
            console.log('Antigravity: Background sync completed');
        } else {
            updateStatusBar('error');
            consecutiveFailures++;
            console.error(`Antigravity: Sync failed (code ${code}, attempt ${consecutiveFailures})\n${output.substring(0, 300)}`);

            // After 3 consecutive failures, notify user
            if (consecutiveFailures === 3) {
                vscode.window.showWarningMessage(
                    vscode.l10n.t('Antigravity sync has failed 3 times. Check your network or re-run Setup.'),
                    'Run Setup',
                    'Retry Now'
                ).then(choice => {
                    if (choice === 'Run Setup') {
                        vscode.commands.executeCommand('antigravity.setupSync');
                    } else if (choice === 'Retry Now') {
                        vscode.commands.executeCommand('antigravity.syncMemory');
                    }
                });
            }
        }
    });
}

function checkDistillMilestone(
    context: vscode.ExtensionContext,
    antigravityPath: string,
    state: AutoSyncState,
    threshold: number
) {
    const brainDir = path.join(antigravityPath, 'brain');
    if (!fs.existsSync(brainDir)) { return; }

    // Count conversations with walkthrough (= completed work)
    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    let completedConvs = 0;
    for (const dir of dirs) {
        const walkthroughPath = path.join(brainDir, dir.name, 'walkthrough.md');
        if (fs.existsSync(walkthroughPath)) {
            completedConvs++;
        }
    }

    const newConvsSinceLastDistill = completedConvs - state.lastDistillConvCount;

    if (newConvsSinceLastDistill >= threshold) {
        // Milestone reached! Suggest distillation
        vscode.window.showInformationMessage(
            vscode.l10n.t(
                '🧬 You\'ve completed {0} new conversations since last distillation. Distill now?',
                newConvsSinceLastDistill
            ),
            vscode.l10n.t('Distill Now'),
            vscode.l10n.t('Later')
        ).then(action => {
            if (action === vscode.l10n.t('Distill Now')) {
                vscode.commands.executeCommand('antigravity.distillBrain');
                state.lastDistillConvCount = completedConvs;
                context.globalState.update(STATE_KEY, state);
            }
        });
    }
}

export function stopAutoScheduler() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = undefined;
    }
}
