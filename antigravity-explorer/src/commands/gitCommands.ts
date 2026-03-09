import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

/**
 * Find all git repositories in the given directory (1 level deep).
 */
function findGitRepos(rootPath: string): string[] {
    const repos: string[] = [];
    try {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
            const gitDir = path.join(rootPath, entry.name, '.git');
            if (fs.existsSync(gitDir)) {
                repos.push(path.join(rootPath, entry.name));
            }
        }
    } catch { /* ignore */ }
    return repos;
}

/**
 * Pull all git repos in the current workspace folder.
 */
export async function pullAllRepos() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const repos = findGitRepos(rootPath);

    if (repos.length === 0) {
        vscode.window.showInformationMessage('No git repositories found in workspace.');
        return;
    }

    const total = repos.length;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Antigravity: Pull All Repos',
        cancellable: true
    }, async (progress, token) => {
        let succeeded = 0;
        const errors: string[] = [];
        const failedRepos: { repoPath: string; repoName: string; index: number }[] = [];

        const maxRetries = 3;
        const baseRetryDelayMs = 5000;
        const cooldownBetweenReposMs = 2000;

        /** Pull a single repo with retries + exponential backoff */
        async function pullRepo(repoPath: string, repoName: string, label: string): Promise<boolean> {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        const env = { ...process.env };
                        delete env.HTTP_PROXY;
                        delete env.HTTPS_PROXY;
                        delete env.http_proxy;
                        delete env.https_proxy;

                        cp.exec('git pull', { cwd: repoPath, timeout: 60000, env }, (err, _stdout, stderr) => {
                            if (err) {
                                reject(new Error(stderr || err.message));
                            } else {
                                resolve();
                            }
                        });
                    });
                    return true;
                } catch (err: any) {
                    const msg: string = err.message;
                    const isConnectionError = msg.includes('Could not connect') ||
                        msg.includes('unable to access') ||
                        msg.includes('Failed to connect');
                    if (isConnectionError && attempt < maxRetries) {
                        const delay = baseRetryDelayMs * attempt; // exponential: 5s, 10s
                        progress.report({
                            message: `${label} ${repoName} — retry ${attempt}/${maxRetries - 1} (wait ${delay / 1000}s)`
                        });
                        await new Promise(r => setTimeout(r, delay));
                    } else {
                        errors.push(`${repoName}: ${msg}`);
                        return false;
                    }
                }
            }
            return false;
        }

        // ── Phase 1: Pull all repos with cooldown between each ──
        for (let i = 0; i < repos.length; i++) {
            if (token.isCancellationRequested) { break; }

            const repoPath = repos[i];
            const repoName = path.basename(repoPath);
            progress.report({
                increment: (80 / total),  // reserve 20% for phase 2
                message: `[${i + 1}/${total}] ${repoName}`
            });

            const ok = await pullRepo(repoPath, repoName, `[${i + 1}/${total}]`);
            if (ok) {
                succeeded++;
            } else {
                failedRepos.push({ repoPath, repoName, index: i });
            }

            // Cooldown between repos to avoid connection exhaustion
            if (i < repos.length - 1 && !token.isCancellationRequested) {
                await new Promise(r => setTimeout(r, cooldownBetweenReposMs));
            }
        }

        // ── Phase 2: Retry all failed repos after a longer cooldown ──
        if (failedRepos.length > 0 && !token.isCancellationRequested) {
            progress.report({ message: `Retrying ${failedRepos.length} failed repos in 10s...` });
            await new Promise(r => setTimeout(r, 10000));

            for (let j = 0; j < failedRepos.length; j++) {
                if (token.isCancellationRequested) { break; }
                const { repoPath, repoName } = failedRepos[j];
                progress.report({
                    increment: (20 / failedRepos.length),
                    message: `[retry ${j + 1}/${failedRepos.length}] ${repoName}`
                });

                // Remove the previous error for this repo
                const errIdx = errors.findIndex(e => e.startsWith(`${repoName}:`));
                if (errIdx !== -1) { errors.splice(errIdx, 1); }

                const ok = await pullRepo(repoPath, repoName, `[retry ${j + 1}/${failedRepos.length}]`);
                if (ok) {
                    succeeded++;
                }
                // Cooldown between retry repos
                if (j < failedRepos.length - 1) {
                    await new Promise(r => setTimeout(r, cooldownBetweenReposMs));
                }
            }
        }

        const failed = total - succeeded;
        if (failed === 0) {
            vscode.window.showInformationMessage(`✅ All ${succeeded} repos pulled successfully.`);
        } else {
            vscode.window.showWarningMessage(
                `Pulled ${succeeded}/${total} repos. ${failed} failed.`,
                'Show Errors'
            ).then(choice => {
                if (choice === 'Show Errors') {
                    const channel = vscode.window.createOutputChannel('Antigravity Git');
                    channel.appendLine('=== Pull Errors ===');
                    errors.forEach(e => channel.appendLine(e));
                    channel.show();
                }
            });
        }
    });
}
