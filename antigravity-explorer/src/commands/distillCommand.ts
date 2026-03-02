import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

interface ConversationSummary {
    id: string;
    title: string;
    date: string;
    artifacts: string[];
}

export async function distillBrain(context: vscode.ExtensionContext, antigravityPath: string) {
    const apiKey = vscode.workspace.getConfiguration('antigravity').get<string>('geminiApiKey');
    if (!apiKey) {
        const action = await vscode.window.showWarningMessage(
            vscode.l10n.t('Please set your Gemini API Key in Settings → Antigravity Explorer → Gemini API Key'),
            vscode.l10n.t('Open Settings')
        );
        if (action) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity.geminiApiKey');
        }
        return;
    }

    // Collect brain conversation data
    const conversations = collectBrainData(antigravityPath);
    if (conversations.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No conversations found.'));
        return;
    }

    // Build the prompt
    const prompt = buildDistillPrompt(conversations);

    // Show progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Distilling brain conversations...'),
        cancellable: false
    }, async () => {
        try {
            const result = await callGeminiApi(apiKey, prompt);

            // Save distilled output
            const distilledDir = path.join(antigravityPath, 'distilled');
            if (!fs.existsSync(distilledDir)) { fs.mkdirSync(distilledDir, { recursive: true }); }

            const dateStr = new Date().toISOString().split('T')[0];
            const outputPath = path.join(distilledDir, `summary-${dateStr}.md`);
            fs.writeFileSync(outputPath, result, 'utf-8');

            // Show in webview
            showDistillResult(result, context);

            vscode.window.showInformationMessage(
                vscode.l10n.t('Brain distillation complete! Saved to distilled/summary-{0}.md', dateStr)
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Distillation failed: ${error.message}`);
        }
    });
}

function collectBrainData(antigravityPath: string): ConversationSummary[] {
    const brainDir = path.join(antigravityPath, 'brain');
    const conversations: ConversationSummary[] = [];

    if (!fs.existsSync(brainDir)) { return conversations; }

    const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));

    for (const dir of dirs) {
        const dirPath = path.join(brainDir, dir.name);

        // Read overview
        let title = dir.name.substring(0, 8);
        const overviewPath = path.join(dirPath, '.system_generated', 'logs', 'overview.txt');
        let overviewContent = '';
        if (fs.existsSync(overviewPath)) {
            try {
                overviewContent = fs.readFileSync(overviewPath, 'utf-8').substring(0, 500);
                const firstLine = overviewContent.split('\n').find(l => l.trim().length > 0);
                if (firstLine) { title = firstLine.trim(); }
            } catch { /* skip */ }
        }

        // Collect artifact metadata
        const artifacts: string[] = [];
        let latestDate = '';
        for (const artifactName of ['task.md', 'walkthrough.md', 'implementation_plan.md']) {
            const metaPath = path.join(dirPath, `${artifactName}.metadata.json`);
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    artifacts.push(`${meta.artifactType || artifactName}: ${(meta.summary || '').substring(0, 100)}`);
                    const date = meta.updatedAt || meta.createdAt || '';
                    if (date > latestDate) { latestDate = date; }
                } catch { /* skip */ }
            }
        }

        conversations.push({
            id: dir.name,
            title,
            date: latestDate || '',
            artifacts
        });
    }

    conversations.sort((a, b) => b.date.localeCompare(a.date));
    return conversations.slice(0, 30); // Limit to 30 most recent
}

function buildDistillPrompt(conversations: ConversationSummary[]): string {
    const convData = conversations.map(c => {
        const arts = c.artifacts.length > 0 ? `\n  Artifacts: ${c.artifacts.join('; ')}` : '';
        return `- [${c.date?.split('T')[0] || 'unknown'}] ${c.title}${arts}`;
    }).join('\n');

    return `You are analyzing an AI coding assistant's conversation history. Based on the following conversation summaries, generate a concise distillation report in Traditional Chinese (繁體中文).

## Conversation Data
${convData}

## Output Format
Generate a markdown report with these sections:
# Brain 粹練報告 — ${new Date().toISOString().split('T')[0]}

## 關鍵決策
- List the most important technical decisions made across conversations

## 技術模式
- Identify recurring technical patterns, frameworks, and tools used

## 常見主題
- Rank the most frequent topics by number of conversations

## 技能建議
- Based on the patterns, suggest skills that could be added or improved

## 時間趨勢
- Note any shifts in focus or technology over time

Keep the report concise and actionable. Focus on insights, not just summaries.`;
}

function callGeminiApi(apiKey: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 4096
            }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message));
                        return;
                    }
                    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
                    resolve(text);
                } catch (e) {
                    reject(new Error('Failed to parse Gemini response'));
                }
            });
        });

        req.on('error', (e) => { reject(e); });
        req.write(postData);
        req.end();
    });
}

function showDistillResult(content: string, context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'antigravityDistill',
        `🧬 ${vscode.l10n.t('Brain Distillation')}`,
        vscode.ViewColumn.One,
        { enableScripts: false }
    );

    // Simple markdown-to-HTML conversion
    const htmlContent = content
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\| (.+?) \|/g, '<td>$1</td>');

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
    body {
        font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 24px;
        line-height: 1.6;
    }
    h1 {
        background: linear-gradient(135deg, #a78bfa, #06b6d4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 8px;
    }
    h2 { color: #818cf8; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; margin-top: 24px; }
    li { margin: 4px 0; padding-left: 8px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid var(--vscode-panel-border); padding: 6px 12px; }
</style>
</head>
<body>${htmlContent}</body>
</html>`;
}
