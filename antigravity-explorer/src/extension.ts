import * as vscode from 'vscode';
import { SkillsTreeProvider } from './providers/skillsTreeProvider';
import { BrainTreeProvider } from './providers/brainTreeProvider';
import { SyncTreeProvider } from './providers/syncTreeProvider';
import { ProjectTreeProvider } from './providers/projectTreeProvider';
import { AgentTreeProvider } from './providers/agentTreeProvider';
import { DashboardPanel } from './webview/dashboard';
import { createBrainDashboard } from './webview/brainDashboard';
import { AgentOfficePanel } from './webview/agentOffice';
import { distillBrain } from './commands/distillCommand';
import { runSyncCommand } from './commands/syncCommands';
import { ensureScriptsInstalled, runSetupCommand } from './commands/setupCommand';
import { scanProjects, setGitLabToken, discoverGitLabProjects, cloneProject } from './commands/projectCommands';
import { generateAgent } from './commands/generateAgentCommand';
import { pullAllRepos } from './commands/gitCommands';
import { startAutoScheduler, stopAutoScheduler } from './autoScheduler';

export function activate(context: vscode.ExtensionContext) {
    console.log('Antigravity Explorer is now active');

    const antigravityPath = getAntigravityPath();
    if (!antigravityPath) {
        vscode.window.showWarningMessage(
            vscode.l10n.t('Antigravity directory not found. Expected at ~/.gemini/antigravity/')
        );
        return;
    }

    // ── TreeView Providers ────────────────────────────────────
    const skillsProvider = new SkillsTreeProvider(antigravityPath);
    const brainProvider = new BrainTreeProvider(antigravityPath);
    const syncProvider = new SyncTreeProvider(antigravityPath);
    const projectProvider = new ProjectTreeProvider(antigravityPath);
    const agentProvider = new AgentTreeProvider(antigravityPath);

    vscode.window.registerTreeDataProvider('antigravity-skills', skillsProvider);
    vscode.window.registerTreeDataProvider('antigravity-brain', brainProvider);
    vscode.window.registerTreeDataProvider('antigravity-sync', syncProvider);
    vscode.window.registerTreeDataProvider('antigravity-projects', projectProvider);
    vscode.window.registerTreeDataProvider('antigravity-agents', agentProvider);

    // ── Auto-install bundled scripts ─────────────────────────
    ensureScriptsInstalled(context, antigravityPath);

    // ── Watch config.json for changes (auto-refresh after setup) ──
    const configPattern = new vscode.RelativePattern(
        vscode.Uri.file(require('path').join(antigravityPath, 'skills', 'memory-sync')),
        'config.json'
    );
    const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
    configWatcher.onDidCreate(() => syncProvider.refresh());
    configWatcher.onDidChange(() => syncProvider.refresh());
    context.subscriptions.push(configWatcher);

    // ── Watch agents-registry.json for changes (auto-refresh sidebar) ──
    const agentsPattern = new vscode.RelativePattern(
        vscode.Uri.file(require('path').join(antigravityPath, 'agents')),
        'agents-registry.json'
    );
    const agentsWatcher = vscode.workspace.createFileSystemWatcher(agentsPattern);
    agentsWatcher.onDidCreate(() => agentProvider.refresh());
    agentsWatcher.onDidChange(() => agentProvider.refresh());
    context.subscriptions.push(agentsWatcher);

    // ── Commands ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.refresh', () => {
            skillsProvider.refresh();
            brainProvider.refresh();
            syncProvider.refresh();
            projectProvider.refresh();
            agentProvider.refresh();
            vscode.window.showInformationMessage(vscode.l10n.t('Antigravity Explorer refreshed'));
        }),

        vscode.commands.registerCommand('antigravity.openDashboard', () => {
            DashboardPanel.createOrShow(context, antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.setupSync', () => {
            runSetupCommand(context, antigravityPath, () => syncProvider.refresh());
        }),

        vscode.commands.registerCommand('antigravity.syncMemory', () => {
            runSyncCommand('both', antigravityPath, context);
        }),

        vscode.commands.registerCommand('antigravity.exportMemory', () => {
            runSyncCommand('export', antigravityPath, context);
        }),

        vscode.commands.registerCommand('antigravity.importMemory', () => {
            runSyncCommand('import', antigravityPath, context);
        }),

        vscode.commands.registerCommand('antigravity.openFile', (uri: vscode.Uri) => {
            vscode.window.showTextDocument(uri);
        }),

        vscode.commands.registerCommand('antigravity.openBrainDashboard', () => {
            createBrainDashboard(context, antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.distillBrain', () => {
            distillBrain(context, antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.openAgentOffice', () => {
            AgentOfficePanel.createOrShow(context, antigravityPath);
            agentProvider.refresh();
        }),

        vscode.commands.registerCommand('antigravity.generateAgent', () => {
            generateAgent(antigravityPath).then(() => agentProvider.refresh());
        }),

        vscode.commands.registerCommand('antigravity.scanProjects', () => {
            scanProjects(antigravityPath).then(() => projectProvider.refresh());
        }),

        vscode.commands.registerCommand('antigravity.setGitLabToken', () => {
            setGitLabToken(context, antigravityPath);
        }),

        vscode.commands.registerCommand('antigravity.discoverGitLabProjects', () => {
            discoverGitLabProjects(context, antigravityPath).then(() => projectProvider.refresh());
        }),

        vscode.commands.registerCommand('antigravity.cloneProject', (project) => {
            cloneProject(context, antigravityPath, project).then(() => projectProvider.refresh());
        }),

        vscode.commands.registerCommand('antigravity.pullAllRepos', () => {
            pullAllRepos();
        }),

        vscode.commands.registerCommand('antigravity.openProjectFolder', (project) => {
            if (project && project.localPaths && project.localPaths.length > 0) {
                const folderPath = project.localPaths.find((p: string) => require('fs').existsSync(p));
                if (folderPath) {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), true);
                }
            }
        })
    );

    // Start background auto-sync & distill scheduler
    startAutoScheduler(context, antigravityPath);
}

export function deactivate() {
    stopAutoScheduler();
}

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
