import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly antigravityPath: string;
    private disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext, antigravityPath: string) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal(column);
            DashboardPanel.currentPanel.update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'antigravityDashboard',
            '🧩 Antigravity Dashboard',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, antigravityPath);
    }

    private constructor(panel: vscode.WebviewPanel, antigravityPath: string) {
        this.panel = panel;
        this.antigravityPath = antigravityPath;

        this.update();

        this.panel.onDidDispose(() => {
            DashboardPanel.currentPanel = undefined;
            this.disposables.forEach(d => d.dispose());
        }, null, this.disposables);
    }

    private update() {
        const skills = this.getSkillsData();
        const brain = this.getBrainData();
        this.panel.webview.html = this.getHtml(skills, brain);
    }

    private getSkillsData(): { name: string; description: string; source?: string; dir: string }[] {
        const skillsDir = path.join(this.antigravityPath, 'skills');
        if (!fs.existsSync(skillsDir)) { return []; }

        return fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(dir => {
                const mdPath = path.join(skillsDir, dir.name, 'SKILL.md');
                const meta = this.parseSkillFrontmatter(mdPath);
                return { name: meta.name || dir.name, description: meta.description || '', source: meta.source, dir: dir.name };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private getBrainData(): { id: string; title: string; date: string; artifacts: string[] }[] {
        const brainDir = path.join(this.antigravityPath, 'brain');
        if (!fs.existsSync(brainDir)) { return []; }

        return fs.readdirSync(brainDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'tempmediaStorage' && !d.name.startsWith('.'))
            .map(dir => {
                const dirPath = path.join(brainDir, dir.name);
                const metaFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.metadata.json'));
                let latestDate = '';
                let title = dir.name.substring(0, 8);
                const artifacts: string[] = [];

                for (const mf of metaFiles) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, mf), 'utf-8'));
                        artifacts.push(mf.replace('.metadata.json', ''));
                        if (!latestDate || meta.updatedAt > latestDate) {
                            latestDate = meta.updatedAt;
                        }
                        if (meta.artifactType === 'ARTIFACT_TYPE_TASK' && meta.summary) {
                            title = meta.summary.split('\n')[0].substring(0, 50);
                        }
                    } catch { /* skip */ }
                }

                return { id: dir.name, title, date: latestDate, artifacts };
            })
            .filter(b => b.artifacts.length > 0)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 20); // Show top 20 recent
    }

    private parseSkillFrontmatter(filePath: string): { name?: string; description?: string; source?: string } {
        if (!fs.existsSync(filePath)) { return {}; }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!match) { return {}; }
            const fm = match[1];
            const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
            const desc = fm.match(/^description:\s*['"]?([\s\S]*?)['"]?\s*(?=\n\w|\n---|\n$)/m)?.[1]?.trim().replace(/\n\s*/g, ' ');
            const source = fm.match(/^source:\s*(.+)$/m)?.[1]?.trim();
            return { name, description: desc, source };
        } catch { return {}; }
    }

    private getHtml(
        skills: { name: string; description: string; source?: string; dir: string }[],
        brain: { id: string; title: string; date: string; artifacts: string[] }[]
    ): string {
        const skillCards = skills.map(s => `
            <div class="card skill-card">
                <div class="card-header">
                    <span class="card-icon">🔧</span>
                    <span class="card-title">${this.escapeHtml(s.name)}</span>
                    ${s.source ? `<span class="badge">${this.escapeHtml(s.source)}</span>` : ''}
                </div>
                <p class="card-desc">${this.escapeHtml(s.description || 'No description')}</p>
                <div class="card-footer">${this.escapeHtml(s.dir)}</div>
            </div>
        `).join('');

        const brainItems = brain.map(b => {
            const dateStr = b.date ? new Date(b.date).toLocaleDateString('zh-TW') : 'Unknown';
            const artifactBadges = b.artifacts.map(a =>
                `<span class="artifact-badge">${this.escapeHtml(a.replace('.md', ''))}</span>`
            ).join('');
            return `
            <div class="card brain-card">
                <div class="card-header">
                    <span class="card-icon">🧠</span>
                    <span class="card-title">${this.escapeHtml(b.title)}</span>
                    <span class="date">${dateStr}</span>
                </div>
                <div class="artifacts">${artifactBadges}</div>
                <div class="card-footer">${b.id.substring(0, 8)}</div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Dashboard</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --card-bg: var(--vscode-editorWidget-background);
            --card-border: var(--vscode-widget-border);
            --accent: var(--vscode-textLink-foreground);
            --badge-bg: var(--vscode-badge-background);
            --badge-fg: var(--vscode-badge-foreground);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--bg);
            color: var(--fg);
            padding: 20px 24px;
        }
        h1 { font-size: 1.6em; margin-bottom: 4px; }
        .subtitle { opacity: 0.6; margin-bottom: 24px; font-size: 0.9em; }
        .stats {
            display: flex; gap: 16px; margin-bottom: 28px;
        }
        .stat-box {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 16px 24px;
            text-align: center;
            flex: 1;
        }
        .stat-number { font-size: 2em; font-weight: bold; color: var(--accent); }
        .stat-label { opacity: 0.7; font-size: 0.85em; margin-top: 4px; }

        h2 { font-size: 1.2em; margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; }
        .section-count { opacity: 0.5; font-size: 0.8em; }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 14px 16px;
            transition: border-color 0.2s;
        }
        .card:hover { border-color: var(--accent); }
        .card-header {
            display: flex; align-items: center; gap: 8px;
            margin-bottom: 8px;
        }
        .card-icon { font-size: 1.1em; }
        .card-title { font-weight: 600; flex: 1; font-size: 0.95em; }
        .card-desc {
            opacity: 0.75; font-size: 0.82em; line-height: 1.4;
            display: -webkit-box; -webkit-line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden;
        }
        .card-footer {
            margin-top: 8px; font-size: 0.75em; opacity: 0.4;
            font-family: var(--vscode-editor-font-family);
        }
        .badge {
            background: var(--badge-bg); color: var(--badge-fg);
            padding: 2px 8px; border-radius: 10px; font-size: 0.72em;
        }
        .date { font-size: 0.78em; opacity: 0.5; }
        .artifacts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .artifact-badge {
            background: var(--badge-bg); color: var(--badge-fg);
            padding: 1px 6px; border-radius: 4px; font-size: 0.7em;
        }
    </style>
</head>
<body>
    <h1>🧩 Antigravity Explorer</h1>
    <p class="subtitle">Your AI coding assistant memory at a glance</p>

    <div class="stats">
        <div class="stat-box">
            <div class="stat-number">${skills.length}</div>
            <div class="stat-label">Skills Installed</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${brain.length}</div>
            <div class="stat-label">Conversations</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${brain.reduce((s, b) => s + b.artifacts.length, 0)}</div>
            <div class="stat-label">Artifacts</div>
        </div>
    </div>

    <h2>🔧 Skills <span class="section-count">(${skills.length})</span></h2>
    <div class="grid">${skillCards}</div>

    <h2>🧠 Recent Brain Activity <span class="section-count">(${brain.length})</span></h2>
    <div class="grid">${brainItems}</div>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
