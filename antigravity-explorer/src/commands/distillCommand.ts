import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ConversationSummary {
    id: string;
    title: string;
    date: string;
    artifactCount: number;
    hasTask: boolean;
    hasPlan: boolean;
    hasWalkthrough: boolean;
}

export async function distillBrain(context: vscode.ExtensionContext, antigravityPath: string) {
    // Collect brain data locally (no API needed)
    const conversations = collectBrainData(antigravityPath);
    if (conversations.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No conversations found in Brain.'));
        return;
    }

    // Build a concise summary for the AI
    const summary = buildSummaryForChat(conversations);

    // Build the prompt
    const prompt = `請幫我粹練 Brain 內容，以下是 ${conversations.length} 個對話的摘要數據：

${summary}

請產生粹練報告，包含：關鍵決策、技術模式、常見主題排名、技能建議、時間趨勢。
輸出為繁體中文 Markdown，存到 distilled/ 目錄。`;

    // Send to Antigravity chat
    try {
        // Try Antigravity's chat API
        await vscode.commands.executeCommand('antigravity.sendTerminalToChat', prompt);
    } catch {
        try {
            // Fallback: open chat and copy prompt to clipboard
            await vscode.env.clipboard.writeText(prompt);
            await vscode.commands.executeCommand('workbench.action.chat.open');
            vscode.window.showInformationMessage(
                vscode.l10n.t('Distillation prompt copied to clipboard. Paste it in the chat to begin.')
            );
        } catch {
            // Last resort: show in new editor
            const doc = await vscode.workspace.openTextDocument({
                content: prompt,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(
                vscode.l10n.t('Paste this prompt in the Antigravity chat to start distillation.')
            );
        }
    }
}

function collectBrainData(antigravityPath: string): ConversationSummary[] {
    const brainDir = path.join(antigravityPath, 'brain');
    const conversations: ConversationSummary[] = [];

    if (!fs.existsSync(brainDir)) { return conversations; }

    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    for (const dir of dirs) {
        const dirPath = path.join(brainDir, dir.name);

        // Read overview for title
        let title = dir.name.substring(0, 8);
        const overviewPath = path.join(dirPath, '.system_generated', 'logs', 'overview.txt');
        if (fs.existsSync(overviewPath)) {
            try {
                const overview = fs.readFileSync(overviewPath, 'utf-8');
                const firstLine = overview.split('\n').find(l => l.trim().length > 0);
                if (firstLine) { title = firstLine.trim().substring(0, 60); }
            } catch { /* skip */ }
        }

        // Check artifacts
        let artifactCount = 0;
        let latestDate = '';
        const hasTask = fs.existsSync(path.join(dirPath, 'task.md'));
        const hasPlan = fs.existsSync(path.join(dirPath, 'implementation_plan.md'));
        const hasWalkthrough = fs.existsSync(path.join(dirPath, 'walkthrough.md'));

        for (const artifactName of ['task.md', 'walkthrough.md', 'implementation_plan.md']) {
            const metaPath = path.join(dirPath, `${artifactName}.metadata.json`);
            if (fs.existsSync(metaPath)) {
                artifactCount++;
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    const date = meta.updatedAt || meta.createdAt || '';
                    if (date > latestDate) { latestDate = date; }
                } catch { /* skip */ }
            }
        }

        conversations.push({
            id: dir.name,
            title,
            date: latestDate || '',
            artifactCount,
            hasTask,
            hasPlan,
            hasWalkthrough
        });
    }

    conversations.sort((a, b) => b.date.localeCompare(a.date));
    return conversations;
}

function buildSummaryForChat(conversations: ConversationSummary[]): string {
    const total = conversations.length;
    const withTask = conversations.filter(c => c.hasTask).length;
    const withPlan = conversations.filter(c => c.hasPlan).length;
    const withWalkthrough = conversations.filter(c => c.hasWalkthrough).length;

    // Group by month
    const byMonth: Record<string, number> = {};
    for (const c of conversations) {
        const month = c.date ? c.date.substring(0, 7) : 'unknown';
        byMonth[month] = (byMonth[month] || 0) + 1;
    }

    const monthSummary = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, count]) => `  ${m}: ${count} 個對話`)
        .join('\n');

    // Recent conversations list
    const recentList = conversations.slice(0, 20).map(c => {
        const date = c.date ? c.date.split('T')[0] : '?';
        const tags = [
            c.hasTask ? 'Task' : '',
            c.hasPlan ? 'Plan' : '',
            c.hasWalkthrough ? 'Walk' : ''
        ].filter(Boolean).join('/');
        return `- [${date}] ${c.title}${tags ? ` (${tags})` : ''}`;
    }).join('\n');

    return `統計：${total} 個對話 | ${withTask} 有 Task | ${withPlan} 有 Plan | ${withWalkthrough} 有 Walkthrough

月份分布：
${monthSummary}

最近對話：
${recentList}`;
}
