import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ArtifactMeta {
    artifactType: string;
    summary: string;
    updatedAt: string;
    version: string;
}

export class BrainTreeProvider implements vscode.TreeDataProvider<BrainItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<BrainItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private antigravityPath: string) { }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: BrainItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: BrainItem): BrainItem[] {
        if (!element) {
            return this.getConversations();
        }
        return this.getArtifacts(element.conversationId);
    }

    private getConversations(): BrainItem[] {
        const brainDir = path.join(this.antigravityPath, 'brain');
        if (!fs.existsSync(brainDir)) { return []; }

        const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'tempmediaStorage' && !d.name.startsWith('.'));

        // Sort by most recent artifact modification time
        const conversations = dirs.map(dir => {
            const dirPath = path.join(brainDir, dir.name);
            const artifacts = this.findArtifacts(dirPath);
            const latestArtifact = artifacts.sort((a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            )[0];

            const title = this.getConversationTitle(dirPath, artifacts);
            const lastModified = latestArtifact?.updatedAt
                ? new Date(latestArtifact.updatedAt)
                : this.getDirModifiedTime(dirPath);

            return {
                id: dir.name,
                title,
                lastModified,
                artifactCount: artifacts.length
            };
        });

        // Sort newest first
        conversations.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

        return conversations.map(c => new BrainItem(
            c.title,
            c.id,
            c.lastModified,
            c.artifactCount,
            vscode.TreeItemCollapsibleState.Collapsed
        ));
    }

    private getArtifacts(conversationId: string): BrainItem[] {
        const dirPath = path.join(this.antigravityPath, 'brain', conversationId);
        const artifacts = this.findArtifacts(dirPath);

        return artifacts.map(a => {
            const iconMap: Record<string, string> = {
                'ARTIFACT_TYPE_TASK': 'checklist',
                'ARTIFACT_TYPE_WALKTHROUGH': 'book',
                'ARTIFACT_TYPE_IMPLEMENTATION_PLAN': 'file-code',
                'ARTIFACT_TYPE_OTHER': 'file-text'
            };
            const icon = iconMap[a.artifactType] || 'file';
            const label = path.basename(a.filePath, '.md');

            const item = new BrainItem(
                label,
                conversationId,
                new Date(a.updatedAt),
                0,
                vscode.TreeItemCollapsibleState.None
            );
            item.iconPath = new vscode.ThemeIcon(icon);
            item.description = a.summary.length > 50
                ? a.summary.substring(0, 47) + '...'
                : a.summary;
            item.command = {
                command: 'antigravity.openFile',
                title: 'Open Artifact',
                arguments: [vscode.Uri.file(a.filePath)]
            };
            item.tooltip = `${label}\n${a.summary}\n\nUpdated: ${a.updatedAt}\nVersion: ${a.version}`;
            return item;
        });
    }

    private findArtifacts(dirPath: string): (ArtifactMeta & { filePath: string })[] {
        if (!fs.existsSync(dirPath)) { return []; }

        const files = fs.readdirSync(dirPath);
        const metaFiles = files.filter(f => f.endsWith('.metadata.json'));

        return metaFiles.map(mf => {
            try {
                const metaPath = path.join(dirPath, mf);
                const meta: ArtifactMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                const artifactFile = mf.replace('.metadata.json', '');
                return {
                    ...meta,
                    filePath: path.join(dirPath, artifactFile)
                };
            } catch {
                return null;
            }
        }).filter((a): a is (ArtifactMeta & { filePath: string }) => a !== null);
    }

    private getConversationTitle(dirPath: string, artifacts: (ArtifactMeta & { filePath: string })[]): string {
        // Try to get title from task.md summary
        const taskArtifact = artifacts.find(a => a.artifactType === 'ARTIFACT_TYPE_TASK');
        if (taskArtifact?.summary) {
            const firstLine = taskArtifact.summary.split('\n')[0].trim();
            if (firstLine.length > 0 && firstLine.length <= 60) {
                return firstLine;
            }
        }

        // Try walkthrough summary
        const walkthrough = artifacts.find(a => a.artifactType === 'ARTIFACT_TYPE_WALKTHROUGH');
        if (walkthrough?.summary) {
            const firstLine = walkthrough.summary.split('\n')[0].trim();
            if (firstLine.length > 0) {
                return firstLine.substring(0, 50);
            }
        }

        // Fallback to conversation ID (short)
        return path.basename(dirPath).substring(0, 8) + '...';
    }

    private getDirModifiedTime(dirPath: string): Date {
        try {
            const stat = fs.statSync(dirPath);
            return stat.mtime;
        } catch {
            return new Date(0);
        }
    }
}

class BrainItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly conversationId: string,
        public readonly lastModified: Date,
        public readonly artifactCount: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        if (collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
            // Conversation-level item
            this.iconPath = new vscode.ThemeIcon('comment-discussion');
            const dateStr = lastModified.toLocaleDateString('zh-TW', {
                month: '2-digit', day: '2-digit'
            });
            this.description = `${dateStr} · ${artifactCount} artifacts`;
            this.tooltip = `${label}\nID: ${conversationId}\nLast modified: ${lastModified.toLocaleString()}\nArtifacts: ${artifactCount}`;
        }
    }
}
