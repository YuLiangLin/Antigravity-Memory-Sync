import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AvatarData { skin: number; hair: number; eyes: number; accessory: number; hairColor: number; }
interface AgentProfile {
    id: string; name: string; title: string; color: string;
    avatar?: AvatarData;
}
interface AgentRegistry { version: number; agents: AgentProfile[]; }

const SKINS = ['#FDDCB5', '#F5C6A0', '#D4A07A', '#B07850', '#8D5B3A', '#5C3A21'];
const HAIR_COLORS = ['#2C1B0E', '#4A3728', '#8B6F47', '#C4A35A', '#D4541E', '#E8E8E8'];

function buildAvatarSvg(av: AvatarData): string {
    const s = SKINS[av.skin] || SKINS[0];
    const h = HAIR_COLORS[av.hairColor] || HAIR_COLORS[0];
    const HP = [
        '',
        `<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="${h}"/>`,
        `<path d="M9,18 Q9,5 24,4 Q39,5 39,18 L37,10 Q35,6 24,6 Q13,6 11,10Z" fill="${h}"/><path d="M9,18 Q8,24 9,28 L11,22Z" fill="${h}"/><path d="M39,18 Q40,24 39,28 L37,22Z" fill="${h}"/>`,
        `<path d="M8,18 Q8,4 24,3 Q40,4 40,18 L38,10 Q36,5 24,5 Q12,5 10,10Z" fill="${h}"/><path d="M8,18 Q6,28 8,36 L10,24Z" fill="${h}"/><path d="M40,18 Q42,28 40,36 L38,24Z" fill="${h}"/>`,
        `<ellipse cx="24" cy="12" rx="16" ry="11" fill="${h}"/><circle cx="10" cy="18" r="5" fill="${h}"/><circle cx="38" cy="18" r="5" fill="${h}"/>`,
        `<path d="M11,17 Q13,6 24,5 Q35,6 37,17 Q35,10 24,9 Q13,10 11,17Z" fill="${h}"/><path d="M37,17 Q40,16 42,24 L39,20Z" fill="${h}"/>`,
        `<path d="M10,17 Q10,3 24,3 Q38,3 38,17" fill="none" stroke="${h}" stroke-width="4"/><circle cx="11" cy="15" r="4" fill="${h}"/><circle cx="37" cy="15" r="4" fill="${h}"/><circle cx="15" cy="10" r="3" fill="${h}"/><circle cx="33" cy="10" r="3" fill="${h}"/><circle cx="24" cy="8" r="3.5" fill="${h}"/>`,
        `<path d="M11,17 Q11,6 24,5 Q37,6 37,17 L35,12 Q33,7 24,7 Q15,7 13,12Z" fill="${h}"/><path d="M15,5 Q18,0 21,4" stroke="${h}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M22,4 Q24,-1 27,4" stroke="${h}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M27,5 Q30,0 33,5" stroke="${h}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
        `<path d="M10,18 Q10,5 24,4 Q38,5 38,18 L36,11 Q34,6 24,6 Q14,6 12,11Z" fill="${h}"/><path d="M14,8 Q16,2 24,1 Q32,2 34,8 Q30,4 24,3 Q18,4 14,8Z" fill="${h}"/>`,
        `<path d="M12,17 Q12,8 18,6 L17,3 Q24,0 31,3 L30,6 Q36,8 36,17 L34,12 Q32,8 24,7 Q16,8 14,12Z" fill="${h}"/>`,
        `<path d="M9,18 Q9,5 24,4 Q39,5 39,18 L37,10 Q35,6 24,6 Q13,6 11,10Z" fill="${h}"/><path d="M12,9 Q14,6 18,8 Q20,5 24,7 Q28,5 30,8 Q34,6 36,9" fill="none" stroke="${h}" stroke-width="2.5" stroke-linecap="round"/>`,
        `<path d="M13,17 Q13,6 24,5 Q35,6 35,17 L33,12 Q31,8 24,7 Q17,8 15,12Z" fill="${h}"/><path d="M24,5 L24,0" stroke="${h}" stroke-width="3" stroke-linecap="round"/><path d="M19,6 L16,1" stroke="${h}" stroke-width="2.5" stroke-linecap="round"/><path d="M29,6 L32,1" stroke="${h}" stroke-width="2.5" stroke-linecap="round"/>`,
        `<path d="M8,18 Q8,4 24,3 Q40,4 40,18 L38,10 Q36,5 24,5 Q12,5 10,10Z" fill="${h}"/><path d="M8,18 Q7,23 8,27 Q10,23 10,18Z" fill="${h}"/><path d="M40,18 Q41,23 40,27 Q38,23 38,18Z" fill="${h}"/>`,
        `<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="${h}"/><path d="M33,16 Q38,22 35,32 Q33,37 31,40" stroke="${h}" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="30" cy="41" r="3" fill="${h}"/>`,
        `<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="${h}"/><path d="M12,16 Q7,24 10,36" stroke="${h}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M36,16 Q41,24 38,36" stroke="${h}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="10" cy="37" r="3" fill="${h}"/><circle cx="38" cy="37" r="3" fill="${h}"/>`,
        `<path d="M10,17 Q10,6 24,5 Q38,6 38,17 L36,12 Q34,7 24,7 Q14,7 12,12Z" fill="${h}"/><circle cx="24" cy="5" r="6" fill="${h}"/><circle cx="24" cy="4" r="4" fill="${h}"/>`
    ];
    const EP = [
        '<circle cx="18" cy="22" r="2" fill="#333"/><circle cx="30" cy="22" r="2" fill="#333"/>',
        '<ellipse cx="18" cy="22" rx="2.5" ry="2" fill="#333"/><ellipse cx="30" cy="22" rx="2.5" ry="2" fill="#333"/>',
        '<circle cx="18" cy="22" r="2.5" fill="#333"/><circle cx="30" cy="22" r="2.5" fill="#333"/><circle cx="19" cy="21.2" r=".9" fill="#fff"/><circle cx="31" cy="21.2" r=".9" fill="#fff"/>',
        '<path d="M16,22 Q18,19 20,22 Q18,24.5 16,22Z" fill="#333"/><path d="M28,22 Q30,19 32,22 Q30,24.5 28,22Z" fill="#333"/>',
        '<ellipse cx="18" cy="22" rx="2" ry="1.5" fill="#333"/><ellipse cx="30" cy="22" rx="2" ry="1.5" fill="#333"/>',
        '<circle cx="18" cy="21.5" r="1" fill="#333"/><circle cx="30" cy="21.5" r="1" fill="#333"/>'
    ];
    const hair = HP[av.hair] || '';
    const eyes = EP[av.eyes] || EP[0];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="16" fill="${s}"/>${hair}${eyes}<path d="M20,30 Q24,33 28,30" fill="none" stroke="#333" stroke-width="1" stroke-linecap="round"/></svg>`;
}

export class AgentTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(private antigravityPath: string) { }
    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: vscode.TreeItem) { return element; }

    getChildren(): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        // Open Digital Office button
        const dashItem = new vscode.TreeItem('🏢 Open Digital Office', vscode.TreeItemCollapsibleState.None);
        dashItem.command = { command: 'antigravity.openAgentOffice', title: 'Open Digital Office' };
        dashItem.tooltip = 'Open the Digital Office dashboard to manage your AI agents';
        items.push(dashItem);

        // List agents with SVG avatar icons
        const regPath = path.join(this.antigravityPath, 'agents', 'agents-registry.json');
        if (fs.existsSync(regPath)) {
            try {
                const data: AgentRegistry = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
                const iconsDir = path.join(this.antigravityPath, 'agents', '.icons');
                if (!fs.existsSync(iconsDir)) { fs.mkdirSync(iconsDir, { recursive: true }); }

                for (const agent of (data.agents || [])) {
                    const item = new vscode.TreeItem(agent.name, vscode.TreeItemCollapsibleState.None);
                    item.description = agent.title || '';
                    item.tooltip = `${agent.name} — ${agent.title}`;
                    item.command = { command: 'antigravity.openAgentOffice', title: 'Open Digital Office' };

                    // Generate SVG icon file for this agent
                    if (agent.avatar) {
                        const iconPath = path.join(iconsDir, `${agent.id}.svg`);
                        try {
                            const svg = buildAvatarSvg(agent.avatar);
                            fs.writeFileSync(iconPath, svg, 'utf-8');
                            item.iconPath = vscode.Uri.file(iconPath);
                        } catch { /* fallback to no icon */ }
                    }

                    items.push(item);
                }
            } catch { /* skip */ }
        }

        if (items.length === 1) {
            const hint = new vscode.TreeItem('(No agents yet)', vscode.TreeItemCollapsibleState.None);
            hint.tooltip = 'Click "Open Digital Office" to create your first agent';
            items.push(hint);
        }

        return items;
    }
}
