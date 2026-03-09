import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { loadRegistry, ProjectEntry } from './projectCommands';

interface ConversationSummary {
    id: string;
    title: string;
    date: string;
    artifactCount: number;
    hasTask: boolean;
    hasPlan: boolean;
    hasWalkthrough: boolean;
    summaries: string[];
}

export async function distillBrain(context: vscode.ExtensionContext, antigravityPath: string) {
    const conversations = collectBrainData(antigravityPath);
    const projects = collectProjectData(antigravityPath);

    if (conversations.length === 0 && projects.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No conversations or projects found.'));
        return;
    }

    // Build the distillation prompt
    const brainSummary = buildBrainSummary(conversations);
    const projectSummary = buildProjectSummary(projects);

    const prompt = `請幫我粹練 Brain 內容，以下是完整的摘要數據：

## 📂 專案總覽 (${projects.length} 個專案)

${projectSummary}

## 🧠 對話紀錄 (${conversations.length} 個對話)

${brainSummary}

請產生粹練報告，包含：
1. **專案關係圖** — 各專案之間的關聯與依賴
2. **專案進度摘要** — 每個專案最近的工作重點
3. **關鍵決策** — 近期做出的重要技術決策
4. **技術模式** — 重複出現的技術模式和最佳實踐
5. **常見主題排名** — 最常見的開發主題
6. **待辦 / 未完成項目** — 需要後續跟進的事項
7. **技能建議** — 根據工作模式建議的新技能

輸出為繁體中文 Markdown，存到 distilled/ 目錄。`;

    // One-click send to chat
    await sendToChat(prompt);
}

async function sendToChat(prompt: string) {
    // Save prompt to distilled directory for reference
    const distilledDir = path.join(require('os').homedir(), '.gemini', 'antigravity', 'distilled');
    if (!fs.existsSync(distilledDir)) { fs.mkdirSync(distilledDir, { recursive: true }); }
    const now = new Date().toISOString().split('T')[0];
    const promptFile = path.join(distilledDir, `distill-prompt-${now}.md`);
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    // Always copy full prompt to clipboard first
    await vscode.env.clipboard.writeText(prompt);

    // ─── 偷吃步 (Hack): Auto-paste + Auto-submit ───
    try {
        // Step 1: Open chat panel
        await vscode.commands.executeCommand('workbench.action.chat.open');

        // Step 2: Wait for chat to focus
        await delay(800);

        // Step 3: Paste from clipboard (simulates Ctrl+V into the chat input)
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

        // Step 4: Wait for paste to complete
        await delay(500);

        // Step 5: Submit the chat message (simulates pressing Enter)
        await vscode.commands.executeCommand('workbench.action.chat.submit');

        vscode.window.showInformationMessage(
            vscode.l10n.t('Distill prompt sent to chat!')
        );
    } catch {
        // Fallback: Just notify user to paste manually
        vscode.window.showInformationMessage(
            vscode.l10n.t('Distillation prompt copied to clipboard. Paste it in the chat to begin.')
        );
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Project Data Collection ─────────────────────────────────

function collectProjectData(antigravityPath: string): ProjectEntry[] {
    try {
        const registry = loadRegistry(antigravityPath);
        // Only include LOCAL projects (that exist on this machine)
        return (registry.projects || []).filter(p => p.localPaths.some(lp => fs.existsSync(lp)));
    } catch { return []; }
}

function buildProjectSummary(projects: ProjectEntry[]): string {
    if (projects.length === 0) return '(無專案資料，請先執行 Scan Projects)';

    // Get descriptions from AGENTS.md / README.md for each local project
    const projectDetails = projects.map(p => {
        const localPath = p.localPaths.find(lp => fs.existsSync(lp));
        let contextSummary = '';

        if (localPath) {
            // Try reading AGENTS.md for project context
            for (const contextFile of ['AGENTS.md', '.agents/AGENTS.md', 'README.md']) {
                const fp = path.join(localPath, contextFile);
                if (fs.existsSync(fp)) {
                    try {
                        const content = fs.readFileSync(fp, 'utf-8');
                        contextSummary = content.substring(0, 500).replace(/\n/g, ' ').trim();
                        if (content.length > 500) { contextSummary += '...'; }
                        break;
                    } catch { /* skip */ }
                }
            }
        }

        const techStr = p.techStack.length > 0 ? `[${p.techStack.join(', ')}]` : '';
        const related = p.relatedProjects.length > 0 ? `\n    ↔️ 關聯: ${p.relatedProjects.join(', ')}` : '';
        const desc = p.description || contextSummary || '(無描述)';

        return `### ${p.name} ${techStr}
  ${desc}${related}`;
    });

    // Build relationship graph
    const relationships: string[] = [];
    for (const p of projects) {
        for (const rel of p.relatedProjects) {
            const key = [p.name, rel].sort().join(' ↔ ');
            if (!relationships.includes(key)) { relationships.push(key); }
        }
    }

    let result = projectDetails.join('\n\n');
    if (relationships.length > 0) {
        result += '\n\n### 🔗 專案關係\n' + relationships.map(r => `- ${r}`).join('\n');
    }
    return result;
}

// ─── Brain Data Collection ───────────────────────────────────

function collectBrainData(antigravityPath: string): ConversationSummary[] {
    const brainDir = path.join(antigravityPath, 'brain');
    const conversations: ConversationSummary[] = [];

    if (!fs.existsSync(brainDir)) { return conversations; }

    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    for (const dir of dirs) {
        const dirPath = path.join(brainDir, dir.name);

        // Smart title extraction
        let title = dir.name.substring(0, 8) + '...';
        for (const mdFile of ['walkthrough.md', 'implementation_plan.md', 'task.md']) {
            const mdPath = path.join(dirPath, mdFile);
            if (fs.existsSync(mdPath)) {
                try {
                    const content = fs.readFileSync(mdPath, 'utf-8');
                    const h1 = content.match(/^#\s+(.+)/m);
                    if (h1 && h1[1].trim().length > 0) {
                        title = h1[1].trim().substring(0, 60);
                        break;
                    }
                } catch { /* skip */ }
            }
        }

        // Check artifacts
        let artifactCount = 0;
        let latestDate = '';
        const hasTask = fs.existsSync(path.join(dirPath, 'task.md'));
        const hasPlan = fs.existsSync(path.join(dirPath, 'implementation_plan.md'));
        const hasWalkthrough = fs.existsSync(path.join(dirPath, 'walkthrough.md'));
        const summaries: string[] = [];

        for (const artifactName of ['task.md', 'walkthrough.md', 'implementation_plan.md']) {
            const metaPath = path.join(dirPath, `${artifactName}.metadata.json`);
            if (fs.existsSync(metaPath)) {
                artifactCount++;
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    const date = meta.updatedAt || meta.createdAt || '';
                    if (date > latestDate) { latestDate = date; }
                    if (meta.summary) {
                        summaries.push(meta.summary.substring(0, 120));
                    }
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
            hasWalkthrough,
            summaries
        });
    }

    conversations.sort((a, b) => b.date.localeCompare(a.date));
    return conversations;
}

function buildBrainSummary(conversations: ConversationSummary[]): string {
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

    // Recent conversations with summaries
    const recentList = conversations.slice(0, 30).map(c => {
        const date = c.date ? c.date.split('T')[0] : '?';
        const tags = [
            c.hasTask ? 'Task' : '',
            c.hasPlan ? 'Plan' : '',
            c.hasWalkthrough ? 'Walk' : ''
        ].filter(Boolean).join('/');
        const summary = c.summaries.length > 0 ? '\n    ' + c.summaries[0] : '';
        return `- [${date}] ${c.title}${tags ? ` (${tags})` : ''}${summary}`;
    }).join('\n');

    return `統計：${total} 個對話 | ${withTask} 有 Task | ${withPlan} 有 Plan | ${withWalkthrough} 有 Walkthrough

月份分布：
${monthSummary}

最近 30 個對話：
${recentList}`;
}
