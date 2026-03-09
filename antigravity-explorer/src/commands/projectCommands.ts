import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as https from 'https';
import * as http from 'http';

// ── Types ────────────────────────────────────────────────────

export interface ProjectEntry {
    name: string;
    description: string;
    techStack: string[];
    gitUrl: string;
    localPaths: string[];
    tags: string[];
    relatedProjects: string[];
}

export interface ProjectRegistry {
    version: number;
    lastScan: string;
    gitlab?: {
        url: string;
        groups?: string[];
    };
    projects: ProjectEntry[];
}

// ── Paths ────────────────────────────────────────────────────

function getRegistryPath(antigravityPath: string): string {
    return path.join(antigravityPath, 'projects', 'registry.json');
}

export function loadRegistry(antigravityPath: string): ProjectRegistry {
    const registryPath = getRegistryPath(antigravityPath);
    if (fs.existsSync(registryPath)) {
        try {
            return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
        } catch { /* fall through */ }
    }
    return { version: 1, lastScan: '', projects: [] };
}

function saveRegistry(antigravityPath: string, registry: ProjectRegistry) {
    const registryPath = getRegistryPath(antigravityPath);
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

// ── Auto-Scan ────────────────────────────────────────────────

function detectTechStack(projectPath: string): string[] {
    const stack: string[] = [];
    // Node.js / package.json
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (allDeps['vue'] || allDeps['@vue/cli-service']) { stack.push('Vue.js'); }
            if (allDeps['react']) { stack.push('React'); }
            if (allDeps['vite']) { stack.push('Vite'); }
            if (allDeps['express']) { stack.push('Express.js'); }
            if (allDeps['typescript']) { stack.push('TypeScript'); }
            if (allDeps['chart.js']) { stack.push('Chart.js'); }
            if (allDeps['mssql'] || allDeps['tedious']) { stack.push('MSSQL'); }
            if (allDeps['@vscode/vsce']) { stack.push('VS Code Extension'); }
            if (stack.length === 0) { stack.push('Node.js'); }
        } catch { stack.push('Node.js'); }
    }
    // .NET / C#
    const csprojFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.csproj') || f.endsWith('.sln'));
    if (csprojFiles.length > 0) {
        stack.push('C#/.NET');
        // Check for WinForms/WPF
        for (const f of csprojFiles) {
            if (f.endsWith('.csproj')) {
                try {
                    const content = fs.readFileSync(path.join(projectPath, f), 'utf-8');
                    if (content.includes('WindowsForms') || content.includes('WinForms')) { stack.push('WinForms'); }
                    if (content.includes('WPF')) { stack.push('WPF'); }
                    if (content.includes('AspNetCore') || content.includes('Microsoft.NET.Sdk.Web')) { stack.push('ASP.NET Core'); }
                } catch { /* ignore */ }
            }
        }
    }
    // Python
    if (fs.existsSync(path.join(projectPath, 'requirements.txt')) || fs.existsSync(path.join(projectPath, 'setup.py'))) {
        stack.push('Python');
    }
    return stack;
}

function getGitRemoteUrl(projectPath: string): string {
    try {
        const result = cp.execSync('git remote get-url origin', {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return result.trim();
    } catch {
        return '';
    }
}

function getDescription(projectPath: string): string {
    // Try package.json description
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.description) { return pkg.description; }
        } catch { /* ignore */ }
    }
    // Try README first line
    const readmePath = path.join(projectPath, 'README.md');
    if (fs.existsSync(readmePath)) {
        try {
            const lines = fs.readFileSync(readmePath, 'utf-8').split('\n');
            for (const line of lines) {
                const stripped = line.replace(/^#+\s*/, '').trim();
                if (stripped && stripped.length > 5) { return stripped.substring(0, 200); }
            }
        } catch { /* ignore */ }
    }
    return '';
}

/**
 * Scan workspace for projects and update the registry.
 */
export async function scanProjects(antigravityPath: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
    }

    const registry = loadRegistry(antigravityPath);
    const rootPath = workspaceFolders[0].uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Antigravity: Scanning Projects',
        cancellable: false
    }, async (progress) => {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
        let scanned = 0;

        for (const dir of dirs) {
            const projectPath = path.join(rootPath, dir.name);
            progress.report({ increment: 100 / dirs.length, message: dir.name });

            // Check if it's a recognizable project (has .git, package.json, or .csproj)
            const hasGit = fs.existsSync(path.join(projectPath, '.git'));
            const hasPkg = fs.existsSync(path.join(projectPath, 'package.json'));
            const hasCsproj = fs.readdirSync(projectPath).some(f => f.endsWith('.csproj') || f.endsWith('.sln'));

            if (!hasGit && !hasPkg && !hasCsproj) { continue; }

            // Check if already in registry
            const existing = registry.projects.find(p => p.name === dir.name);
            const gitUrl = hasGit ? getGitRemoteUrl(projectPath) : '';
            const techStack = detectTechStack(projectPath);
            const description = getDescription(projectPath);

            if (existing) {
                // Update existing entry
                if (gitUrl && !existing.gitUrl) { existing.gitUrl = gitUrl; }
                if (techStack.length > 0) { existing.techStack = techStack; }
                if (description && !existing.description) { existing.description = description; }
                if (!existing.localPaths.includes(projectPath)) { existing.localPaths.push(projectPath); }
            } else {
                // Add new entry
                registry.projects.push({
                    name: dir.name,
                    description,
                    techStack,
                    gitUrl,
                    localPaths: [projectPath],
                    tags: [],
                    relatedProjects: []
                });
            }
            scanned++;
        }

        registry.lastScan = new Date().toISOString();
        saveRegistry(antigravityPath, registry);
        vscode.window.showInformationMessage(`Scanned ${scanned} projects. Registry saved.`);
    });
}

// ── GitLab Token ─────────────────────────────────────────────

const GITLAB_TOKEN_KEY = 'antigravity.gitlabToken';
const GITLAB_URL_KEY = 'antigravity.gitlabUrl';

export async function setGitLabToken(context: vscode.ExtensionContext, antigravityPath: string) {
    const registry = loadRegistry(antigravityPath);
    const currentUrl = registry.gitlab?.url || 'https://gitlab.com';

    const url = await vscode.window.showInputBox({
        prompt: 'GitLab URL',
        value: currentUrl,
        placeHolder: 'https://gitlab.com'
    });
    if (!url) { return; }

    const token = await vscode.window.showInputBox({
        prompt: 'GitLab Personal Access Token (scope: read_api, read_repository)',
        password: true,
        placeHolder: 'glpat-xxxxxx'
    });
    if (!token) { return; }

    // Store securely
    await context.secrets.store(GITLAB_TOKEN_KEY, token);
    await context.secrets.store(GITLAB_URL_KEY, url);

    // Update registry
    registry.gitlab = { url, groups: registry.gitlab?.groups };
    saveRegistry(antigravityPath, registry);

    vscode.window.showInformationMessage(`GitLab token saved for ${url}`);
}

// ── GitLab Discover ──────────────────────────────────────────

function gitlabApiGet(baseUrl: string, apiPath: string, token: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const url = new URL(`/api/v4${apiPath}`, baseUrl);
        const mod = url.protocol === 'https:' ? https : http;
        const options = {
            headers: { 'PRIVATE-TOKEN': token },
            rejectUnauthorized: false  // Allow self-signed certs (internal GitLab)
        };
        const req = mod.get(url.toString(), options, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON response')); }
            });
        });
        req.on('error', (err) => reject(new Error(`Connection error: ${err.message}`)));
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout (30s) — check GitLab URL')); });
    });
}

export async function discoverGitLabProjects(context: vscode.ExtensionContext, antigravityPath: string) {
    const token = await context.secrets.get(GITLAB_TOKEN_KEY);
    const gitlabUrl = await context.secrets.get(GITLAB_URL_KEY);

    if (!token || !gitlabUrl) {
        const action = await vscode.window.showWarningMessage(
            'GitLab token not configured.',
            'Set Token'
        );
        if (action === 'Set Token') {
            await setGitLabToken(context, antigravityPath);
        }
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Antigravity: Discovering GitLab Projects',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Fetching projects...' });
            const projects = await gitlabApiGet(gitlabUrl, '/projects?membership=true&per_page=100&order_by=last_activity_at', token);

            const registry = loadRegistry(antigravityPath);
            let added = 0;

            for (const proj of projects) {
                const name = proj.name || proj.path;
                const existing = registry.projects.find(p =>
                    p.name === name || p.gitUrl === proj.http_url_to_repo || p.gitUrl === proj.ssh_url_to_repo
                );

                if (!existing) {
                    registry.projects.push({
                        name,
                        description: proj.description || '',
                        techStack: [],
                        gitUrl: proj.http_url_to_repo || '',
                        localPaths: [],
                        tags: (proj.tag_list || proj.topics || []),
                        relatedProjects: []
                    });
                    added++;
                } else {
                    // Update gitUrl if missing
                    if (!existing.gitUrl && proj.http_url_to_repo) {
                        existing.gitUrl = proj.http_url_to_repo;
                    }
                }
            }

            registry.lastScan = new Date().toISOString();
            saveRegistry(antigravityPath, registry);
            vscode.window.showInformationMessage(`Found ${projects.length} GitLab projects. ${added} new added.`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`GitLab API error: ${err.message}`);
        }
    });
}

// ── Clone ────────────────────────────────────────────────────

export async function cloneProject(context: vscode.ExtensionContext, antigravityPath: string, project?: ProjectEntry) {
    if (!project) {
        // Pick from registry
        const registry = loadRegistry(antigravityPath);
        const uncloned = registry.projects.filter(p => p.gitUrl && p.localPaths.length === 0);
        if (uncloned.length === 0) {
            vscode.window.showInformationMessage('All projects are already cloned locally.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            uncloned.map(p => ({ label: p.name, description: p.gitUrl, project: p })),
            { placeHolder: 'Select a project to clone' }
        );
        if (!picked) { return; }
        project = picked.project;
    }

    // Ask for clone destination
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const defaultDir = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

    const targetFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri: defaultDir ? vscode.Uri.file(defaultDir) : undefined,
        openLabel: 'Clone Here'
    });

    if (!targetFolder || targetFolder.length === 0) { return; }

    const clonePath = path.join(targetFolder[0].fsPath, project.name);

    // Build clone URL with token if available
    let cloneUrl = project.gitUrl;
    const token = await context.secrets.get(GITLAB_TOKEN_KEY);
    if (token && cloneUrl.startsWith('https://')) {
        // Insert token into URL: https://oauth2:TOKEN@gitlab.com/...
        const urlObj = new URL(cloneUrl);
        urlObj.username = 'oauth2';
        urlObj.password = token;
        cloneUrl = urlObj.toString();
    }

    const terminal = vscode.window.createTerminal({ name: `Clone: ${project.name}` });
    terminal.show();
    terminal.sendText(`git clone "${cloneUrl}" "${clonePath}"`);

    // Update registry
    const registry = loadRegistry(antigravityPath);
    const entry = registry.projects.find(p => p.name === project!.name);
    if (entry && !entry.localPaths.includes(clonePath)) {
        entry.localPaths.push(clonePath);
        saveRegistry(antigravityPath, registry);
    }

    vscode.window.showInformationMessage(`Cloning ${project.name}...`);
}
