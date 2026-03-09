import * as vscode from 'vscode';
import * as fs from 'fs';
import { loadRegistry, ProjectEntry } from '../commands/projectCommands';

export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private antigravityPath: string) { }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ProjectItem[] {
        const registry = loadRegistry(this.antigravityPath);
        const items: ProjectItem[] = [];

        if (registry.projects.length === 0) {
            items.push(new ProjectItem(
                'No projects yet',
                'Run "Scan Projects" to discover',
                'info',
                'antigravity.scanProjects'
            ));
            return items;
        }

        // Sort: local projects first, then remote-only
        const sorted = [...registry.projects].sort((a, b) => {
            const aLocal = a.localPaths.some(p => fs.existsSync(p));
            const bLocal = b.localPaths.some(p => fs.existsSync(p));
            if (aLocal && !bLocal) { return -1; }
            if (!aLocal && bLocal) { return 1; }
            return a.name.localeCompare(b.name);
        });

        for (const project of sorted) {
            const isLocal = project.localPaths.some(p => fs.existsSync(p));
            const techLabel = project.techStack.length > 0 ? project.techStack.join(', ') : '';
            const description = project.description
                ? (techLabel ? `${techLabel} — ${project.description}` : project.description)
                : techLabel;

            if (isLocal) {
                const item = new ProjectItem(
                    project.name,
                    description,
                    'folder',
                    'antigravity.openProjectFolder',
                    project
                );
                item.tooltip = `${project.description}\n\nTech: ${project.techStack.join(', ')}\nGit: ${project.gitUrl}\nPath: ${project.localPaths.join(', ')}`;
                items.push(item);
            } else {
                const item = new ProjectItem(
                    `📥 ${project.name}`,
                    description || 'Click to clone',
                    'cloud-download',
                    'antigravity.cloneProject',
                    project
                );
                item.tooltip = `Not cloned locally\n\nGit: ${project.gitUrl}\n${project.description}`;
                items.push(item);
            }
        }

        return items;
    }
}

export class ProjectItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        icon: string,
        commandId?: string,
        public readonly project?: ProjectEntry
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon);
        if (commandId) {
            this.command = {
                command: commandId,
                title: label,
                arguments: project ? [project] : []
            };
        }
    }
}
