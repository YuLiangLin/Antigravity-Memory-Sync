import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface SkillData {
    name: string;
    description: string;
    source?: string;
    dir: string;
    category: string;
    content: string;  // raw SKILL.md content
}

interface BrainItem {
    id: string;
    title: string;
    date: string;
    artifacts: { name: string; type: string; summary: string; content: string }[];
}

interface DistilledItem {
    name: string;
    date: string;
    content: string;
}

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

        DashboardPanel.currentPanel = new DashboardPanel(panel, antigravityPath, context);
    }

    private constructor(panel: vscode.WebviewPanel, antigravityPath: string, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.antigravityPath = antigravityPath;

        this.update();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            (message) => {
                if (message.command === 'openSkillFile') {
                    const filePath = path.join(antigravityPath, 'skills', message.dir, 'SKILL.md');
                    if (fs.existsSync(filePath)) {
                        vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true });
                    }
                } else if (message.command === 'openBrainFile') {
                    const filePath = path.join(antigravityPath, 'brain', message.conversationId, message.fileName);
                    if (fs.existsSync(filePath)) {
                        vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true });
                    }
                } else if (message.command === 'openDistilledFile') {
                    const filePath = path.join(antigravityPath, 'distilled', message.fileName);
                    if (fs.existsSync(filePath)) {
                        vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true });
                    }
                } else if (message.command === 'previewMarkdown') {
                    let filePath: string;
                    if (message.isSkill) {
                        filePath = path.join(antigravityPath, 'skills', message.dir, 'SKILL.md');
                    } else if (message.isDistilled) {
                        filePath = path.join(antigravityPath, 'distilled', message.fileName);
                    } else {
                        filePath = path.join(antigravityPath, 'brain', message.conversationId, message.fileName);
                    }
                    if (fs.existsSync(filePath)) {
                        vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
                    }
                } else if (message.command === 'openBrainDashboard') {
                    vscode.commands.executeCommand('antigravity.openBrainDashboard');
                }
            },
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(() => {
            DashboardPanel.currentPanel = undefined;
            this.disposables.forEach(d => d.dispose());
        }, null, this.disposables);
    }

    private update() {
        const skills = this.getSkillsData();
        const brain = this.getBrainData();
        const distilled = this.getDistilledData();
        this.panel.webview.html = this.getHtml(skills, brain, distilled);
    }

    private categorizeSkill(name: string, description: string): string {
        const text = `${name} ${description}`.toLowerCase();
        if (/rs232|serial|webserial|gpib|instrument|hardware|pmm|dicon|lan/.test(text)) return '📡 Hardware';
        if (/vite|spa|html|chart|css|table|frontend|web|browser/.test(text)) return '🌐 Web';
        if (/c#|\.net|nuget|wpf|asp|entity|dapper|backend|api/.test(text)) return '⚙️ Backend';
        if (/memory|sync|brain|knowledge|skill/.test(text)) return '🧠 AI / Memory';
        if (/debug|architect|document|coding.standard|test/.test(text)) return '🛠️ Dev Tools';
        return '📦 Other';
    }

    private getSkillsData(): SkillData[] {
        const skillsDir = path.join(this.antigravityPath, 'skills');
        if (!fs.existsSync(skillsDir)) { return []; }

        return fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(dir => {
                const mdPath = path.join(skillsDir, dir.name, 'SKILL.md');
                const meta = this.parseSkillFrontmatter(mdPath);
                let content = '';
                if (fs.existsSync(mdPath)) {
                    try { content = fs.readFileSync(mdPath, 'utf-8'); } catch { /* skip */ }
                }
                const name = meta.name || dir.name;
                const description = meta.description || '';
                return {
                    name, description, source: meta.source, dir: dir.name,
                    category: this.categorizeSkill(name, description),
                    content
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private getBrainData(): BrainItem[] {
        const brainDir = path.join(this.antigravityPath, 'brain');
        if (!fs.existsSync(brainDir)) { return []; }

        return fs.readdirSync(brainDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'tempmediaStorage' && !d.name.startsWith('.'))
            .map(dir => {
                const dirPath = path.join(brainDir, dir.name);
                const metaFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.metadata.json'));
                let latestDate = '';
                let title = dir.name.substring(0, 8) + '...';
                const artifacts: { name: string; type: string; summary: string; content: string }[] = [];

                for (const mf of metaFiles) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, mf), 'utf-8'));
                        const artName = mf.replace('.metadata.json', '');
                        let content = '';
                        const artPath = path.join(dirPath, artName);
                        if (fs.existsSync(artPath)) {
                            try { content = fs.readFileSync(artPath, 'utf-8'); } catch { /* skip */ }
                        }
                        artifacts.push({ name: artName, type: meta.artifactType || '', summary: meta.summary || '', content });
                        if (!latestDate || meta.updatedAt > latestDate) { latestDate = meta.updatedAt; }
                    } catch { /* skip */ }
                }

                // Smart title: extract from walkthrough/plan H1
                for (const mdFile of ['walkthrough.md', 'implementation_plan.md', 'task.md']) {
                    const mdPath = path.join(dirPath, mdFile);
                    if (fs.existsSync(mdPath)) {
                        try {
                            const c = fs.readFileSync(mdPath, 'utf-8');
                            const h1 = c.match(/^#\s+(.+)/m);
                            if (h1 && h1[1].trim().length > 0) { title = h1[1].trim().substring(0, 60); break; }
                        } catch { /* skip */ }
                    }
                }

                return { id: dir.name, title, date: latestDate, artifacts };
            })
            .filter(b => b.artifacts.length > 0)
            .sort((a, b) => b.date.localeCompare(a.date));
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

    private getDistilledData(): DistilledItem[] {
        const distilledDir = path.join(this.antigravityPath, 'distilled');
        if (!fs.existsSync(distilledDir)) { return []; }
        return fs.readdirSync(distilledDir)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const fp = path.join(distilledDir, f);
                const stat = fs.statSync(fp);
                let content = '';
                try { content = fs.readFileSync(fp, 'utf-8'); } catch { /* skip */ }
                return {
                    name: f,
                    date: stat.mtime.toISOString(),
                    content
                };
            })
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    private getHtml(
        skills: SkillData[],
        brain: BrainItem[],
        distilled: DistilledItem[]
    ): string {
        const skillsJson = JSON.stringify(skills.map(s => ({
            name: s.name, description: s.description, source: s.source || '',
            dir: s.dir, category: s.category, content: s.content
        })));
        const brainJson = JSON.stringify(brain.map(b => ({
            id: b.id, title: b.title, date: b.date,
            artifacts: b.artifacts.map(a => ({ name: a.name, type: a.type, summary: a.summary, content: a.content }))
        })));

        const distilledJson = JSON.stringify(distilled.map(d => ({
            name: d.name, date: d.date, content: d.content
        })));

        const categories = [...new Set(skills.map(s => s.category))].sort();
        const categoriesJson = JSON.stringify(categories);

        const i18n = {
            all: vscode.l10n.t('All'),
            searchSkills: vscode.l10n.t('Search skills...'),
            searchBrain: vscode.l10n.t('Search conversations...'),
            showing: vscode.l10n.t('Showing'),
            conversations: vscode.l10n.t('conversations'),
            skills: vscode.l10n.t('Skills'),
            noResults: vscode.l10n.t('No matching conversations.'),
            noSkillResults: vscode.l10n.t('No matching skills.'),
            viewSource: vscode.l10n.t('View Source'),
            preview: vscode.l10n.t('Preview'),
            back: vscode.l10n.t('Back'),
            today: vscode.l10n.t('Today'),
            yesterday: vscode.l10n.t('Yesterday'),
            daysAgo: vscode.l10n.t('days ago'),
            viewAll: vscode.l10n.t('View all in Brain Dashboard'),
            noArtifacts: vscode.l10n.t('No artifacts in this conversation.'),
            distilledInsights: vscode.l10n.t('Distilled Insights'),
            noDistilled: vscode.l10n.t('No distilled reports yet. Run "Distill Brain" to generate.'),
        };

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
        --card-bg: var(--vscode-sideBar-background, #1e1e2e);
        --card-border: var(--vscode-panel-border, #333);
        --accent: #818cf8;
        --accent2: #06b6d4;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); background: var(--bg); color: var(--fg); padding: 20px 24px; }

    h1 { font-size: 1.6em; margin-bottom: 4px; background: linear-gradient(135deg, #a78bfa, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { opacity: 0.6; margin-bottom: 24px; font-size: 0.9em; }
    .stats { display: flex; gap: 16px; margin-bottom: 28px; }
    .stat-box { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 16px 24px; text-align: center; flex: 1; }
    .stat-number { font-size: 2em; font-weight: bold; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-label { opacity: 0.7; font-size: 0.85em; margin-top: 4px; }

    h2 { font-size: 1.2em; margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; }
    .section-count { opacity: 0.5; font-size: 0.8em; }

    /* ═══ Toolbar ═══ */
    .toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
    .search-input {
        flex: 1; min-width: 180px; padding: 8px 14px; border-radius: 8px;
        border: 1px solid var(--card-border); background: var(--vscode-input-background, #1e1e2e);
        color: var(--vscode-input-foreground, #ccc); font-size: 0.88em; outline: none;
        transition: border-color 0.2s;
    }
    .search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(129,140,248,0.12); }
    .chip-bar { display: flex; gap: 4px; flex-wrap: wrap; }
    .chip {
        padding: 4px 12px; border-radius: 16px; font-size: 0.75em; font-weight: 600;
        border: 1px solid var(--card-border); background: transparent; color: var(--vscode-descriptionForeground);
        cursor: pointer; transition: all 0.2s; white-space: nowrap;
    }
    .chip:hover { border-color: var(--accent); color: var(--fg); }
    .chip.active { background: rgba(129,140,248,0.15); border-color: var(--accent); color: #a5b4fc; }

    .view-toggle { display: flex; gap: 2px; margin-left: auto; }
    .view-btn {
        padding: 5px 10px; border: 1px solid var(--card-border); background: var(--card-bg);
        color: var(--fg); cursor: pointer; font-size: 0.82em; transition: all 0.2s;
    }
    .view-btn:first-child { border-radius: 6px 0 0 6px; }
    .view-btn:last-child { border-radius: 0 6px 6px 0; }
    .view-btn.active { background: rgba(129,140,248,0.15); border-color: var(--accent); color: #a5b4fc; }
    .result-info { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }

    /* ═══ Grid View ═══ */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
    .card {
        background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px;
        padding: 14px 16px; transition: all 0.2s; cursor: pointer; border-left: 3px solid transparent;
    }
    .card:hover { border-color: rgba(129,140,248,0.4); box-shadow: 0 2px 10px rgba(129,140,248,0.08); transform: translateY(-1px); }
    .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .card-icon { font-size: 1em; }
    .card-title { font-weight: 600; flex: 1; font-size: 0.92em; }
    .card-cat { font-size: 0.65em; padding: 2px 7px; border-radius: 10px; background: rgba(129,140,248,0.1); color: #a5b4fc; white-space: nowrap; }
    .card-desc { color: var(--vscode-descriptionForeground); font-size: 0.8em; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-footer { margin-top: 6px; font-size: 0.72em; opacity: 0.35; font-family: monospace; }

    /* ═══ List View ═══ */
    .list-view { display: none; }
    .list-row {
        display: flex; align-items: center; gap: 12px; padding: 10px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.04); cursor: pointer; transition: background 0.15s;
        border-left: 3px solid transparent;
    }
    .list-row:hover { background: rgba(129,140,248,0.04); }
    .list-name { font-weight: 600; font-size: 0.9em; min-width: 160px; }
    .list-desc { flex: 1; font-size: 0.8em; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .list-cat { font-size: 0.7em; padding: 2px 8px; border-radius: 10px; background: rgba(129,140,248,0.08); color: #a5b4fc; }

    /* ═══ MindMap View ═══ */
    .mindmap-container { display: none; width: 100%; overflow: auto; position: relative; }
    .mindmap-svg { width: 100%; min-height: 400px; }
    .mm-node { cursor: pointer; }
    .mm-node:hover rect { stroke: var(--accent); stroke-width: 2; }
    .mm-node:hover text { fill: var(--fg); }
    .mm-center rect { fill: rgba(129,140,248,0.2); stroke: var(--accent); rx: 12; }
    .mm-center text { fill: #a5b4fc; font-weight: 700; font-size: 14px; }
    .mm-cat rect { fill: rgba(129,140,248,0.08); stroke: var(--card-border); rx: 8; }
    .mm-cat text { fill: #a5b4fc; font-weight: 600; font-size: 12px; }
    .mm-skill rect { fill: var(--card-bg); stroke: var(--card-border); rx: 6; }
    .mm-skill text { fill: var(--vscode-descriptionForeground); font-size: 11px; }
    .mm-line { stroke: var(--card-border); stroke-width: 1.5; fill: none; opacity: 0.5; }

    /* ═══ Detail Overlay ═══ */
    .detail-overlay {
        display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--bg); z-index: 100; overflow-y: auto; padding: 24px;
    }
    .detail-overlay.open { display: block; }
    .detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--card-border); }
    .back-btn {
        padding: 6px 16px; border-radius: 6px; border: 1px solid var(--card-border);
        background: var(--card-bg); color: var(--fg); cursor: pointer; font-size: 0.85em; transition: all 0.2s;
    }
    .back-btn:hover { border-color: var(--accent); background: rgba(129,140,248,0.1); }
    .detail-title { font-size: 1.3em; font-weight: 600; flex: 1; }
    .detail-actions { display: flex; gap: 8px; margin-bottom: 16px; }
    .action-btn {
        padding: 5px 12px; border-radius: 6px; font-size: 0.78em;
        border: 1px solid var(--card-border); background: var(--card-bg); color: var(--fg);
        cursor: pointer; transition: all 0.2s;
    }
    .action-btn:hover { border-color: var(--accent); background: rgba(129,140,248,0.1); }
    .artifact-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--card-border); }
    .artifact-tab {
        padding: 8px 16px; font-size: 0.85em; font-weight: 600; border: none;
        background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer;
        border-bottom: 2px solid transparent; transition: all 0.2s; margin-bottom: -1px;
    }
    .artifact-tab:hover { color: var(--fg); }
    .artifact-tab.active { color: #a5b4fc; border-bottom-color: var(--accent); }
    .md-preview {
        background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px;
        padding: 24px; line-height: 1.7; font-size: 0.92em;
    }
    .md-preview h1 { font-size: 1.5em; margin: 0.8em 0 0.4em; color: #a5b4fc; border-bottom: 1px solid var(--card-border); padding-bottom: 6px; }
    .md-preview h2 { font-size: 1.25em; margin: 0.8em 0 0.3em; color: #7dd3fc; }
    .md-preview h3 { font-size: 1.1em; margin: 0.6em 0 0.3em; color: #86efac; }
    .md-preview h4 { font-size: 1em; margin: 0.5em 0 0.2em; color: #fbbf24; }
    .md-preview p { margin: 0.5em 0; }
    .md-preview ul, .md-preview ol { margin: 0.4em 0 0.4em 1.5em; }
    .md-preview li { margin: 0.2em 0; }
    .md-preview code { background: rgba(129,140,248,0.1); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
    .md-preview pre { background: rgba(0,0,0,0.3); padding: 12px 16px; border-radius: 6px; overflow-x: auto; margin: 0.6em 0; }
    .md-preview pre code { background: none; padding: 0; }
    .md-preview blockquote { border-left: 3px solid var(--accent); padding: 4px 12px; margin: 0.5em 0; color: var(--vscode-descriptionForeground); }
    .md-preview hr { border: none; border-top: 1px solid var(--card-border); margin: 1em 0; }
    .md-preview strong { color: var(--fg); }
    .md-preview table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
    .md-preview th, .md-preview td { border: 1px solid var(--card-border); padding: 6px 10px; text-align: left; }
    .md-preview th { background: rgba(129,140,248,0.08); }

    /* ═══ Brain section ═══ */
    .brain-card { border-left-color: rgba(129,140,248,0.3); }
    .brain-card .art-badges { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
    .art-badge { font-size: 0.65em; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
    .art-badge.task { background: rgba(99,102,241,0.15); color: #a5b4fc; }
    .art-badge.plan { background: rgba(14,165,233,0.12); color: #7dd3fc; }
    .art-badge.walk { background: rgba(34,197,94,0.12); color: #86efac; }
    .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 12px; }
    .page-btn {
        padding: 4px 12px; border-radius: 6px; border: 1px solid var(--card-border);
        background: var(--card-bg); color: var(--fg); cursor: pointer; font-size: 0.8em; transition: all 0.2s;
    }
    .page-btn:hover { border-color: var(--accent); }
    .page-btn.active { background: rgba(129,140,248,0.15); border-color: var(--accent); }
    .page-btn:disabled { opacity: 0.3; cursor: default; }
    .no-results { text-align: center; padding: 24px; color: var(--vscode-descriptionForeground); font-size: 0.88em; }
    .view-all-link { display: inline-block; margin-top: 8px; color: var(--accent); font-size: 0.85em; cursor: pointer; text-decoration: none; }
    .view-all-link:hover { text-decoration: underline; }

    /* Category colors for left border */
    .cat-hardware { border-left-color: #f97316 !important; }
    .cat-web { border-left-color: #06b6d4 !important; }
    .cat-backend { border-left-color: #8b5cf6 !important; }
    .cat-ai { border-left-color: #ec4899 !important; }
    .cat-devtools { border-left-color: #22c55e !important; }
    .cat-other { border-left-color: #6b7280 !important; }
</style>
</head>
<body>
    <div id="mainView">
    <h1>🧩 Antigravity Explorer</h1>
    <p class="subtitle">${vscode.l10n.t('Antigravity Overview')}</p>

    <div class="stats">
        <div class="stat-box"><div class="stat-number">${skills.length}</div><div class="stat-label">${vscode.l10n.t('Skills')}</div></div>
        <div class="stat-box"><div class="stat-number">${brain.length}</div><div class="stat-label">${vscode.l10n.t('Conversations')}</div></div>
        <div class="stat-box"><div class="stat-number">${brain.reduce((s, b) => s + b.artifacts.length, 0)}</div><div class="stat-label">${vscode.l10n.t('Total Artifacts')}</div></div>
        <div class="stat-box"><div class="stat-number">${distilled.length}</div><div class="stat-label">${vscode.l10n.t('Distilled Insights')}</div></div>
    </div>

    <h2>🔧 ${vscode.l10n.t('Skills')} <span class="section-count">(${skills.length})</span></h2>

    <!-- Skills toolbar -->
    <div class="toolbar" id="skillsToolbar">
        <input type="text" class="search-input" id="skillSearch" placeholder="${i18n.searchSkills}" />
        <div class="chip-bar" id="categoryChips"></div>
        <div class="view-toggle">
            <button class="view-btn active" data-view="grid" title="Grid">▦</button>
            <button class="view-btn" data-view="list" title="List">☰</button>
            <button class="view-btn" data-view="mindmap" title="MindMap">🕸</button>
        </div>
    </div>
    <div class="result-info" id="skillResultInfo"></div>

    <div class="grid" id="skillGrid"></div>
    <div class="list-view" id="skillList"></div>
    <div class="mindmap-container" id="mindmapContainer"></div>

    <h2>🧠 ${vscode.l10n.t('Brain Conversations')} <span class="section-count">(${brain.length})</span></h2>
    <div class="toolbar" id="brainToolbar">
        <input type="text" class="search-input" id="brainSearch" placeholder="${i18n.searchBrain}" />
    </div>
    <div class="result-info" id="brainResultInfo"></div>
    <div class="grid" id="brainGrid"></div>
    <div class="pagination" id="brainPagination"></div>
    <div style="text-align:center;margin-top:8px"><span class="view-all-link" id="viewAllBrain">📊 ${i18n.viewAll}</span></div>

    <h2>✨ ${i18n.distilledInsights} <span class="section-count">(${distilled.length})</span></h2>
    <div class="grid" id="distilledGrid"></div>
    </div>

    <!-- Detail Overlay -->
    <div class="detail-overlay" id="detailOverlay">
        <div class="detail-header">
            <button class="back-btn" id="backBtn">← ${i18n.back}</button>
            <div class="detail-title" id="detailTitle"></div>
        </div>
        <div class="artifact-tabs" id="artifactTabs"></div>
        <div class="detail-actions" id="detailActions"></div>
        <div class="md-preview" id="mdPreview"></div>
    </div>

<script>
(function() {
    const skills = ${skillsJson};
    const brain = ${brainJson};
    const distilled = ${distilledJson};
    const categories = ${categoriesJson};
    const i18n = ${JSON.stringify(i18n)};
    const vscode = acquireVsCodeApi();
    const BRAIN_PAGE = 20;

    // ─── DOM refs ───
    const skillSearch = document.getElementById('skillSearch');
    const categoryChips = document.getElementById('categoryChips');
    const skillGrid = document.getElementById('skillGrid');
    const skillList = document.getElementById('skillList');
    const skillResultInfo = document.getElementById('skillResultInfo');
    const mindmapContainer = document.getElementById('mindmapContainer');
    const brainSearch = document.getElementById('brainSearch');
    const brainGrid = document.getElementById('brainGrid');
    const brainPagination = document.getElementById('brainPagination');
    const brainResultInfo = document.getElementById('brainResultInfo');
    const detailOverlay = document.getElementById('detailOverlay');
    const detailTitle = document.getElementById('detailTitle');
    const artifactTabs = document.getElementById('artifactTabs');
    const detailActions = document.getElementById('detailActions');
    const mdPreview = document.getElementById('mdPreview');
    const mainView = document.getElementById('mainView');

    let skillFilter = 'all';
    let skillQuery = '';
    let currentView = 'grid';
    let brainQuery = '';
    let brainPage = 1;

    // ─── Helpers ───
    function escapeHtml(s) { const el = document.createElement('span'); el.textContent = s; return el.innerHTML; }
    function relativeDate(iso) {
        if (!iso) return '';
        const d = new Date(iso), diff = Math.floor((Date.now() - d) / 86400000);
        if (diff === 0) return i18n.today;
        if (diff === 1) return i18n.yesterday;
        if (diff < 30) return diff + ' ' + i18n.daysAgo;
        return d.toLocaleDateString();
    }
    function catClass(cat) {
        if (cat.includes('Hardware')) return 'cat-hardware';
        if (cat.includes('Web')) return 'cat-web';
        if (cat.includes('Backend')) return 'cat-backend';
        if (cat.includes('AI')) return 'cat-ai';
        if (cat.includes('Dev')) return 'cat-devtools';
        return 'cat-other';
    }
    function renderMarkdown(md) {
        if (!md) return '<p style="opacity:0.5">—</p>';
        let h = md;
        h = h.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        h = h.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_, c) => '<pre><code>' + c.trim() + '</code></pre>');
        h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        h = h.replace(/^---+$/gm, '<hr>');
        h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        h = h.replace(/^\\s*- \\[x\\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>');
        h = h.replace(/^\\s*- \\[ \\] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>');
        h = h.replace(/^\\s*[-*] (.+)$/gm, '<li>$1</li>');
        h = h.replace(/(<li>.*?<\\/li>\\n?)+/g, '<ul>$&</ul>');
        h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        h = h.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
        h = h.replace(/^(?!<[hupblo]|<li|<hr|<pre|<code|<blockquote)(.+)$/gm, '<p>$1</p>');
        return h;
    }

    // ─── Category chips ───
    categoryChips.innerHTML = '<button class="chip active" data-cat="all">' + i18n.all + '</button>' +
        categories.map(c => '<button class="chip" data-cat="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>').join('');

    // ─── Filter skills ───
    function filteredSkills() {
        return skills.filter(s => {
            if (skillFilter !== 'all' && s.category !== skillFilter) return false;
            if (skillQuery) {
                const q = skillQuery.toLowerCase();
                if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q) && !s.content.toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }

    // ─── Render Skills ───
    function renderSkills() {
        const filtered = filteredSkills();
        skillResultInfo.textContent = (skillQuery || skillFilter !== 'all')
            ? i18n.showing + ' ' + filtered.length + ' / ' + skills.length + ' ' + i18n.skills
            : '';

        // Grid
        if (filtered.length === 0) {
            skillGrid.innerHTML = '<div class="no-results">' + i18n.noSkillResults + '</div>';
            skillList.innerHTML = '';
        } else {
            skillGrid.innerHTML = filtered.map(s =>
                '<div class="card ' + catClass(s.category) + '" data-skill-dir="' + escapeHtml(s.dir) + '">' +
                '<div class="card-header">' +
                '<span class="card-icon">🔧</span>' +
                '<span class="card-title">' + escapeHtml(s.name) + '</span>' +
                '<span class="card-cat">' + escapeHtml(s.category) + '</span>' +
                '</div>' +
                '<p class="card-desc">' + escapeHtml(s.description || 'No description') + '</p>' +
                '<div class="card-footer">' + escapeHtml(s.dir) + '</div>' +
                '</div>'
            ).join('');

            // List
            skillList.innerHTML = filtered.map(s =>
                '<div class="list-row ' + catClass(s.category) + '" data-skill-dir="' + escapeHtml(s.dir) + '">' +
                '<span class="list-name">🔧 ' + escapeHtml(s.name) + '</span>' +
                '<span class="list-desc">' + escapeHtml(s.description) + '</span>' +
                '<span class="list-cat">' + escapeHtml(s.category) + '</span>' +
                '</div>'
            ).join('');
        }

        renderMindMap(filtered);
    }

    // ─── MindMap SVG ───
    function renderMindMap(filtered) {
        const byCategory = {};
        filtered.forEach(s => {
            if (!byCategory[s.category]) byCategory[s.category] = [];
            byCategory[s.category].push(s);
        });
        const cats = Object.keys(byCategory);
        if (cats.length === 0) { mindmapContainer.innerHTML = '<div class="no-results">' + i18n.noSkillResults + '</div>'; return; }

        const centerX = 450, centerY = 50;
        const catSpacingY = 90;
        const totalHeight = Math.max(400, cats.length * catSpacingY + 120);
        const nodeW = 160, nodeH = 28, catW = 140, catH = 32, centerW = 180, centerH = 36;

        let svg = '<svg class="mindmap-svg" viewBox="0 0 900 ' + totalHeight + '" xmlns="http://www.w3.org/2000/svg">';

        // Center node
        const cy = totalHeight / 2;
        svg += '<g class="mm-node mm-center"><rect x="' + (centerX - centerW/2) + '" y="' + (cy - centerH/2) + '" width="' + centerW + '" height="' + centerH + '"/>';
        svg += '<text x="' + centerX + '" y="' + (cy + 5) + '" text-anchor="middle">🧩 Antigravity Skills</text></g>';

        cats.forEach((cat, ci) => {
            const catY = 60 + ci * catSpacingY + (totalHeight - cats.length * catSpacingY) / 2 - 30;
            const catX = centerX + 220;
            // Line center → category
            svg += '<path class="mm-line" d="M' + (centerX + centerW/2) + ',' + cy + ' C' + (centerX + 140) + ',' + cy + ' ' + (catX - 80) + ',' + (catY) + ' ' + (catX - catW/2) + ',' + catY + '"/>';

            // Category node
            svg += '<g class="mm-node mm-cat" data-cat="' + escapeHtml(cat) + '"><rect x="' + (catX - catW/2) + '" y="' + (catY - catH/2) + '" width="' + catW + '" height="' + catH + '"/>';
            svg += '<text x="' + catX + '" y="' + (catY + 4) + '" text-anchor="middle">' + escapeHtml(cat) + '</text></g>';

            // Skill nodes
            const skillsInCat = byCategory[cat];
            const skillStartY = catY - (skillsInCat.length - 1) * 18;
            skillsInCat.forEach((s, si) => {
                const sx = catX + 180;
                const sy = skillStartY + si * 36;
                svg += '<path class="mm-line" d="M' + (catX + catW/2) + ',' + catY + ' C' + (catX + catW/2 + 40) + ',' + catY + ' ' + (sx - nodeW/2 - 30) + ',' + sy + ' ' + (sx - nodeW/2) + ',' + sy + '"/>';
                svg += '<g class="mm-node mm-skill" data-skill-dir="' + escapeHtml(s.dir) + '"><rect x="' + (sx - nodeW/2) + '" y="' + (sy - nodeH/2) + '" width="' + nodeW + '" height="' + nodeH + '"/>';
                const label = s.name.length > 20 ? s.name.substring(0, 18) + '…' : s.name;
                svg += '<text x="' + sx + '" y="' + (sy + 4) + '" text-anchor="middle">' + escapeHtml(label) + '</text></g>';
            });
        });

        svg += '</svg>';
        mindmapContainer.innerHTML = svg;
    }

    // ─── Switch views ───
    function setView(view) {
        currentView = view;
        document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        skillGrid.style.display = view === 'grid' ? 'grid' : 'none';
        skillList.style.display = view === 'list' ? 'block' : 'none';
        mindmapContainer.style.display = view === 'mindmap' ? 'block' : 'none';
    }

    // ─── Brain ───
    function filteredBrain() {
        if (!brainQuery) return brain;
        const q = brainQuery.toLowerCase();
        return brain.filter(b => b.title.toLowerCase().includes(q) || b.id.includes(q) ||
            b.artifacts.some(a => a.summary.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)));
    }

    function renderBrain() {
        const filtered = filteredBrain();
        const totalPages = Math.max(1, Math.ceil(filtered.length / BRAIN_PAGE));
        if (brainPage > totalPages) brainPage = totalPages;
        const start = (brainPage - 1) * BRAIN_PAGE;
        const page = filtered.slice(start, start + BRAIN_PAGE);

        brainResultInfo.textContent = brainQuery
            ? i18n.showing + ' ' + filtered.length + ' / ' + brain.length + ' ' + i18n.conversations
            : '';

        if (page.length === 0) {
            brainGrid.innerHTML = '<div class="no-results">' + i18n.noResults + '</div>';
        } else {
            brainGrid.innerHTML = page.map(b => {
                const badges = b.artifacts.map(a => {
                    const t = a.type.replace('ARTIFACT_TYPE_','').toLowerCase();
                    const cls = t.includes('walk') ? 'walk' : t.includes('plan') ? 'plan' : 'task';
                    return '<span class="art-badge ' + cls + '">' + a.name.replace('.md','') + '</span>';
                }).join('');
                return '<div class="card brain-card" data-brain-id="' + b.id + '">' +
                    '<div class="card-header"><span class="card-icon">🧠</span>' +
                    '<span class="card-title">' + escapeHtml(b.title) + '</span>' +
                    '<span style="font-size:0.75em;opacity:0.5">' + relativeDate(b.date) + '</span></div>' +
                    '<div class="art-badges">' + badges + '</div>' +
                    '<div class="card-footer">' + b.id.substring(0,8) + '</div></div>';
            }).join('');
        }

        // Pagination
        if (totalPages <= 1) { brainPagination.innerHTML = ''; return; }
        let btns = '<button class="page-btn" ' + (brainPage <= 1 ? 'disabled' : '') + ' data-bpage="' + (brainPage-1) + '">◀</button>';
        for (let p = 1; p <= totalPages; p++) {
            if (totalPages > 7 && p > 3 && p < totalPages - 1 && Math.abs(p - brainPage) > 1) {
                if (p === 4 || p === totalPages - 2) btns += '<span style="opacity:0.4;padding:0 4px">…</span>';
                continue;
            }
            btns += '<button class="page-btn ' + (p === brainPage ? 'active' : '') + '" data-bpage="' + p + '">' + p + '</button>';
        }
        btns += '<button class="page-btn" ' + (brainPage >= totalPages ? 'disabled' : '') + ' data-bpage="' + (brainPage+1) + '">▶</button>';
        brainPagination.innerHTML = btns;
    }

    // ─── Detail view ───
    let detailMode = null; // 'skill' | 'brain'
    let detailData = null;
    let detailArtIdx = 0;

    function openSkillDetail(dir) {
        const skill = skills.find(s => s.dir === dir);
        if (!skill) return;
        detailMode = 'skill';
        detailData = skill;
        detailTitle.textContent = '🔧 ' + skill.name;
        artifactTabs.innerHTML = '';
        detailActions.innerHTML =
            '<button class="action-btn" id="btnSource">📄 ' + i18n.viewSource + '</button>' +
            '<button class="action-btn" id="btnPreview">👁 VS Code ' + i18n.preview + '</button>';
        mdPreview.innerHTML = renderMarkdown(skill.content);
        document.getElementById('btnSource').onclick = () => vscode.postMessage({ command: 'openSkillFile', dir: skill.dir });
        document.getElementById('btnPreview').onclick = () => vscode.postMessage({ command: 'previewMarkdown', isSkill: true, dir: skill.dir });
        mainView.style.display = 'none';
        detailOverlay.classList.add('open');
        window.scrollTo(0, 0);
    }

    function openBrainDetail(id) {
        const item = brain.find(b => b.id === id);
        if (!item) return;
        detailMode = 'brain';
        detailData = item;
        detailArtIdx = 0;
        detailTitle.textContent = '🧠 ' + item.title;
        renderBrainDetail();
        mainView.style.display = 'none';
        detailOverlay.classList.add('open');
        window.scrollTo(0, 0);
    }

    function renderBrainDetail() {
        if (!detailData || !detailData.artifacts || detailData.artifacts.length === 0) {
            artifactTabs.innerHTML = '';
            detailActions.innerHTML = '';
            mdPreview.innerHTML = '<div class="no-results">' + i18n.noArtifacts + '</div>';
            return;
        }
        artifactTabs.innerHTML = detailData.artifacts.map((a, i) =>
            '<button class="artifact-tab ' + (i === detailArtIdx ? 'active' : '') + '" data-aidx="' + i + '">' +
            a.name.replace('.md','') + '</button>'
        ).join('');
        const art = detailData.artifacts[detailArtIdx];
        detailActions.innerHTML =
            '<button class="action-btn" id="btnSource">📄 ' + i18n.viewSource + '</button>' +
            '<button class="action-btn" id="btnPreview">👁 VS Code ' + i18n.preview + '</button>';
        mdPreview.innerHTML = renderMarkdown(art.content);
        document.getElementById('btnSource').onclick = () => vscode.postMessage({ command: 'openBrainFile', conversationId: detailData.id, fileName: art.name });
        document.getElementById('btnPreview').onclick = () => vscode.postMessage({ command: 'previewMarkdown', isSkill: false, conversationId: detailData.id, fileName: art.name });
    }

    function closeDetail() {
        detailOverlay.classList.remove('open');
        mainView.style.display = 'block';
        detailMode = null;
    }

    // ─── Events ───
    skillSearch.addEventListener('input', function() { skillQuery = this.value.trim(); renderSkills(); });
    brainSearch.addEventListener('input', function() { brainQuery = this.value.trim(); brainPage = 1; renderBrain(); });

    categoryChips.addEventListener('click', function(e) {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        document.querySelectorAll('#categoryChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        skillFilter = chip.dataset.cat;
        renderSkills();
    });

    document.querySelector('.view-toggle').addEventListener('click', function(e) {
        const btn = e.target.closest('.view-btn');
        if (btn) setView(btn.dataset.view);
    });

    // Skill clicks (grid, list, mindmap)
    document.addEventListener('click', function(e) {
        const skillEl = e.target.closest('[data-skill-dir]');
        if (skillEl && !detailOverlay.classList.contains('open')) {
            openSkillDetail(skillEl.dataset.skillDir);
            return;
        }
        const brainEl = e.target.closest('[data-brain-id]');
        if (brainEl && !detailOverlay.classList.contains('open')) {
            openBrainDetail(brainEl.dataset.brainId);
            return;
        }
        const distEl = e.target.closest('[data-distilled]');
        if (distEl && !detailOverlay.classList.contains('open')) {
            openDistilledDetail(distEl.dataset.distilled);
            return;
        }
    });

    document.getElementById('backBtn').addEventListener('click', closeDetail);

    artifactTabs.addEventListener('click', function(e) {
        const tab = e.target.closest('.artifact-tab');
        if (tab) { detailArtIdx = parseInt(tab.dataset.aidx); renderBrainDetail(); }
    });

    brainPagination.addEventListener('click', function(e) {
        const btn = e.target.closest('.page-btn');
        if (btn && !btn.disabled) { brainPage = parseInt(btn.dataset.bpage); renderBrain(); brainGrid.scrollIntoView({ behavior: 'smooth' }); }
    });

    document.getElementById('viewAllBrain').addEventListener('click', function() {
        vscode.postMessage({ command: 'openBrainDashboard' });
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && detailOverlay.classList.contains('open')) closeDetail();
    });

    // ─── Distilled ───
    const distilledGrid = document.getElementById('distilledGrid');

    function renderDistilled() {
        if (distilled.length === 0) {
            distilledGrid.innerHTML = '<div class="no-results">' + i18n.noDistilled + '</div>';
            return;
        }
        distilledGrid.innerHTML = distilled.map(d => {
            const dateStr = d.date ? new Date(d.date).toLocaleDateString() : '';
            const h1 = d.content.match(/^#\s+(.+)/m);
            const title = h1 ? h1[1].substring(0, 50) : d.name.replace('.md','');
            const lines = d.content.split('\n').length;
            return '<div class="card" style="border-left-color:#fbbf24" data-distilled="' + escapeHtml(d.name) + '">' +
                '<div class="card-header"><span class="card-icon">✨</span>' +
                '<span class="card-title">' + escapeHtml(title) + '</span>' +
                '<span style="font-size:0.75em;opacity:0.5">' + dateStr + '</span></div>' +
                '<p class="card-desc">' + escapeHtml(d.name) + ' · ' + lines + ' lines</p>' +
                '</div>';
        }).join('');
    }

    function openDistilledDetail(name) {
        const item = distilled.find(d => d.name === name);
        if (!item) return;
        detailMode = 'distilled';
        detailData = item;
        const h1 = item.content.match(/^#\s+(.+)/m);
        detailTitle.textContent = '✨ ' + (h1 ? h1[1] : item.name);
        artifactTabs.innerHTML = '';
        detailActions.innerHTML =
            '<button class="action-btn" id="btnSource">📄 ' + i18n.viewSource + '</button>' +
            '<button class="action-btn" id="btnPreview">👁 VS Code ' + i18n.preview + '</button>';
        mdPreview.innerHTML = renderMarkdown(item.content);
        document.getElementById('btnSource').onclick = () => vscode.postMessage({ command: 'openDistilledFile', fileName: item.name });
        document.getElementById('btnPreview').onclick = () => vscode.postMessage({ command: 'previewMarkdown', isDistilled: true, fileName: item.name });
        mainView.style.display = 'none';
        detailOverlay.classList.add('open');
        window.scrollTo(0, 0);
    }

    // ─── Init ───
    renderSkills();
    renderBrain();
    renderDistilled();
})();
</script>
</body>
</html>`;
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
