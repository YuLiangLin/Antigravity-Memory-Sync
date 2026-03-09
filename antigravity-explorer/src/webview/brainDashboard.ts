import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ArtifactData {
    type: string;
    summary: string;
    date: string;
    fileName: string;
    content: string;  // raw markdown content
}

interface ConversationData {
    id: string;
    date: string;
    title: string;
    artifactCount: number;
    artifacts: ArtifactData[];
    hasTask: boolean;
    hasWalkthrough: boolean;
    hasPlan: boolean;
}

export function createBrainDashboard(context: vscode.ExtensionContext, antigravityPath: string) {
    const panel = vscode.window.createWebviewPanel(
        'antigravityBrainDashboard',
        `🧠 ${vscode.l10n.t('Brain Dashboard')}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    const conversations = getConversations(antigravityPath);
    panel.webview.html = getBrainDashboardHtml(conversations);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
        (message) => {
            if (message.command === 'openFile') {
                const filePath = path.join(antigravityPath, 'brain', message.conversationId, message.fileName);
                if (fs.existsSync(filePath)) {
                    vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true });
                } else {
                    vscode.window.showWarningMessage(`File not found: ${message.fileName}`);
                }
            } else if (message.command === 'previewMarkdown') {
                const filePath = path.join(antigravityPath, 'brain', message.conversationId, message.fileName);
                if (fs.existsSync(filePath)) {
                    const uri = vscode.Uri.file(filePath);
                    vscode.commands.executeCommand('markdown.showPreview', uri);
                }
            }
        },
        undefined,
        context.subscriptions
    );
}

function getConversations(antigravityPath: string): ConversationData[] {
    const brainDir = path.join(antigravityPath, 'brain');
    const conversations: ConversationData[] = [];

    if (!fs.existsSync(brainDir)) { return conversations; }

    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    for (const dir of dirs) {
        const dirPath = path.join(brainDir, dir.name);
        const artifacts: ArtifactData[] = [];
        let latestDate = '';

        // Check common artifact files
        for (const artifactName of ['task.md', 'walkthrough.md', 'implementation_plan.md']) {
            const metaPath = path.join(dirPath, `${artifactName}.metadata.json`);
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    const date = meta.updatedAt || meta.createdAt || '';
                    // Read actual markdown content
                    const mdPath = path.join(dirPath, artifactName);
                    let content = '';
                    if (fs.existsSync(mdPath)) {
                        content = fs.readFileSync(mdPath, 'utf-8');
                    }
                    artifacts.push({
                        type: meta.artifactType || artifactName.replace('.md', ''),
                        summary: meta.summary || '',
                        date,
                        fileName: artifactName,
                        content
                    });
                    if (date > latestDate) { latestDate = date; }
                } catch { /* skip */ }
            }
        }

        // Smart title extraction: overview → walkthrough H1 → plan H1 → UUID
        let title = '';
        const overviewPath = path.join(dirPath, '.system_generated', 'logs', 'overview.txt');
        if (fs.existsSync(overviewPath)) {
            try {
                const overview = fs.readFileSync(overviewPath, 'utf-8');
                const firstLine = overview.split('\n').find(l => l.trim().length > 0);
                if (firstLine) { title = firstLine.trim().substring(0, 80); }
            } catch { /* skip */ }
        }

        // Fallback: extract H1 from walkthrough.md or implementation_plan.md
        if (!title) {
            for (const mdFile of ['walkthrough.md', 'implementation_plan.md']) {
                const mdPath = path.join(dirPath, mdFile);
                if (fs.existsSync(mdPath)) {
                    try {
                        const content = fs.readFileSync(mdPath, 'utf-8');
                        const h1Match = content.match(/^#\s+(.+)/m);
                        if (h1Match && h1Match[1].trim().length > 0) {
                            title = h1Match[1].trim().substring(0, 80);
                            break;
                        }
                    } catch { /* skip */ }
                }
            }
        }

        if (!title) {
            title = dir.name.substring(0, 8) + '...';
        }

        conversations.push({
            id: dir.name,
            date: latestDate || new Date().toISOString(),
            title,
            artifactCount: artifacts.length,
            artifacts,
            hasTask: artifacts.some(a => a.type === 'task' || a.type === 'ARTIFACT_TYPE_TASK'),
            hasWalkthrough: artifacts.some(a => a.type === 'walkthrough' || a.type === 'ARTIFACT_TYPE_WALKTHROUGH'),
            hasPlan: artifacts.some(a => a.type === 'implementation_plan' || a.type === 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN')
        });
    }

    conversations.sort((a, b) => b.date.localeCompare(a.date));
    return conversations;
}

function getBrainDashboardHtml(conversations: ConversationData[]): string {
    const total = conversations.length;
    const withTask = conversations.filter(c => c.hasTask).length;
    const withWalkthrough = conversations.filter(c => c.hasWalkthrough).length;
    const withPlan = conversations.filter(c => c.hasPlan).length;
    const totalArtifacts = conversations.reduce((sum, c) => sum + c.artifactCount, 0);

    // Activity heatmap data (last 30 days)
    const now = Date.now();
    const dayMs = 86400000;
    const activityByDay: number[] = new Array(30).fill(0);
    for (const c of conversations) {
        const daysAgo = Math.floor((now - new Date(c.date).getTime()) / dayMs);
        if (daysAgo >= 0 && daysAgo < 30) {
            activityByDay[29 - daysAgo]++;
        }
    }

    // Generate JSON with content for client-side rendering
    // CRITICAL: Escape backticks and ${ to prevent template literal injection
    const conversationsJson = JSON.stringify(conversations.map(c => ({
        id: c.id,
        date: c.date,
        title: c.title,
        artifacts: c.artifacts.map(a => ({
            type: a.type,
            summary: a.summary,
            fileName: a.fileName,
            content: a.content
        })),
        hasTask: c.hasTask,
        hasWalkthrough: c.hasWalkthrough,
        hasPlan: c.hasPlan
    }))).replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/<\/script>/gi, '<\\/script>');

    const maxActivity = Math.max(1, ...activityByDay);
    const heatmapCells = activityByDay.map((count, i) => {
        const opacity = count === 0 ? 0.08 : 0.2 + (count / maxActivity) * 0.8;
        const dayDate = new Date(now - (29 - i) * dayMs);
        const label = dayDate.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `<div class="heat-cell" style="opacity: ${opacity}" title="${label}: ${count} ${vscode.l10n.t('conversations')}"></div>`;
    }).join('');

    const i18n = {
        all: vscode.l10n.t('All'),
        walkthroughs: vscode.l10n.t('Walkthroughs'),
        plans: vscode.l10n.t('Plans'),
        tasks: vscode.l10n.t('Tasks'),
        searchPlaceholder: vscode.l10n.t('Search conversations...'),
        showing: vscode.l10n.t('Showing'),
        of: vscode.l10n.t('of'),
        noResults: vscode.l10n.t('No matching conversations.'),
        noConversations: vscode.l10n.t('No conversations found.'),
        daysAgo: vscode.l10n.t('days ago'),
        today: vscode.l10n.t('Today'),
        yesterday: vscode.l10n.t('Yesterday'),
        conversations: vscode.l10n.t('conversations'),
        viewSource: vscode.l10n.t('View Source'),
        preview: vscode.l10n.t('Preview'),
        back: vscode.l10n.t('Back'),
        noArtifacts: vscode.l10n.t('No artifacts in this conversation.'),
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 24px;
    }
    h1 {
        font-size: 1.6em;
        margin-bottom: 6px;
        background: linear-gradient(135deg, #a78bfa, #06b6d4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }

    /* Stats Row */
    .stats-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 28px;
    }
    .stat-card {
        background: var(--vscode-sideBar-background, #1e1e2e);
        border: 1px solid var(--vscode-panel-border, #333);
        border-radius: 10px;
        padding: 16px;
        text-align: center;
    }
    .stat-value {
        font-size: 2em;
        font-weight: 700;
        background: linear-gradient(135deg, #818cf8, #06b6d4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .stat-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 4px; }

    /* Heatmap */
    .section-title {
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .heatmap {
        display: grid;
        grid-template-columns: repeat(30, 1fr);
        gap: 3px;
        margin-bottom: 28px;
    }
    .heat-cell {
        aspect-ratio: 1;
        background: #818cf8;
        border-radius: 3px;
        min-height: 12px;
    }

    /* Search & Filter */
    .search-filter-bar {
        display: flex;
        gap: 12px;
        margin-bottom: 16px;
        align-items: center;
        flex-wrap: wrap;
    }
    .search-box {
        flex: 1;
        min-width: 200px;
        position: relative;
    }
    .search-box input {
        width: 100%;
        padding: 10px 36px 10px 14px;
        border-radius: 8px;
        border: 1px solid var(--vscode-panel-border, #444);
        background: var(--vscode-input-background, #1e1e2e);
        color: var(--vscode-input-foreground, #ccc);
        font-size: 0.92em;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-box input:focus {
        border-color: #818cf8;
        box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.15);
    }
    .search-box .clear-btn {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 1.1em;
        display: none;
        padding: 2px 4px;
        border-radius: 4px;
    }
    .search-box .clear-btn:hover { color: var(--vscode-foreground); background: rgba(255,255,255,0.06); }
    .search-box .clear-btn.visible { display: block; }
    .filter-chips { display: flex; gap: 6px; }
    .filter-chip {
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 0.8em;
        font-weight: 600;
        border: 1px solid var(--vscode-panel-border, #444);
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
    }
    .filter-chip:hover { border-color: #818cf8; color: var(--vscode-foreground); }
    .filter-chip.active {
        background: linear-gradient(135deg, rgba(129,140,248,0.2), rgba(6,182,212,0.15));
        border-color: #818cf8;
        color: #a5b4fc;
    }
    .result-count { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }

    /* Conversation Cards */
    .conversation-list { display: flex; flex-direction: column; gap: 8px; }
    .conversation-card {
        background: var(--vscode-sideBar-background, #1e1e2e);
        border: 1px solid var(--vscode-panel-border, #333);
        border-left: 3px solid #555;
        border-radius: 8px;
        padding: 14px 18px;
        transition: all 0.2s ease;
        cursor: pointer;
    }
    .conversation-card:hover {
        border-color: rgba(129,140,248,0.4);
        box-shadow: 0 2px 12px rgba(129,140,248,0.08);
        transform: translateX(2px);
    }
    .conversation-card.accent-walk { border-left-color: #86efac; }
    .conversation-card.accent-plan { border-left-color: #7dd3fc; }
    .conversation-card.accent-task { border-left-color: #a5b4fc; }
    .conversation-card.accent-none { border-left-color: #555; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
    .card-title { font-weight: 600; font-size: 0.95em; flex: 1; line-height: 1.4; }
    .card-date { font-size: 0.78em; color: var(--vscode-descriptionForeground); white-space: nowrap; flex-shrink: 0; padding-top: 2px; }
    .card-badges { display: flex; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
    .badge {
        font-size: 0.68em;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        cursor: pointer;
        transition: filter 0.15s, transform 0.1s;
    }
    .badge:hover { filter: brightness(1.3); transform: scale(1.05); }
    .badge.task { background: rgba(99,102,241,0.15); color: #a5b4fc; }
    .badge.plan { background: rgba(14,165,233,0.12); color: #7dd3fc; }
    .badge.walk { background: rgba(34,197,94,0.12); color: #86efac; }
    .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .card-id { font-size: 0.7em; color: var(--vscode-descriptionForeground); opacity: 0.4; font-family: monospace; }
    .card-summary { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 4px; line-height: 1.4; }
    .no-results { text-align: center; padding: 32px 16px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }

    /* Pagination */
    .pagination { display: flex; justify-content: center; gap: 8px; margin-top: 16px; }
    .page-btn {
        padding: 6px 14px;
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border, #444);
        background: var(--vscode-sideBar-background, #1e1e2e);
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 0.82em;
        transition: all 0.2s;
    }
    .page-btn:hover { border-color: #818cf8; }
    .page-btn.active {
        background: linear-gradient(135deg, rgba(129,140,248,0.2), rgba(6,182,212,0.15));
        border-color: #818cf8;
    }
    .page-btn:disabled { opacity: 0.3; cursor: default; }

    /* ═══ Detail Panel (overlay) ═══ */
    .detail-overlay {
        display: none;
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: var(--vscode-editor-background, #1e1e2e);
        z-index: 100;
        overflow-y: auto;
        padding: 24px;
    }
    .detail-overlay.open { display: block; }
    .detail-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .back-btn {
        padding: 6px 16px;
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border, #444);
        background: var(--vscode-sideBar-background, #1e1e2e);
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 0.85em;
        transition: all 0.2s;
        flex-shrink: 0;
    }
    .back-btn:hover { border-color: #818cf8; background: rgba(129,140,248,0.1); }
    .detail-title {
        font-size: 1.3em;
        font-weight: 600;
        flex: 1;
    }
    .detail-meta {
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }

    /* Artifact tabs */
    .artifact-tabs {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
        padding-bottom: 0;
    }
    .artifact-tab {
        padding: 8px 16px;
        font-size: 0.85em;
        font-weight: 600;
        border: none;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
        margin-bottom: -1px;
    }
    .artifact-tab:hover { color: var(--vscode-foreground); }
    .artifact-tab.active {
        color: #a5b4fc;
        border-bottom-color: #818cf8;
    }

    /* Action buttons in detail view */
    .detail-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
    }
    .action-btn {
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 0.78em;
        border: 1px solid var(--vscode-panel-border, #444);
        background: var(--vscode-sideBar-background, #1e1e2e);
        color: var(--vscode-foreground);
        cursor: pointer;
        transition: all 0.2s;
    }
    .action-btn:hover { border-color: #818cf8; background: rgba(129,140,248,0.1); }
    .action-btn.primary {
        background: linear-gradient(135deg, rgba(129,140,248,0.2), rgba(6,182,212,0.15));
        border-color: #818cf8;
    }

    /* Markdown rendered content */
    .md-preview {
        background: var(--vscode-sideBar-background, #1e1e2e);
        border: 1px solid var(--vscode-panel-border, #333);
        border-radius: 8px;
        padding: 24px;
        line-height: 1.7;
        font-size: 0.92em;
    }
    .md-preview h1 { font-size: 1.5em; margin: 0.8em 0 0.4em; color: #a5b4fc; border-bottom: 1px solid var(--vscode-panel-border, #333); padding-bottom: 6px; }
    .md-preview h2 { font-size: 1.25em; margin: 0.8em 0 0.3em; color: #7dd3fc; }
    .md-preview h3 { font-size: 1.1em; margin: 0.6em 0 0.3em; color: #86efac; }
    .md-preview h4 { font-size: 1em; margin: 0.5em 0 0.2em; color: #fbbf24; }
    .md-preview p { margin: 0.5em 0; }
    .md-preview ul, .md-preview ol { margin: 0.4em 0 0.4em 1.5em; }
    .md-preview li { margin: 0.2em 0; }
    .md-preview li input[type="checkbox"] { margin-right: 6px; }
    .md-preview code {
        background: rgba(129,140,248,0.1);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
        font-size: 0.9em;
    }
    .md-preview pre {
        background: rgba(0,0,0,0.3);
        padding: 12px 16px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0.6em 0;
    }
    .md-preview pre code { background: none; padding: 0; }
    .md-preview blockquote {
        border-left: 3px solid #818cf8;
        padding: 4px 12px;
        margin: 0.5em 0;
        color: var(--vscode-descriptionForeground);
    }
    .md-preview hr { border: none; border-top: 1px solid var(--vscode-panel-border, #333); margin: 1em 0; }
    .md-preview a { color: #818cf8; text-decoration: none; }
    .md-preview a:hover { text-decoration: underline; }
    .md-preview strong { color: var(--vscode-foreground); }
    .md-preview table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
    .md-preview th, .md-preview td { border: 1px solid var(--vscode-panel-border, #444); padding: 6px 10px; text-align: left; }
    .md-preview th { background: rgba(129,140,248,0.08); font-weight: 600; }

    .no-artifacts-msg {
        text-align: center;
        padding: 48px;
        color: var(--vscode-descriptionForeground);
    }
</style>
</head>
<body>
    <!-- ═══ Main List View ═══ -->
    <div id="listView">
        <h1>🧠 ${vscode.l10n.t('Brain Dashboard')}</h1>
        <div class="subtitle">${vscode.l10n.t('Antigravity conversation history & artifacts overview')}</div>

        <div class="stats-row">
            <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">${vscode.l10n.t('Conversations')}</div></div>
            <div class="stat-card"><div class="stat-value">${totalArtifacts}</div><div class="stat-label">${vscode.l10n.t('Total Artifacts')}</div></div>
            <div class="stat-card"><div class="stat-value">${withTask}</div><div class="stat-label">${vscode.l10n.t('With Tasks')}</div></div>
            <div class="stat-card"><div class="stat-value">${withPlan}</div><div class="stat-label">${vscode.l10n.t('With Plans')}</div></div>
            <div class="stat-card"><div class="stat-value">${withWalkthrough}</div><div class="stat-label">${vscode.l10n.t('With Walkthroughs')}</div></div>
        </div>

        <div class="section-title">📊 ${vscode.l10n.t('Activity (Last 30 Days)')}</div>
        <div class="heatmap">${heatmapCells}</div>

        <div class="section-title">📋 ${vscode.l10n.t('Recent Conversations')}</div>

        <div class="search-filter-bar">
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="${i18n.searchPlaceholder}" />
                <button class="clear-btn" id="clearBtn" title="Clear">✕</button>
            </div>
            <div class="filter-chips">
                <button class="filter-chip active" data-filter="all">${i18n.all}</button>
                <button class="filter-chip" data-filter="walk">🟢 ${i18n.walkthroughs}</button>
                <button class="filter-chip" data-filter="plan">🔵 ${i18n.plans}</button>
                <button class="filter-chip" data-filter="task">🟣 ${i18n.tasks}</button>
            </div>
        </div>
        <div class="result-count" id="resultCount"></div>
        <div class="conversation-list" id="cardList"></div>
        <div class="pagination" id="pagination"></div>
    </div>

    <!-- ═══ Detail View (overlay) ═══ -->
    <div class="detail-overlay" id="detailOverlay">
        <div class="detail-header">
            <button class="back-btn" id="backBtn">← ${i18n.back}</button>
            <div class="detail-title" id="detailTitle"></div>
            <div class="detail-meta" id="detailMeta"></div>
        </div>
        <div class="artifact-tabs" id="artifactTabs"></div>
        <div class="detail-actions" id="detailActions"></div>
        <div class="md-preview" id="mdPreview"></div>
    </div>

<script>
(function() {
    const conversations = ${conversationsJson};
    const PAGE_SIZE = 20;
    let currentFilter = 'all';
    let currentSearch = '';
    let currentPage = 1;
    const i18n = ${JSON.stringify(i18n)};
    const vscode = acquireVsCodeApi();

    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearBtn');
    const cardList = document.getElementById('cardList');
    const resultCount = document.getElementById('resultCount');
    const paginationEl = document.getElementById('pagination');
    const listView = document.getElementById('listView');
    const detailOverlay = document.getElementById('detailOverlay');
    const detailTitle = document.getElementById('detailTitle');
    const detailMeta = document.getElementById('detailMeta');
    const artifactTabs = document.getElementById('artifactTabs');
    const detailActions = document.getElementById('detailActions');
    const mdPreview = document.getElementById('mdPreview');
    const backBtn = document.getElementById('backBtn');

    // ─── Simple Markdown → HTML renderer ───
    function renderMarkdown(md) {
        if (!md) return '<p style="color:var(--vscode-descriptionForeground);">—</p>';
        let html = md;
        // Escape HTML entities first
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Code blocks (fenced)
        html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
            return '<pre><code>' + code.trim() + '</code></pre>';
        });
        // Inline code
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        // Headings
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // Horizontal rule
        html = html.replace(/^---+$/gm, '<hr>');
        // Bold & italic
        html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        // Checkboxes
        html = html.replace(/^\\s*- \\[x\\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>');
        html = html.replace(/^\\s*- \\[[\\/]\\] (.+)$/gm, '<li><input type="checkbox" disabled> 🔄 $1</li>');
        html = html.replace(/^\\s*- \\[ \\] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>');
        // Unordered list items
        html = html.replace(/^\\s*[-*] (.+)$/gm, '<li>$1</li>');
        // Ordered list items
        html = html.replace(/^\\s*\\d+\\. (.+)$/gm, '<li>$1</li>');
        // Wrap consecutive <li> in <ul>
        html = html.replace(/(<li>.*?<\\/li>\\n?)+/g, '<ul>$&</ul>');
        // Blockquotes
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        // Links
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');
        // Paragraphs: wrap lines that aren't already in block elements
        html = html.replace(/^(?!<[hupblo]|<li|<hr|<pre|<code|<blockquote)(.+)$/gm, '<p>$1</p>');
        // Clean up empty paragraphs
        html = html.replace(/<p>\\s*<\\/p>/g, '');
        return html;
    }

    // ─── Helpers ───
    function relativeDate(isoStr) {
        if (!isoStr) return 'N/A';
        const d = new Date(isoStr);
        const now = new Date();
        const diffDays = Math.floor((now - d) / 86400000);
        if (diffDays === 0) return i18n.today;
        if (diffDays === 1) return i18n.yesterday;
        if (diffDays < 30) return diffDays + ' ' + i18n.daysAgo;
        return d.toLocaleDateString();
    }

    function accentClass(c) {
        if (c.hasWalkthrough) return 'accent-walk';
        if (c.hasPlan) return 'accent-plan';
        if (c.hasTask) return 'accent-task';
        return 'accent-none';
    }

    function displayType(type) {
        return type.replace('ARTIFACT_TYPE_', '').replace(/_/g, ' ').toLowerCase().replace(/^\\w/, c => c.toUpperCase());
    }

    function escapeHtml(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    function getFiltered() {
        return conversations.filter(c => {
            if (currentFilter === 'walk' && !c.hasWalkthrough) return false;
            if (currentFilter === 'plan' && !c.hasPlan) return false;
            if (currentFilter === 'task' && !c.hasTask) return false;
            if (currentSearch) {
                const q = currentSearch.toLowerCase();
                const titleMatch = c.title.toLowerCase().includes(q);
                const summaryMatch = c.artifacts.some(a => a.summary.toLowerCase().includes(q));
                const contentMatch = c.artifacts.some(a => a.content && a.content.toLowerCase().includes(q));
                const idMatch = c.id.toLowerCase().includes(q);
                if (!titleMatch && !summaryMatch && !contentMatch && !idMatch) return false;
            }
            return true;
        });
    }

    // ─── Render card list ───
    function render() {
        const filtered = getFiltered();
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filtered.slice(start, start + PAGE_SIZE);

        if (currentSearch || currentFilter !== 'all') {
            resultCount.textContent = i18n.showing + ' ' + filtered.length + ' / ' + conversations.length + ' ' + i18n.conversations;
        } else {
            resultCount.textContent = '';
        }

        if (pageItems.length === 0) {
            cardList.innerHTML = '<div class="no-results">' + (conversations.length === 0 ? i18n.noConversations : i18n.noResults) + '</div>';
        } else {
            cardList.innerHTML = pageItems.map(c => {
                const badges = [
                    c.hasTask ? '<span class="badge task" data-conv="' + c.id + '" data-file="task.md">📋 Task</span>' : '',
                    c.hasPlan ? '<span class="badge plan" data-conv="' + c.id + '" data-file="implementation_plan.md">📐 Plan</span>' : '',
                    c.hasWalkthrough ? '<span class="badge walk" data-conv="' + c.id + '" data-file="walkthrough.md">📝 Walk</span>' : ''
                ].filter(Boolean).join('');

                // Show first artifact summary as preview
                const firstSummary = c.artifacts.length > 0 ? c.artifacts[0].summary : '';
                const summaryPreview = firstSummary ? '<div class="card-summary">' + escapeHtml(firstSummary.substring(0, 120)) + (firstSummary.length > 120 ? '...' : '') + '</div>' : '';

                return '<div class="conversation-card ' + accentClass(c) + '" data-id="' + c.id + '">' +
                    '<div class="card-header">' +
                    '<div class="card-title">' + escapeHtml(c.title) + '</div>' +
                    '<div class="card-date">' + relativeDate(c.date) + '</div>' +
                    '</div>' +
                    (badges ? '<div class="card-badges">' + badges + '</div>' : '') +
                    summaryPreview +
                    '<div class="card-footer">' +
                    '<span class="card-id">' + c.id + '</span>' +
                    '</div>' +
                    '</div>';
            }).join('');
        }

        // Pagination
        if (totalPages <= 1) {
            paginationEl.innerHTML = '';
        } else {
            let btns = '<button class="page-btn" ' + (currentPage <= 1 ? 'disabled' : '') + ' data-page="' + (currentPage - 1) + '">◀</button>';
            for (let p = 1; p <= totalPages; p++) {
                if (totalPages > 7 && p > 3 && p < totalPages - 1 && Math.abs(p - currentPage) > 1) {
                    if (p === 4 || p === totalPages - 2) btns += '<span style="color:var(--vscode-descriptionForeground);padding:0 4px;">…</span>';
                    continue;
                }
                btns += '<button class="page-btn ' + (p === currentPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            btns += '<button class="page-btn" ' + (currentPage >= totalPages ? 'disabled' : '') + ' data-page="' + (currentPage + 1) + '">▶</button>';
            paginationEl.innerHTML = btns;
        }
    }

    // ─── Detail view ───
    let currentConv = null;
    let currentArtifactIdx = 0;

    function openDetail(convId) {
        currentConv = conversations.find(c => c.id === convId);
        if (!currentConv) return;
        currentArtifactIdx = 0;
        detailTitle.textContent = currentConv.title;
        detailMeta.textContent = relativeDate(currentConv.date) + ' • ' + currentConv.id.substring(0, 8);
        renderDetailContent();
        listView.style.display = 'none';
        detailOverlay.classList.add('open');
        window.scrollTo(0, 0);
    }

    function closeDetail() {
        detailOverlay.classList.remove('open');
        listView.style.display = 'block';
        currentConv = null;
    }

    function renderDetailContent() {
        if (!currentConv || currentConv.artifacts.length === 0) {
            artifactTabs.innerHTML = '';
            detailActions.innerHTML = '';
            mdPreview.innerHTML = '<div class="no-artifacts-msg">' + i18n.noArtifacts + '</div>';
            return;
        }

        // Tabs
        artifactTabs.innerHTML = currentConv.artifacts.map((a, i) =>
            '<button class="artifact-tab ' + (i === currentArtifactIdx ? 'active' : '') + '" data-idx="' + i + '">' +
            displayType(a.type) + '</button>'
        ).join('');

        const artifact = currentConv.artifacts[currentArtifactIdx];

        // Action buttons
        detailActions.innerHTML =
            '<button class="action-btn" id="btnViewSource" title="' + i18n.viewSource + '">📄 ' + i18n.viewSource + '</button>' +
            '<button class="action-btn" id="btnPreviewVscode" title="' + i18n.preview + '">👁 VS Code ' + i18n.preview + '</button>';

        // Render markdown
        mdPreview.innerHTML = renderMarkdown(artifact.content);

        // Wire action buttons
        document.getElementById('btnViewSource').onclick = function() {
            vscode.postMessage({ command: 'openFile', conversationId: currentConv.id, fileName: artifact.fileName });
        };
        document.getElementById('btnPreviewVscode').onclick = function() {
            vscode.postMessage({ command: 'previewMarkdown', conversationId: currentConv.id, fileName: artifact.fileName });
        };
    }

    // ─── Events ───
    searchInput.addEventListener('input', function() {
        currentSearch = this.value.trim();
        currentPage = 1;
        clearBtn.classList.toggle('visible', currentSearch.length > 0);
        render();
    });

    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            this.value = '';
            currentSearch = '';
            currentPage = 1;
            clearBtn.classList.remove('visible');
            render();
        }
    });

    clearBtn.addEventListener('click', function() {
        searchInput.value = '';
        currentSearch = '';
        currentPage = 1;
        clearBtn.classList.remove('visible');
        searchInput.focus();
        render();
    });

    document.querySelector('.filter-chips').addEventListener('click', function(e) {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentFilter = chip.dataset.filter;
        currentPage = 1;
        render();
    });

    cardList.addEventListener('click', function(e) {
        // Click on badge → open detail at that artifact
        const badge = e.target.closest('.badge[data-file]');
        if (badge) {
            e.stopPropagation();
            const convId = badge.dataset.conv;
            const conv = conversations.find(c => c.id === convId);
            if (conv) {
                const idx = conv.artifacts.findIndex(a => a.fileName === badge.dataset.file);
                currentArtifactIdx = idx >= 0 ? idx : 0;
                openDetail(convId);
            }
            return;
        }

        // Click card → open detail view
        const card = e.target.closest('.conversation-card');
        if (card) {
            openDetail(card.dataset.id);
        }
    });

    paginationEl.addEventListener('click', function(e) {
        const btn = e.target.closest('.page-btn');
        if (!btn || btn.disabled) return;
        currentPage = parseInt(btn.dataset.page);
        render();
        cardList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    backBtn.addEventListener('click', closeDetail);

    // Tab switching in detail view
    artifactTabs.addEventListener('click', function(e) {
        const tab = e.target.closest('.artifact-tab');
        if (!tab) return;
        currentArtifactIdx = parseInt(tab.dataset.idx);
        renderDetailContent();
    });

    // Escape to close detail
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && currentConv) {
            closeDetail();
        }
    });

    // Initial render
    render();
})();
</script>
</body>
</html>`;
}
