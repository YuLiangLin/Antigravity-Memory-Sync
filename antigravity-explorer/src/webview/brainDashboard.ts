import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ConversationData {
    id: string;
    date: string;
    title: string;
    artifactCount: number;
    artifacts: { type: string; summary: string; date: string }[];
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
}

function getConversations(antigravityPath: string): ConversationData[] {
    const brainDir = path.join(antigravityPath, 'brain');
    const conversations: ConversationData[] = [];

    if (!fs.existsSync(brainDir)) { return conversations; }

    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    for (const dir of dirs) {
        const dirPath = path.join(brainDir, dir.name);
        const artifacts: { type: string; summary: string; date: string }[] = [];
        let latestDate = '';

        // Check common artifact files
        for (const artifactName of ['task.md', 'walkthrough.md', 'implementation_plan.md']) {
            const metaPath = path.join(dirPath, `${artifactName}.metadata.json`);
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    const date = meta.updatedAt || meta.createdAt || '';
                    artifacts.push({
                        type: meta.artifactType || artifactName.replace('.md', ''),
                        summary: meta.summary || '',
                        date
                    });
                    if (date > latestDate) { latestDate = date; }
                } catch { /* skip */ }
            }
        }

        // Read overview for title
        let title = dir.name.substring(0, 8) + '...';
        const overviewPath = path.join(dirPath, '.system_generated', 'logs', 'overview.txt');
        if (fs.existsSync(overviewPath)) {
            try {
                const overview = fs.readFileSync(overviewPath, 'utf-8');
                const firstLine = overview.split('\n').find(l => l.trim().length > 0);
                if (firstLine) { title = firstLine.trim().substring(0, 60); }
            } catch { /* skip */ }
        }

        conversations.push({
            id: dir.name,
            date: latestDate || new Date().toISOString(),
            title,
            artifactCount: artifacts.length,
            artifacts,
            hasTask: artifacts.some(a => a.type === 'task'),
            hasWalkthrough: artifacts.some(a => a.type === 'walkthrough'),
            hasPlan: artifacts.some(a => a.type === 'implementation_plan')
        });
    }

    // Sort by date descending
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

    // Recent conversations (top 15)
    const recent = conversations.slice(0, 15);

    const timelineHtml = recent.map(c => {
        const date = c.date ? new Date(c.date).toLocaleDateString() : 'N/A';
        const badges = [
            c.hasTask ? '<span class="badge task">Task</span>' : '',
            c.hasPlan ? '<span class="badge plan">Plan</span>' : '',
            c.hasWalkthrough ? '<span class="badge walk">Walk</span>' : ''
        ].filter(Boolean).join('');

        const artifactDetails = c.artifacts.map(a =>
            `<div class="artifact-detail">
                <span class="artifact-type">${a.type}</span>
                <span class="artifact-summary">${a.summary.substring(0, 80)}${a.summary.length > 80 ? '...' : ''}</span>
            </div>`
        ).join('');

        return `
        <div class="conversation-card">
            <div class="card-header">
                <div class="card-title">${c.title}</div>
                <div class="card-date">${date}</div>
            </div>
            <div class="card-badges">${badges}</div>
            ${artifactDetails ? `<div class="card-artifacts">${artifactDetails}</div>` : ''}
            <div class="card-id">${c.id}</div>
        </div>`;
    }).join('');

    // Heatmap cells
    const maxActivity = Math.max(1, ...activityByDay);
    const heatmapCells = activityByDay.map((count, i) => {
        const opacity = count === 0 ? 0.08 : 0.2 + (count / maxActivity) * 0.8;
        const dayDate = new Date(now - (29 - i) * dayMs);
        const label = dayDate.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `<div class="heat-cell" style="opacity: ${opacity}" title="${label}: ${count} ${vscode.l10n.t('conversations')}"></div>`;
    }).join('');

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

    /* Timeline */
    .conversation-card {
        background: var(--vscode-sideBar-background, #1e1e2e);
        border: 1px solid var(--vscode-panel-border, #333);
        border-radius: 10px;
        padding: 14px 18px;
        margin-bottom: 10px;
        transition: border-color 0.2s;
    }
    .conversation-card:hover {
        border-color: #818cf8;
    }
    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
    }
    .card-title { font-weight: 600; font-size: 0.95em; }
    .card-date { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .card-badges { display: flex; gap: 6px; margin-bottom: 6px; }
    .badge {
        font-size: 0.7em;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 600;
        text-transform: uppercase;
    }
    .badge.task { background: #312e81; color: #a5b4fc; }
    .badge.plan { background: #1e3a5f; color: #7dd3fc; }
    .badge.walk { background: #14532d; color: #86efac; }

    .card-artifacts { margin-top: 8px; }
    .artifact-detail {
        display: flex;
        gap: 8px;
        padding: 4px 0;
        font-size: 0.82em;
        border-top: 1px solid var(--vscode-panel-border, #222);
    }
    .artifact-type {
        color: #a78bfa;
        font-weight: 600;
        min-width: 100px;
    }
    .artifact-summary { color: var(--vscode-descriptionForeground); }
    .card-id {
        font-size: 0.7em;
        color: var(--vscode-descriptionForeground);
        opacity: 0.5;
        margin-top: 6px;
        font-family: monospace;
    }
</style>
</head>
<body>
    <h1>🧠 ${vscode.l10n.t('Brain Dashboard')}</h1>
    <div class="subtitle">${vscode.l10n.t('Antigravity conversation history & artifacts overview')}</div>

    <div class="stats-row">
        <div class="stat-card">
            <div class="stat-value">${total}</div>
            <div class="stat-label">${vscode.l10n.t('Conversations')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totalArtifacts}</div>
            <div class="stat-label">${vscode.l10n.t('Total Artifacts')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${withTask}</div>
            <div class="stat-label">${vscode.l10n.t('With Tasks')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${withPlan}</div>
            <div class="stat-label">${vscode.l10n.t('With Plans')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${withWalkthrough}</div>
            <div class="stat-label">${vscode.l10n.t('With Walkthroughs')}</div>
        </div>
    </div>

    <div class="section-title">📊 ${vscode.l10n.t('Activity (Last 30 Days)')}</div>
    <div class="heatmap">${heatmapCells}</div>

    <div class="section-title">📋 ${vscode.l10n.t('Recent Conversations')}</div>
    ${timelineHtml || `<p style="color: var(--vscode-descriptionForeground);">${vscode.l10n.t('No conversations found.')}</p>`}
</body>
</html>`;
}
