import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AgentProfile {
    id: string;
    name: string;
    title: string;
    specialty: string[];
    skills: string[];
    color: string;
    model: string;
    avatar: { skin: number; hair: number; eyes: number; accessory: number; hairColor: number; };
    createdAt: string;
}

interface AgentRegistry { version: number; agents: AgentProfile[]; }

interface AgentActivity {
    conversationId: string; title: string;
    status: 'active' | 'recent' | 'idle' | 'done';
    progress: number; lastActive: string;
    taskItems: { text: string; done: boolean }[];
}

export class AgentOfficePanel {
    public static currentPanel: AgentOfficePanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly antigravityPath: string;
    private disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext, antigravityPath: string) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (AgentOfficePanel.currentPanel) {
            AgentOfficePanel.currentPanel.panel.reveal(column);
            AgentOfficePanel.currentPanel.update();
            return;
        }
        const panel = vscode.window.createWebviewPanel('antigravityAgentOffice', '🏢 Digital Office', column, { enableScripts: true, retainContextWhenHidden: true });
        AgentOfficePanel.currentPanel = new AgentOfficePanel(panel, antigravityPath, context);
    }

    private constructor(panel: vscode.WebviewPanel, antigravityPath: string, _context: vscode.ExtensionContext) {
        this.panel = panel;
        this.antigravityPath = antigravityPath;
        this.update();

        this.panel.webview.onDidReceiveMessage((msg) => {
            if (msg.command === 'createAgent') { this.saveAgent(msg.agent); this.update(); }
            else if (msg.command === 'updateAgent') { this.saveAgent(msg.agent); this.update(); }
            else if (msg.command === 'deleteAgent') { this.deleteAgent(msg.agentId); this.update(); }
            else if (msg.command === 'startChat') { this.startAgentChat(msg.agentId).then(() => this.update()); }
            else if (msg.command === 'viewMemory') {
                const memPath = path.join(antigravityPath, 'agents', msg.agentId, 'memory.md');
                const dir = path.join(antigravityPath, 'agents', msg.agentId);
                if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
                if (!fs.existsSync(memPath)) { fs.writeFileSync(memPath, `# ${msg.agentId} 的專屬記憶\n\n（在此記錄此 Agent 的工作進度和重要筆記）\n`, 'utf-8'); }
                vscode.window.showTextDocument(vscode.Uri.file(memPath));
            }
            else if (msg.command === 'openTaskFile') {
                const taskPath = path.join(antigravityPath, 'brain', msg.conversationId, 'task.md');
                if (fs.existsSync(taskPath)) {
                    vscode.window.showTextDocument(vscode.Uri.file(taskPath), { preview: true });
                } else {
                    // Try walkthrough.md as fallback
                    const walkPath = path.join(antigravityPath, 'brain', msg.conversationId, 'walkthrough.md');
                    if (fs.existsSync(walkPath)) {
                        vscode.window.showTextDocument(vscode.Uri.file(walkPath), { preview: true });
                    } else {
                        vscode.window.showWarningMessage('No task.md or walkthrough.md found for this conversation.');
                    }
                }
            }
        }, undefined, this.disposables);
        this.panel.onDidDispose(() => { AgentOfficePanel.currentPanel = undefined; this.disposables.forEach(d => d.dispose()); }, null, this.disposables);
    }

    private getActiveAgentId(): string {
        const p = path.join(this.antigravityPath, 'agents', '.active');
        try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : ''; } catch { return ''; }
    }
    private setActiveAgentId(id: string) {
        const p = path.join(this.antigravityPath, 'agents', '.active');
        try { fs.writeFileSync(p, id, 'utf-8'); } catch { /* skip */ }
    }

    private update() {
        const agents = this.loadAgents();
        const activities = this.scanActivities();
        const activeId = this.getActiveAgentId();
        this.panel.webview.html = this.getHtml(agents, activities, activeId);
    }

    private getRegistryPath(): string { return path.join(this.antigravityPath, 'agents', 'agents-registry.json'); }

    private loadAgents(): AgentProfile[] {
        const regPath = this.getRegistryPath();
        if (fs.existsSync(regPath)) { try { return (JSON.parse(fs.readFileSync(regPath, 'utf-8')) as AgentRegistry).agents || []; } catch { /* skip */ } }
        return [];
    }

    private saveAgent(agent: AgentProfile) {
        const agentsDir = path.join(this.antigravityPath, 'agents');
        if (!fs.existsSync(agentsDir)) { fs.mkdirSync(agentsDir, { recursive: true }); }
        const agents = this.loadAgents();
        const idx = agents.findIndex(a => a.id === agent.id);
        if (idx >= 0) { agents[idx] = agent; } else { agents.push(agent); }
        fs.writeFileSync(this.getRegistryPath(), JSON.stringify({ version: 1, agents } as AgentRegistry, null, 2), 'utf-8');
        const agentDir = path.join(agentsDir, agent.id);
        if (!fs.existsSync(agentDir)) { fs.mkdirSync(agentDir, { recursive: true }); }
        const promptPath = path.join(agentDir, 'startup-prompt.md');
        if (!fs.existsSync(promptPath)) {
            fs.writeFileSync(promptPath, `你是 ${agent.name}，一位專精${agent.specialty.join('、')}的 AI 助手。\n職稱：${agent.title}\n請用繁體中文回覆，風格簡潔專業。\n\n以下是你過去的工作記錄：\n（請參考 memory.md）\n`, 'utf-8');
        }
        const memPath = path.join(agentDir, 'memory.md');
        if (!fs.existsSync(memPath)) { fs.writeFileSync(memPath, `# ${agent.name} 的專屬記憶\n\n`, 'utf-8'); }
    }

    private deleteAgent(agentId: string) {
        const agents = this.loadAgents().filter(a => a.id !== agentId);
        fs.writeFileSync(this.getRegistryPath(), JSON.stringify({ version: 1, agents } as AgentRegistry, null, 2), 'utf-8');
    }

    private async startAgentChat(agentId: string) {
        const agent = this.loadAgents().find(a => a.id === agentId);
        if (!agent) { return; }
        const promptPath = path.join(this.antigravityPath, 'agents', agentId, 'startup-prompt.md');
        const memPath = path.join(this.antigravityPath, 'agents', agentId, 'memory.md');
        let prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : '';
        if (fs.existsSync(memPath)) { prompt += '\n\n---\n## 專屬記憶\n' + fs.readFileSync(memPath, 'utf-8'); }

        // Also inject into AGENTS.md for workspace context
        const MARKER_START = '<!-- AGENT:START -->';
        const MARKER_END = '<!-- AGENT:END -->';
        const agentBlock = `${MARKER_START}\n${prompt}\n${MARKER_END}`;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const wsRoot = workspaceFolders[0].uri.fsPath;
            const agentsMdPath = path.join(wsRoot, 'AGENTS.md');
            try {
                let existing = '';
                if (fs.existsSync(agentsMdPath)) {
                    existing = fs.readFileSync(agentsMdPath, 'utf-8');
                }
                const startIdx = existing.indexOf(MARKER_START);
                const endIdx = existing.indexOf(MARKER_END);
                let newContent: string;
                if (startIdx >= 0 && endIdx >= 0) {
                    newContent = existing.substring(0, startIdx) + agentBlock + existing.substring(endIdx + MARKER_END.length);
                } else {
                    newContent = agentBlock + '\n\n' + existing;
                }
                fs.writeFileSync(agentsMdPath, newContent, 'utf-8');
            } catch { /* skip */ }
        }

        this.setActiveAgentId(agentId);

        // Copy to clipboard
        await vscode.env.clipboard.writeText(prompt);

        // Try to open chat with prompt pre-filled
        const introMsg = `以下是我的身分設定，請記住並依此身份回覆：\n\n${prompt}`;
        let chatOpened = false;

        // Method 1: Try chat.open with query (VS Code 1.90+)
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: introMsg, isPartialQuery: false });
            chatOpened = true;
        } catch { /* skip */ }

        // Method 2: Try newChat then type
        if (!chatOpened) {
            try {
                await vscode.commands.executeCommand('workbench.action.chat.newChat');
                // Insert text into chat input
                await vscode.commands.executeCommand('workbench.action.chat.open', { query: introMsg });
                chatOpened = true;
            } catch { /* skip */ }
        }

        if (!chatOpened) {
            try { await vscode.commands.executeCommand('workbench.action.chat.open'); } catch { /* skip */ }
        }

        vscode.window.showInformationMessage(
            vscode.l10n.t(`✅ {0} activated! Prompt sent to chat.`, agent.name)
        );
    }

    private scanActivities(): AgentActivity[] {
        const brainDir = path.join(this.antigravityPath, 'brain');
        if (!fs.existsSync(brainDir)) { return []; }
        const activities: AgentActivity[] = [];
        const now = Date.now();
        const dirs = fs.readdirSync(brainDir, { withFileTypes: true }).filter(d => d.isDirectory() && /^[0-9a-f]{8}-/.test(d.name));
        for (const dir of dirs) {
            const taskPath = path.join(brainDir, dir.name, 'task.md');
            if (!fs.existsSync(taskPath)) { continue; }
            try {
                const stat = fs.statSync(taskPath);
                const content = fs.readFileSync(taskPath, 'utf-8');
                const ageMs = now - stat.mtimeMs;
                const items: { text: string; done: boolean }[] = [];
                let title = dir.name.substring(0, 8);
                for (const line of content.split('\n')) {
                    const h1 = line.match(/^#\s+(.+)/);
                    if (h1 && title === dir.name.substring(0, 8)) { title = h1[1].trim().substring(0, 50); }
                    const m = line.match(/^[-*]\s*\[([ x/])\]\s*(.+)/);
                    if (m) { items.push({ text: m[2].trim(), done: m[1] === 'x' }); }
                }
                const inProgress = items.some(i => !i.done);
                const total = items.length;
                const done = items.filter(i => i.done).length;
                const progress = total > 0 ? Math.round((done / total) * 100) : 0;
                let status: AgentActivity['status'] = 'done';
                if (inProgress && ageMs < 5 * 60 * 1000) { status = 'active'; }
                else if (inProgress && ageMs < 60 * 60 * 1000) { status = 'recent'; }
                else if (inProgress) { status = 'idle'; }
                activities.push({ conversationId: dir.name, title, status, progress, lastActive: stat.mtime.toISOString(), taskItems: items });
            } catch { /* skip */ }
        }
        activities.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
        return activities.slice(0, 30);
    }

    private esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    private getHtml(agents: AgentProfile[], activities: AgentActivity[], activeId: string = ''): string {
        const safeJson = (obj: unknown) => JSON.stringify(obj).replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/<\/script>/gi, '<\\/script>');
        const activeCount = activities.filter(a => a.status === 'active').length;
        const recentCount = activities.filter(a => a.status === 'recent').length;
        const doneCount = activities.filter(a => a.status === 'done').length;

        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
:root{--bg:var(--vscode-editor-background);--fg:var(--vscode-editor-foreground);--card:var(--vscode-sideBar-background,#1e1e2e);--border:var(--vscode-panel-border,#333);--accent:#818cf8;--accent2:#06b6d4;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:var(--vscode-font-family,'Segoe UI',sans-serif);background:var(--bg);color:var(--fg);padding:24px;}
h1{font-size:1.7em;background:linear-gradient(135deg,#a78bfa,#06b6d4,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;}
.sub{opacity:.6;font-size:.88em;margin-bottom:20px;}
.stats{display:flex;gap:12px;margin-bottom:28px;}
.stat{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 22px;text-align:center;flex:1;position:relative;overflow:hidden;}
.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));}
.stat .n{font-size:2em;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.stat .l{opacity:.6;font-size:.78em;margin-top:4px;}
h2{font-size:1.1em;margin:22px 0 12px;display:flex;align-items:center;gap:8px;}
h2 .cnt{opacity:.4;font-weight:400;font-size:.8em;}
.ag{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
.ac{background:linear-gradient(145deg,var(--card),rgba(30,30,46,0.9));border:1px solid var(--border);border-radius:16px;padding:20px;position:relative;overflow:hidden;transition:all .25s;cursor:default;}
.ac:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(129,140,248,0.12);border-color:rgba(129,140,248,0.3);}
.ac .bar{position:absolute;top:0;left:0;right:0;height:3px;border-radius:16px 16px 0 0;}
.ac .glow{position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;opacity:.06;pointer-events:none;}
.ac .top{display:flex;align-items:center;gap:14px;margin:4px 0 12px;}
.ac .av{width:56px;height:56px;border-radius:50%;overflow:hidden;border:2px solid;flex-shrink:0;background:rgba(0,0,0,0.2);cursor:pointer;transition:transform .2s;}
.ac .av:hover{transform:scale(1.1);}
.ac .av svg{width:100%;height:100%;}
.ac .nm{font-weight:700;font-size:1.05em;}
.ac .tt{font-size:.75em;opacity:.55;margin-top:1px;}
.ac .tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;}
.ac .tag{font-size:.62em;padding:3px 9px;border-radius:12px;font-weight:500;}
.ac .acts{display:flex;gap:6px;}
.ac .btn{flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.02);color:var(--fg);cursor:pointer;font-size:.76em;text-align:center;transition:all .2s;font-weight:500;}
.ac .btn:hover{background:rgba(129,140,248,0.1);border-color:var(--accent);}
.ac .btn.go{background:linear-gradient(135deg,rgba(129,140,248,0.15),rgba(6,182,212,0.1));border-color:var(--accent);color:#c4b5fd;}
.ac .btn.ed{color:#fbbf24;}
.ac.active{border-color:rgba(34,197,94,0.5);box-shadow:0 0 24px rgba(34,197,94,0.15),inset 0 0 20px rgba(34,197,94,0.03);}
.ac.active .bar{background:linear-gradient(90deg,#22c55e,#06b6d4)!important;}
.ac .badge{display:none;position:absolute;top:10px;right:36px;font-size:.6em;padding:2px 8px;border-radius:8px;background:rgba(34,197,94,0.15);color:#22c55e;font-weight:600;letter-spacing:.03em;}
.ac.active .badge{display:block;}
@keyframes pulse{0%,100%{box-shadow:0 0 24px rgba(34,197,94,0.15)}50%{box-shadow:0 0 32px rgba(34,197,94,0.25)}}
.ac.active{animation:pulse 3s ease-in-out infinite;}
.ac .del{position:absolute;top:10px;right:10px;background:none;border:none;color:var(--fg);cursor:pointer;font-size:.7em;opacity:0;transition:opacity .2s;border-radius:4px;padding:2px 6px;}
.ac:hover .del{opacity:.4;}.ac .del:hover{opacity:1;color:#f87171;background:rgba(248,113,113,0.1);}
.add{background:var(--card);border:2px dashed var(--border);border-radius:16px;min-height:180px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .25s;flex-direction:column;gap:8px;}
.add:hover{border-color:var(--accent);background:rgba(129,140,248,0.03);}
.add span{font-size:1.8em;}.add .albl{opacity:.5;font-size:.85em;}
.actg{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;}
.actc{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 16px;border-left:3px solid transparent;transition:all .2s;}
.actc:hover{border-color:rgba(129,140,248,0.2);}
.acth{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.dot.active{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,0.5);}
.dot.recent{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,0.4);}
.dot.idle{background:#6b7280;}.dot.done{background:#3b82f6;}
.acttl{font-size:.86em;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.acttm{font-size:.68em;opacity:.4;}
.pbar{height:4px;background:rgba(129,140,248,0.08);border-radius:2px;margin-top:6px;overflow:hidden;}
.pfill{height:100%;border-radius:2px;transition:width .3s;}
.mo{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:200;justify-content:center;align-items:center;backdrop-filter:blur(4px);}
.mo.open{display:flex;}
.md{background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:28px;width:480px;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);}
.md h3{font-size:1.15em;margin-bottom:18px;text-align:center;}
.fr{margin-bottom:14px;}
.fr label{display:block;font-size:.78em;font-weight:600;margin-bottom:5px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em;}
.fr input{width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--vscode-input-background,#1e1e2e);color:var(--vscode-input-foreground,#ccc);font-size:.88em;}
.fr input:focus{outline:none;border-color:var(--accent);}
.aprev{width:88px;height:88px;border-radius:50%;background:rgba(129,140,248,0.08);margin:0 auto 16px;overflow:hidden;border:3px solid var(--accent);box-shadow:0 0 20px rgba(129,140,248,0.15);}
.aprev svg{width:100%;height:100%;}
.opts{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
.opt{width:38px;height:38px;border-radius:10px;border:2px solid transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;background:rgba(255,255,255,0.03);overflow:hidden;}
.opt:hover,.opt.sel{border-color:var(--accent);background:rgba(129,140,248,0.1);}
.opt svg{width:30px;height:30px;}
.copt{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:all .15s;}
.copt:hover,.copt.sel{border-color:#fff;transform:scale(1.15);box-shadow:0 0 8px currentColor;}
.macts{display:flex;gap:10px;margin-top:20px;justify-content:center;}
.mbtn{padding:9px 24px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--fg);cursor:pointer;font-size:.88em;font-weight:500;transition:all .2s;}
.mbtn.pri{background:linear-gradient(135deg,rgba(129,140,248,0.2),rgba(6,182,212,0.15));border-color:var(--accent);color:#c4b5fd;}
.mbtn:hover{opacity:.85;}
.rnd-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:rgba(129,140,248,0.08);color:var(--fg);cursor:pointer;font-size:.78em;transition:all .2s;}
.rnd-btn:hover{background:rgba(129,140,248,0.2);border-color:var(--accent);}
</style></head><body>
<h1>🏢 Digital Office</h1>
<p class="sub">${this.esc(vscode.l10n.t('Your AI team at a glance'))}</p>

<div class="stats">
<div class="stat"><div class="n">${agents.length}</div><div class="l">${this.esc(vscode.l10n.t('Team Members'))}</div></div>
<div class="stat"><div class="n">${activeCount}</div><div class="l">🟢 ${this.esc(vscode.l10n.t('Active'))}</div></div>
<div class="stat"><div class="n">${recentCount}</div><div class="l">🟡 ${this.esc(vscode.l10n.t('Recent'))}</div></div>
<div class="stat"><div class="n">${doneCount}</div><div class="l">✅ ${this.esc(vscode.l10n.t('Completed'))}</div></div>
</div>

<h2>👥 ${this.esc(vscode.l10n.t('Team Members'))} <span class="cnt">(${agents.length})</span></h2>
<div class="ag" id="agentGrid"></div>

<h2>📊 ${this.esc(vscode.l10n.t('Recent Activity'))} <span class="cnt">(${activities.length})</span></h2>
<div class="actg" id="actGrid"></div>

<div class="mo" id="modal"><div class="md">
<h3 id="modalTitle">✨ ${this.esc(vscode.l10n.t('Create New Agent'))}</h3>
<div class="aprev" id="avPrev"></div>
<div style="text-align:center;margin-bottom:14px;"><button class="rnd-btn" id="rndBtn">🎲 Random</button></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Skin'))}</label><div class="opts" id="skinO"></div></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Hair Style'))}</label><div class="opts" id="hairO"></div></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Hair Color'))}</label><div class="opts" id="hcO"></div></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Eyes'))}</label><div class="opts" id="eyeO"></div></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Accessory'))}</label><div class="opts" id="accO"></div></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Name'))}</label><input id="aName" placeholder="e.g. Arya"/></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Title'))}</label><input id="aTitle" placeholder="e.g. Backend Architect"/></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Specialty (comma separated)'))}</label><input id="aSpec" placeholder="e.g. C#, .NET, API"/></div>
<div class="fr"><label>${this.esc(vscode.l10n.t('Theme Color'))}</label><div class="opts" id="colO"></div></div>
<div class="macts">
<button class="mbtn" id="cancelBtn">${this.esc(vscode.l10n.t('Cancel'))}</button>
<button class="mbtn pri" id="saveBtn">${this.esc(vscode.l10n.t('Create'))}</button>
</div></div></div>

<script>
(function(){
const vscode=acquireVsCodeApi();
const agents=${safeJson(agents)};
const activities=${safeJson(activities)};
const activeAgentId=${safeJson(activeId)};

const SKINS=['#FDDCB5','#F5C6A0','#D4A07A','#B07850','#8D5B3A','#5C3A21'];
const HAIR_COLORS=['#2C1B0E','#4A3728','#8B6F47','#C4A35A','#D4541E','#E8E8E8'];
const COLORS=['#818cf8','#06b6d4','#f472b6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
const HAIR_COUNT=16, EYE_COUNT=6, ACC_COUNT=7;

/* ── Full-size avatar (viewBox 0 0 48 48, head cx=24 cy=24 r=16) ── */
function buildAvatar(skin,hair,hc,eyes,acc){
    const s=SKINS[skin]||SKINS[0], h=HAIR_COLORS[hc]||HAIR_COLORS[0];
    const HP=[
        '', // 0 bald
        '<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="H"/>', // 1 short crop
        '<path d="M9,18 Q9,5 24,4 Q39,5 39,18 L37,10 Q35,6 24,6 Q13,6 11,10Z" fill="H"/><path d="M9,18 Q8,24 9,28 L11,22Z" fill="H"/><path d="M39,18 Q40,24 39,28 L37,22Z" fill="H"/>', // 2 medium
        '<path d="M8,18 Q8,4 24,3 Q40,4 40,18 L38,10 Q36,5 24,5 Q12,5 10,10Z" fill="H"/><path d="M8,18 Q6,28 8,36 L10,24Z" fill="H"/><path d="M40,18 Q42,28 40,36 L38,24Z" fill="H"/>', // 3 long straight
        '<ellipse cx="24" cy="12" rx="16" ry="11" fill="H"/><circle cx="10" cy="18" r="5" fill="H"/><circle cx="38" cy="18" r="5" fill="H"/>', // 4 afro
        '<path d="M11,17 Q13,6 24,5 Q35,6 37,17 Q35,10 24,9 Q13,10 11,17Z" fill="H"/><path d="M37,17 Q40,16 42,24 L39,20Z" fill="H"/>', // 5 side swept
        '<path d="M10,17 Q10,3 24,3 Q38,3 38,17" fill="none" stroke="H" stroke-width="4"/><circle cx="11" cy="15" r="4" fill="H"/><circle cx="37" cy="15" r="4" fill="H"/><circle cx="15" cy="10" r="3" fill="H"/><circle cx="33" cy="10" r="3" fill="H"/><circle cx="24" cy="8" r="3.5" fill="H"/>', // 6 curly
        '<path d="M11,17 Q11,6 24,5 Q37,6 37,17 L35,12 Q33,7 24,7 Q15,7 13,12Z" fill="H"/><path d="M15,5 Q18,0 21,4" stroke="H" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M22,4 Q24,-1 27,4" stroke="H" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M27,5 Q30,0 33,5" stroke="H" stroke-width="2.2" fill="none" stroke-linecap="round"/>', // 7 spiky
        '<path d="M10,18 Q10,5 24,4 Q38,5 38,18 L36,11 Q34,6 24,6 Q14,6 12,11Z" fill="H"/><path d="M14,8 Q16,2 24,1 Q32,2 34,8 Q30,4 24,3 Q18,4 14,8Z" fill="H"/>', // 8 pompadour
        '<path d="M12,17 Q12,8 18,6 L17,3 Q24,0 31,3 L30,6 Q36,8 36,17 L34,12 Q32,8 24,7 Q16,8 14,12Z" fill="H"/>', // 9 faux hawk
        '<path d="M9,18 Q9,5 24,4 Q39,5 39,18 L37,10 Q35,6 24,6 Q13,6 11,10Z" fill="H"/><path d="M12,9 Q14,6 18,8 Q20,5 24,7 Q28,5 30,8 Q34,6 36,9" fill="none" stroke="H" stroke-width="2.5" stroke-linecap="round"/>', // 10 wavy
        '<path d="M13,17 Q13,6 24,5 Q35,6 35,17 L33,12 Q31,8 24,7 Q17,8 15,12Z" fill="H"/><path d="M24,5 L24,0" stroke="H" stroke-width="3" stroke-linecap="round"/><path d="M19,6 L16,1" stroke="H" stroke-width="2.5" stroke-linecap="round"/><path d="M29,6 L32,1" stroke="H" stroke-width="2.5" stroke-linecap="round"/>', // 11 punk
        '<path d="M8,18 Q8,4 24,3 Q40,4 40,18 L38,10 Q36,5 24,5 Q12,5 10,10Z" fill="H"/><path d="M8,18 Q7,23 8,27 Q10,23 10,18Z" fill="H"/><path d="M40,18 Q41,23 40,27 Q38,23 38,18Z" fill="H"/>', // 12 bob cut ♀
        '<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="H"/><path d="M33,16 Q38,22 35,32 Q33,37 31,40" stroke="H" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="30" cy="41" r="3" fill="H"/>', // 13 ponytail ♀
        '<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="H"/><path d="M12,16 Q7,24 10,36" stroke="H" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M36,16 Q41,24 38,36" stroke="H" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="10" cy="37" r="3" fill="H"/><circle cx="38" cy="37" r="3" fill="H"/>', // 14 twin tails ♀
        '<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="H"/><circle cx="24" cy="5" r="6" fill="H"/><circle cx="24" cy="4" r="4" fill="H"/>' // 15 bun ♀
    ];
    const EP=[
        '<circle cx="18" cy="22" r="2" fill="#333"/><circle cx="30" cy="22" r="2" fill="#333"/>',
        '<ellipse cx="18" cy="22" rx="2.5" ry="2" fill="#333"/><ellipse cx="30" cy="22" rx="2.5" ry="2" fill="#333"/>',
        '<circle cx="18" cy="22" r="2.5" fill="#333"/><circle cx="30" cy="22" r="2.5" fill="#333"/><circle cx="19" cy="21.2" r=".9" fill="#fff"/><circle cx="31" cy="21.2" r=".9" fill="#fff"/>',
        '<path d="M16,22 Q18,19 20,22 Q18,24.5 16,22Z" fill="#333"/><path d="M28,22 Q30,19 32,22 Q30,24.5 28,22Z" fill="#333"/>',
        '<ellipse cx="18" cy="22" rx="2" ry="1.5" fill="#333"/><ellipse cx="30" cy="22" rx="2" ry="1.5" fill="#333"/><path d="M15,20 L21,19.5" stroke="#333" stroke-width=".8"/><path d="M27,19.5 L33,20" stroke="#333" stroke-width=".8"/>',
        '<path d="M16,23 Q18,20 20,23" fill="none" stroke="#333" stroke-width="1.2"/><path d="M28,23 Q30,20 32,23" fill="none" stroke="#333" stroke-width="1.2"/><circle cx="18" cy="21.5" r="1" fill="#333"/><circle cx="30" cy="21.5" r="1" fill="#333"/>'
    ];
    const AP=[
        '',
        '<rect x="14" y="20" width="8" height="5" rx="2.5" fill="none" stroke="#888" stroke-width=".8"/><rect x="26" y="20" width="8" height="5" rx="2.5" fill="none" stroke="#888" stroke-width=".8"/><line x1="22" y1="22.5" x2="26" y2="22.5" stroke="#888" stroke-width=".8"/>',
        '<rect x="13" y="19.5" width="9" height="6" rx="3" fill="rgba(40,40,40,0.5)" stroke="#444" stroke-width=".7"/><rect x="26" y="19.5" width="9" height="6" rx="3" fill="rgba(40,40,40,0.5)" stroke="#444" stroke-width=".7"/><line x1="22" y1="22.5" x2="26" y2="22.5" stroke="#444" stroke-width=".7"/>',
        '<path d="M8,10 Q8,4 16,4 L32,4 Q40,4 40,10" fill="none" stroke="#666" stroke-width="1.5"/><rect x="8" y="10" width="32" height="2.5" rx="1.2" fill="#666"/>',
        '<path d="M6,18 Q4,15.5 6.5,13.5 Q9,12 10.5,14" fill="#f59e0b"/><path d="M42,18 Q44,15.5 41.5,13.5 Q39,12 37.5,14" fill="#f59e0b"/><path d="M6,18 L10.5,14" stroke="#777" stroke-width=".8"/><path d="M42,18 L37.5,14" stroke="#777" stroke-width=".8"/>',
        '<circle cx="36" cy="30" r="2.2" fill="#f59e0b" stroke="#d97706" stroke-width=".5"/><circle cx="36" cy="30" r="1" fill="#fbbf24"/>',
        '<path d="M11,7 L24,3 L37,7" fill="none" stroke="#ef4444" stroke-width="2"/><rect x="11" y="7" width="26" height="4" rx="2" fill="#ef4444"/><circle cx="24" cy="7" r="1.5" fill="#fff"/>'
    ];
    let svg='<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">';
    svg+='<circle cx="24" cy="24" r="16" fill="'+s+'"/>';
    svg+=(HP[hair]||'').replace(/H/g,h);
    svg+=(EP[eyes]||EP[0]);
    svg+='<path d="M20,30 Q24,33 28,30" fill="none" stroke="#333" stroke-width="1" stroke-linecap="round"/>';
    svg+=(AP[acc]||'');
    svg+='</svg>';
    return svg;
}

/* ── Mini hair preview (viewBox 0 0 28 28, head cx=14 cy=16 r=9) ── */
function miniHair(i){
    const c='#999';
    const M=[
        '<circle cx="14" cy="16" r="9" fill="none" stroke="#666" stroke-width=".5" stroke-dasharray="2"/>', // 0 bald
        '<path d="M6,12 Q6,5 14,4 Q22,5 22,12 L20,9 Q18,6 14,6 Q10,6 8,9Z" fill="C"/>', // 1
        '<path d="M5,13 Q5,4 14,3 Q23,4 23,13 L21,8 Q19,5 14,5 Q9,5 7,8Z" fill="C"/><path d="M5,13 Q4,17 5,19 L7,15Z" fill="C"/><path d="M23,13 Q24,17 23,19 L21,15Z" fill="C"/>', // 2
        '<path d="M5,13 Q5,3 14,2 Q23,3 23,13 L21,8 Q19,4 14,4 Q9,4 7,8Z" fill="C"/><path d="M5,13 Q3,19 5,24 L7,17Z" fill="C"/><path d="M23,13 Q25,19 23,24 L21,17Z" fill="C"/>', // 3
        '<ellipse cx="14" cy="9" rx="11" ry="8" fill="C"/><circle cx="6" cy="13" r="3.5" fill="C"/><circle cx="22" cy="13" r="3.5" fill="C"/>', // 4
        '<path d="M8,12 Q9,5 14,4 Q19,5 20,12 Q19,8 14,7 Q9,8 8,12Z" fill="C"/><path d="M20,12 Q22,11 24,17 L21,14Z" fill="C"/>', // 5
        '<path d="M6,12 Q6,3 14,3 Q22,3 22,12" fill="none" stroke="C" stroke-width="2.5"/><circle cx="7" cy="11" r="2.5" fill="C"/><circle cx="21" cy="11" r="2.5" fill="C"/><circle cx="14" cy="7" r="2.2" fill="C"/>', // 6
        '<path d="M7,12 Q7,5 14,4 Q21,5 21,12 L19,9 Q17,6 14,6 Q11,6 9,9Z" fill="C"/><path d="M10,4 Q12,1 14,3" stroke="C" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M14,3 Q16,1 18,4" stroke="C" stroke-width="1.5" fill="none" stroke-linecap="round"/>', // 7
        '<path d="M6,13 Q6,4 14,3 Q22,4 22,13 L20,8 Q18,5 14,5 Q10,5 8,8Z" fill="C"/><path d="M9,7 Q11,3 14,2 Q17,3 19,7 Q16,4 14,3 Q12,4 9,7Z" fill="C"/>', // 8
        '<path d="M8,12 Q8,6 12,5 L11,3 Q14,1 17,3 L16,5 Q20,6 20,12 L18,9 Q17,6 14,6 Q11,6 10,9Z" fill="C"/>', // 9
        '<path d="M5,13 Q5,4 14,3 Q23,4 23,13 L21,8 Q19,5 14,5 Q9,5 7,8Z" fill="C"/><path d="M8,7 Q10,5 12,7 Q14,4 16,7 Q18,5 20,7" fill="none" stroke="C" stroke-width="1.8" stroke-linecap="round"/>', // 10
        '<path d="M8,12 Q8,5 14,4 Q20,5 20,12 L18,9 Q17,6 14,6 Q11,6 10,9Z" fill="C"/><path d="M14,4 L14,1" stroke="C" stroke-width="2" stroke-linecap="round"/><path d="M11,5 L9,2" stroke="C" stroke-width="1.5" stroke-linecap="round"/><path d="M17,5 L19,2" stroke="C" stroke-width="1.5" stroke-linecap="round"/>', // 11
        '<path d="M5,13 Q5,3 14,2 Q23,3 23,13 L21,8 Q19,4 14,4 Q9,4 7,8Z" fill="C"/><path d="M5,13 Q4,16 5,18 Q7,15 7,13Z" fill="C"/><path d="M23,13 Q24,16 23,18 Q21,15 21,13Z" fill="C"/>', // 12 bob
        '<path d="M6,12 Q6,5 14,4 Q22,5 22,12 L20,9 Q18,6 14,6 Q10,6 8,9Z" fill="C"/><path d="M19,11 Q22,15 20,22" stroke="C" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="20" cy="23" r="2" fill="C"/>', // 13 ponytail
        '<path d="M6,12 Q6,5 14,4 Q22,5 22,12 L20,9 Q18,6 14,6 Q10,6 8,9Z" fill="C"/><path d="M8,11 Q5,17 7,24" stroke="C" stroke-width="2" fill="none"/><path d="M20,11 Q23,17 21,24" stroke="C" stroke-width="2" fill="none"/><circle cx="7" cy="24" r="2" fill="C"/><circle cx="21" cy="24" r="2" fill="C"/>', // 14 twin tails
        '<path d="M6,12 Q6,5 14,4 Q22,5 22,12 L20,9 Q18,6 14,6 Q10,6 8,9Z" fill="C"/><circle cx="14" cy="4" r="4" fill="C"/><circle cx="14" cy="3" r="2.8" fill="C"/>' // 15 bun
    ];
    return '<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="16" r="9" fill="#ddd" opacity=".3"/>'+(M[i]||M[0]).replace(/C/g,c)+'</svg>';
}

/* ── Edit state ── */
let ms={skin:0,hair:1,hairColor:0,eyes:0,acc:0,color:0};
let editId=null; // null=create, string=edit
const modal=document.getElementById('modal');

function renderPickers(){
    document.getElementById('skinO').innerHTML=SKINS.map((c,i)=>'<div class="copt '+(i===ms.skin?'sel':'')+'" data-t="skin" data-v="'+i+'" style="background:'+c+'"></div>').join('');
    document.getElementById('hairO').innerHTML=Array.from({length:HAIR_COUNT},(_,i)=>'<div class="opt '+(i===ms.hair?'sel':'')+'" data-t="hair" data-v="'+i+'">'+miniHair(i)+'</div>').join('');
    document.getElementById('hcO').innerHTML=HAIR_COLORS.map((c,i)=>'<div class="copt '+(i===ms.hairColor?'sel':'')+'" data-t="hairColor" data-v="'+i+'" style="background:'+c+'"></div>').join('');
    document.getElementById('eyeO').innerHTML=['●','◉','✦','◆','—','∪'].map((e,i)=>'<div class="opt '+(i===ms.eyes?'sel':'')+'" data-t="eyes" data-v="'+i+'">'+e+'</div>').join('');
    document.getElementById('accO').innerHTML=['🚫','👓','🕶','🎩','🎧','💎','🧢'].map((e,i)=>'<div class="opt '+(i===ms.acc?'sel':'')+'" data-t="acc" data-v="'+i+'">'+e+'</div>').join('');
    document.getElementById('colO').innerHTML=COLORS.map((c,i)=>'<div class="copt '+(i===ms.color?'sel':'')+'" data-t="color" data-v="'+i+'" style="background:'+c+'"></div>').join('');
    document.getElementById('avPrev').innerHTML=buildAvatar(ms.skin,ms.hair,ms.hairColor,ms.eyes,ms.acc);
}

function openCreateModal(){
    editId=null;
    ms={skin:0,hair:1,hairColor:0,eyes:0,acc:0,color:0};
    document.getElementById('aName').value='';
    document.getElementById('aTitle').value='';
    document.getElementById('aSpec').value='';
    document.getElementById('aName').disabled=false;
    document.getElementById('modalTitle').textContent='✨ Create New Agent';
    document.getElementById('saveBtn').textContent='Create';
    modal.classList.add('open');
    renderPickers();
}

function openEditModal(agentId){
    const a=agents.find(x=>x.id===agentId);
    if(!a) return;
    editId=agentId;
    const av=a.avatar||{skin:0,hair:1,eyes:0,accessory:0,hairColor:0};
    ms={skin:av.skin||0,hair:av.hair||0,hairColor:av.hairColor||0,eyes:av.eyes||0,acc:av.accessory||0,color:COLORS.indexOf(a.color||'#818cf8')};
    if(ms.color<0) ms.color=0;
    document.getElementById('aName').value=a.name||'';
    document.getElementById('aTitle').value=a.title||'';
    document.getElementById('aSpec').value=(a.specialty||[]).join(', ');
    document.getElementById('aName').disabled=true; // can't change ID
    document.getElementById('modalTitle').textContent='✏️ Edit '+a.name;
    document.getElementById('saveBtn').textContent='Save';
    modal.classList.add('open');
    renderPickers();
}

document.querySelector('.md').addEventListener('click',function(e){
    const o=e.target.closest('[data-t]');
    if(!o)return;
    ms[o.dataset.t]=parseInt(o.dataset.v);
    renderPickers();
});

document.getElementById('rndBtn').addEventListener('click',function(){
    ms.skin=Math.floor(Math.random()*SKINS.length);
    ms.hair=Math.floor(Math.random()*HAIR_COUNT);
    ms.hairColor=Math.floor(Math.random()*HAIR_COLORS.length);
    ms.eyes=Math.floor(Math.random()*EYE_COUNT);
    ms.acc=Math.floor(Math.random()*ACC_COUNT);
    ms.color=Math.floor(Math.random()*COLORS.length);
    renderPickers();
});

function escH(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function renderAgents(){
    const g=document.getElementById('agentGrid');
    g.innerHTML=agents.map(a=>{
        const av=a.avatar||{skin:0,hair:1,eyes:0,accessory:0,hairColor:0};
        const col=a.color||'#818cf8';
        const isActive=a.id===activeAgentId;
        return '<div class="ac'+(isActive?' active':'')+'" data-agentid="'+a.id+'"><div class="bar" style="background:linear-gradient(90deg,'+col+','+col+'88)"></div>'+
        '<div class="glow" style="background:'+col+'"></div>'+
        '<span class="badge">🟢 ACTIVE</span>'+
        '<button class="del" data-del="'+a.id+'">✕</button>'+
        '<div class="top"><div class="av" style="border-color:'+(isActive?'#22c55e':col)+'" data-edit="'+a.id+'" title="Click to edit">'+buildAvatar(av.skin,av.hair,av.hairColor,av.eyes,av.accessory)+'</div>'+
        '<div><div class="nm">'+escH(a.name)+'</div><div class="tt">'+escH(a.title||'')+'</div></div></div>'+
        '<div class="tags">'+(a.specialty||[]).map(s=>'<span class="tag" style="background:'+col+'18;color:'+col+'">'+escH(s)+'</span>').join('')+'</div>'+
        '<div class="acts"><button class="btn go" data-start="'+a.id+'">'+(isActive?'🟢 使用中':'▶️ 啟動')+'</button><button class="btn ed" data-editbtn="'+a.id+'">✏️ 編輯</button><button class="btn" data-mem="'+a.id+'">📋 記憶</button></div></div>';
    }).join('')+'<div class="add" id="addAgent"><span>➕</span><div class="albl">${this.esc(vscode.l10n.t('Add Agent'))}</div></div>';
}

function renderActs(){
    const g=document.getElementById('actGrid');
    if(!activities.length){g.innerHTML='<div style="opacity:.4;padding:16px;font-size:.88em">${this.esc(vscode.l10n.t('No recent activity.'))}</div>';return;}
    g.innerHTML=activities.map(a=>{
        const d=new Date(a.lastActive);
        const t=d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        const c=a.status==='active'?'#22c55e':a.status==='recent'?'#eab308':a.status==='done'?'#3b82f6':'#6b7280';
        const done=a.taskItems?a.taskItems.filter(x=>x.done).length:0;
        const total=a.taskItems?a.taskItems.length:0;
        const pLabel=total>0?' ('+done+'/'+total+')':'';
        return '<div class="actc" style="border-left-color:'+c+';cursor:pointer" data-convid="'+escH(a.conversationId)+'" title="Click to view task details"><div class="acth"><div class="dot '+a.status+'"></div><span class="acttl">'+escH(a.title)+'</span><span class="acttm">'+t+'</span></div><div class="pbar"><div class="pfill" style="width:'+a.progress+'%;background:'+c+'"></div></div><div style="font-size:.65em;opacity:.4;margin-top:3px">'+a.progress+'%'+pLabel+'</div></div>';
    }).join('');
}

document.addEventListener('click',function(e){
    if(e.target.closest('#addAgent')){openCreateModal();return;}
    const ed=e.target.closest('[data-edit]');if(ed){openEditModal(ed.dataset.edit);return;}
    const edb=e.target.closest('[data-editbtn]');if(edb){openEditModal(edb.dataset.editbtn);return;}
    const s=e.target.closest('[data-start]');if(s){vscode.postMessage({command:'startChat',agentId:s.dataset.start});return;}
    const m=e.target.closest('[data-mem]');if(m){vscode.postMessage({command:'viewMemory',agentId:m.dataset.mem});return;}
    const d=e.target.closest('[data-del]');if(d){if(confirm('Delete this agent?'))vscode.postMessage({command:'deleteAgent',agentId:d.dataset.del});return;}
    const cv=e.target.closest('[data-convid]');if(cv){vscode.postMessage({command:'openTaskFile',conversationId:cv.dataset.convid});return;}
});
document.getElementById('cancelBtn').addEventListener('click',()=>modal.classList.remove('open'));
document.getElementById('saveBtn').addEventListener('click',function(){
    const name=document.getElementById('aName').value.trim();
    if(!name){alert('Please enter a name');return;}
    const agentData={
        id:editId||name.toLowerCase().replace(/[^a-z0-9]/g,'-'),
        name,
        title:document.getElementById('aTitle').value.trim(),
        specialty:document.getElementById('aSpec').value.split(',').map(s=>s.trim()).filter(Boolean),
        skills:[],color:COLORS[ms.color],model:'',
        avatar:{skin:ms.skin,hair:ms.hair,eyes:ms.eyes,accessory:ms.acc,hairColor:ms.hairColor},
        createdAt:editId?(agents.find(a=>a.id===editId)||{}).createdAt||new Date().toISOString():new Date().toISOString()
    };
    vscode.postMessage({command:editId?'updateAgent':'createAgent',agent:agentData});
    modal.classList.remove('open');
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.classList.remove('open');});
renderAgents();renderActs();
})();
</script></body></html>`;
    }
}
