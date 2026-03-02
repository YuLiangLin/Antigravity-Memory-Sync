import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SkillItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private antigravityPath: string) { }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SkillItem): vscode.TreeItem {
        return element;
    }

    getChildren(): SkillItem[] {
        const skillsDir = path.join(this.antigravityPath, 'skills');
        if (!fs.existsSync(skillsDir)) { return []; }

        const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));

        return dirs.map(dir => {
            const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md');
            const meta = this.parseSkillMd(skillMdPath);
            return new SkillItem(
                meta.name || dir.name,
                meta.description || '',
                vscode.Uri.file(skillMdPath),
                meta.source
            );
        });
    }

    private parseSkillMd(filePath: string): { name?: string; description?: string; source?: string } {
        if (!fs.existsSync(filePath)) { return {}; }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!frontmatterMatch) { return {}; }

            const fm = frontmatterMatch[1];
            const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
            const desc = fm.match(/^description:\s*['"]?([\s\S]*?)['"]?\s*(?=\n\w|\n---|\n$)/m)?.[1]?.trim();
            const source = fm.match(/^source:\s*(.+)$/m)?.[1]?.trim();
            return { name, description: desc?.replace(/\n\s*/g, ' '), source };
        } catch {
            return {};
        }
    }
}

class SkillItem extends vscode.TreeItem {
    constructor(
        public readonly skillName: string,
        public readonly description: string,
        public readonly fileUri: vscode.Uri,
        public readonly source?: string
    ) {
        super(skillName, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${skillName}\n${description}`;
        this.description = description.length > 60 ? description.substring(0, 57) + '...' : description;
        this.iconPath = new vscode.ThemeIcon('extensions');
        this.command = {
            command: 'antigravity.openFile',
            title: 'Open SKILL.md',
            arguments: [fileUri]
        };

        if (source) {
            this.tooltip += `\nSource: ${source}`;
        }
    }
}
