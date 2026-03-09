import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AgentProfile {
    id: string; name: string; title: string;
    specialty: string[]; skills: string[]; color: string; model: string;
    avatar: { skin: number; hair: number; eyes: number; accessory: number; hairColor: number };
    createdAt: string;
}
interface AgentRegistry { version: number; agents: AgentProfile[]; }

// ── Tech detection rules ──────────────────────────────────────
interface TechProfile {
    name: string;           // Display name
    detect: string[];       // File patterns to detect
    specialty: string[];    // Suggested specialty tags
    skills: string[];       // Matching skill folder names
    title: string;          // Suggested title
}

const TECH_PROFILES: TechProfile[] = [
    {
        name: 'Vite+Vanilla',
        detect: ['vite.config.ts', 'vite.config.js'],
        specialty: ['TypeScript', 'Vite', 'Vanilla JS', 'HTML/CSS'],
        skills: ['vite-vanilla-spa', 'chart-js-patterns', 'html-table-alignment'],
        title: 'Frontend Developer'
    },
    {
        name: '.NET/C#',
        detect: ['*.csproj', '*.sln'],
        specialty: ['C#', '.NET', 'ASP.NET Core', 'Entity Framework'],
        skills: ['csharp-pro', 'dotnet-architect', 'dotnet-backend-patterns'],
        title: 'Backend Architect'
    },
    {
        name: 'WPF Desktop',
        detect: ['*.xaml'],
        specialty: ['C#', 'WPF', 'XAML', 'MVVM', 'Desktop'],
        skills: ['wpf-desktop', 'csharp-pro'],
        title: 'Desktop App Developer'
    },
    {
        name: 'Node.js',
        detect: ['package.json'],
        specialty: ['TypeScript', 'Node.js', 'JavaScript'],
        skills: ['cc-skill-coding-standards', 'debugger'],
        title: 'Full-Stack Developer'
    },
    {
        name: 'React',
        detect: ['package.json'],  // refined by checking file contents
        specialty: ['React', 'TypeScript', 'Frontend'],
        skills: ['cc-skill-coding-standards'],
        title: 'Frontend Engineer'
    },
    {
        name: 'VS Code Extension',
        detect: ['vsc-extension-quickstart.md'],
        specialty: ['TypeScript', 'VS Code Extension', 'Webview UI'],
        skills: ['memory-sync', 'vite-vanilla-spa'],
        title: 'Extension Developer'
    },
    {
        name: 'DiCon PMM',
        detect: ['src/views/pmm-page.js', 'src/drivers/PMMDriver.js'],
        specialty: ['RS232', 'WebSerial', 'Vite', 'PMM'],
        skills: ['pmm-webservice', 'dicon-rs232-debug', 'vite-vanilla-spa', 'chart-js-patterns'],
        title: 'PMM 系統開發者'
    },
    {
        name: 'DiCon NuGet',
        detect: ['*.nupkg', 'nuget.config'],
        specialty: ['C#', '.NET', 'NuGet'],
        skills: ['dicon-nuget-workflow', 'csharp-pro'],
        title: 'Package Developer'
    }
];

// ── Agent name pool ─────────────────────────────────────────
const AGENT_NAMES = [
    'Nova', 'Atlas', 'Echo', 'Sage', 'Onyx', 'Iris', 'Bolt', 'Cleo',
    'Rex', 'Luna', 'Zara', 'Finn', 'Maya', 'Leo', 'Kai', 'Mila',
    'Robin', 'Ivy', 'Ash', 'Sky', 'Jade', 'Felix', 'Noel', 'Ava'
];

const THEME_COLORS = ['#818cf8', '#06b6d4', '#f472b6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function randomAvatar() {
    return {
        skin: Math.floor(Math.random() * 6),
        hair: Math.floor(Math.random() * 16),
        eyes: Math.floor(Math.random() * 6),
        accessory: Math.floor(Math.random() * 7),
        hairColor: Math.floor(Math.random() * 6)
    };
}

// ── Workspace scanning ──────────────────────────────────────
async function detectProject(workspaceRoot: string): Promise<{
    techProfiles: TechProfile[];
    projectName: string;
    projectDesc: string;
    agentsContext: string;
}> {
    const techProfiles: TechProfile[] = [];
    let projectName = path.basename(workspaceRoot);
    let projectDesc = '';
    let agentsContext = '';

    // Check for each tech profile
    for (const tp of TECH_PROFILES) {
        for (const pattern of tp.detect) {
            if (pattern.includes('*')) {
                // Glob pattern — check if any files match
                const ext = pattern.replace('*', '');
                try {
                    const files = fs.readdirSync(workspaceRoot);
                    if (files.some(f => f.endsWith(ext))) {
                        if (!techProfiles.find(t => t.name === tp.name)) {
                            techProfiles.push(tp);
                        }
                    }
                } catch { /* skip */ }
            } else {
                // Exact file path
                if (fs.existsSync(path.join(workspaceRoot, pattern))) {
                    if (!techProfiles.find(t => t.name === tp.name)) {
                        techProfiles.push(tp);
                    }
                }
            }
        }
    }

    // Read package.json for more context
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.name) { projectName = pkg.name; }
            if (pkg.description) { projectDesc = pkg.description; }
            // Detect React/Vue from dependencies
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps['react']) {
                const react = TECH_PROFILES.find(t => t.name === 'React');
                if (react && !techProfiles.find(t => t.name === 'React')) {
                    techProfiles.push(react);
                }
            }
        } catch { /* skip */ }
    }

    // Read AGENTS.md for project context
    const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
        agentsContext = fs.readFileSync(agentsPath, 'utf-8').substring(0, 2000);
    }

    // Read README.md for project description
    const readmePath = path.join(workspaceRoot, 'README.md');
    if (!projectDesc && fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        // Take first paragraph
        const firstPara = readme.split('\n\n').find(p => p.trim() && !p.startsWith('#'));
        if (firstPara) { projectDesc = firstPara.trim().substring(0, 200); }
    }

    // If no tech detected, fallback
    if (techProfiles.length === 0) {
        techProfiles.push({
            name: 'General',
            detect: [],
            specialty: ['Coding', 'Problem Solving'],
            skills: ['debugger', 'architecture'],
            title: 'General Developer'
        });
    }

    return { techProfiles, projectName, projectDesc, agentsContext };
}

// ── Main command ────────────────────────────────────────────
export async function generateAgent(antigravityPath: string) {
    // Get workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceRoot: string;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace open. Please open a project folder first.');
        return;
    }

    if (workspaceFolders.length === 1) {
        workspaceRoot = workspaceFolders[0].uri.fsPath;
    } else {
        // Let user pick which workspace
        const pick = await vscode.window.showQuickPick(
            workspaceFolders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
            { placeHolder: 'Select workspace for this agent' }
        );
        if (!pick) { return; }
        workspaceRoot = pick.folder.uri.fsPath;
    }

    // Detect project
    const detection = await detectProject(workspaceRoot);
    const primaryTech = detection.techProfiles[0];

    // Merge all specialties and skills from detected profiles
    const allSpecialties = [...new Set(detection.techProfiles.flatMap(t => t.specialty))];
    const allSkills = [...new Set(detection.techProfiles.flatMap(t => t.skills))];

    // Filter skills to only those that actually exist
    const skillsDir = path.join(antigravityPath, 'skills');
    const existingSkills = allSkills.filter(s => {
        return fs.existsSync(path.join(skillsDir, s, 'SKILL.md'));
    });

    // Pick an unused name
    const registry = loadRegistry(antigravityPath);
    const usedNames = new Set(registry.agents.map(a => a.name.toLowerCase()));
    let agentName = AGENT_NAMES.find(n => !usedNames.has(n.toLowerCase())) || `Agent-${Date.now().toString(36).slice(-4)}`;

    // Let user confirm/edit the name
    const inputName = await vscode.window.showInputBox({
        prompt: `Agent name for "${detection.projectName}"`,
        value: agentName,
        placeHolder: 'Enter agent name'
    });
    if (!inputName) { return; }
    agentName = inputName.trim();

    // Show summary and confirm
    const summary = [
        `📋 Project: ${detection.projectName}`,
        `🔧 Tech: ${detection.techProfiles.map(t => t.name).join(', ')}`,
        `👤 Name: ${agentName}`,
        `💼 Title: ${primaryTech.title}`,
        `🏷 Specialty: ${allSpecialties.join(', ')}`,
        `📚 Skills: ${existingSkills.length > 0 ? existingSkills.join(', ') : '(none found)'}`
    ].join('\n');

    const confirm = await vscode.window.showInformationMessage(
        `Create "${agentName}" for ${detection.projectName}?\n\n${primaryTech.title} — ${allSpecialties.slice(0, 4).join(', ')}`,
        { modal: true },
        'Create'
    );
    if (confirm !== 'Create') { return; }

    // Create agent
    const agentId = agentName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const color = THEME_COLORS[Math.floor(Math.random() * THEME_COLORS.length)];

    const agent: AgentProfile = {
        id: agentId,
        name: agentName,
        title: primaryTech.title,
        specialty: allSpecialties.slice(0, 6),
        skills: existingSkills,
        color,
        model: '',
        avatar: randomAvatar(),
        createdAt: new Date().toISOString()
    };

    // Save to registry
    const idx = registry.agents.findIndex(a => a.id === agentId);
    if (idx >= 0) { registry.agents[idx] = agent; } else { registry.agents.push(agent); }
    const agentsDir = path.join(antigravityPath, 'agents');
    if (!fs.existsSync(agentsDir)) { fs.mkdirSync(agentsDir, { recursive: true }); }
    fs.writeFileSync(path.join(agentsDir, 'agents-registry.json'), JSON.stringify(registry, null, 2), 'utf-8');

    // Create agent directory and files
    const agentDir = path.join(agentsDir, agentId);
    if (!fs.existsSync(agentDir)) { fs.mkdirSync(agentDir, { recursive: true }); }

    // Generate startup prompt
    const skillsList = existingSkills.map(s => `- ${s}`).join('\n');
    const startupPrompt = generateStartupPrompt(agentName, primaryTech.title, allSpecialties, existingSkills, detection);
    fs.writeFileSync(path.join(agentDir, 'startup-prompt.md'), startupPrompt, 'utf-8');

    // Generate initial memory
    const memory = generateMemory(agentName, detection);
    fs.writeFileSync(path.join(agentDir, 'memory.md'), memory, 'utf-8');

    vscode.window.showInformationMessage(
        `✅ Agent "${agentName}" created for ${detection.projectName}!`,
        'Open Digital Office', 'View Startup Prompt'
    ).then(choice => {
        if (choice === 'Open Digital Office') {
            vscode.commands.executeCommand('antigravity.openAgentOffice');
        } else if (choice === 'View Startup Prompt') {
            vscode.window.showTextDocument(vscode.Uri.file(path.join(agentDir, 'startup-prompt.md')));
        }
    });
}

function loadRegistry(antigravityPath: string): AgentRegistry {
    const regPath = path.join(antigravityPath, 'agents', 'agents-registry.json');
    if (fs.existsSync(regPath)) {
        try { return JSON.parse(fs.readFileSync(regPath, 'utf-8')); } catch { /* skip */ }
    }
    return { version: 1, agents: [] };
}

function generateStartupPrompt(
    name: string, title: string, specialties: string[], skills: string[],
    detection: { projectName: string; projectDesc: string; agentsContext: string; techProfiles: TechProfile[] }
): string {
    let prompt = `你是 ${name}，${detection.projectName} 的專屬 AI 開發夥伴。\n\n`;
    prompt += `## 角色設定\n`;
    prompt += `- 職稱：${title}\n`;
    prompt += `- 專長：${specialties.join('、')}\n`;
    prompt += `- 負責專案：${detection.projectName}\n`;
    prompt += `- 風格：繁體中文、簡潔專業、程式碼優先\n\n`;

    if (detection.projectDesc) {
        prompt += `## 專案簡介\n${detection.projectDesc}\n\n`;
    }

    prompt += `## 工作規範\n`;
    prompt += `1. 修改程式碼後確認編譯無錯誤\n`;
    prompt += `2. 功能新增要 version bump\n`;
    prompt += `3. UI 設計要 premium 風格\n`;
    prompt += `4. 支援繁體中文\n\n`;

    if (skills.length > 0) {
        prompt += `## 參考 Skills\n`;
        prompt += `以下 Skills 包含此專案相關的技術 patterns，請在需要時查閱：\n`;
        for (const s of skills) {
            prompt += `- \`${s}\`\n`;
        }
        prompt += `\n`;
    }

    if (detection.agentsContext) {
        prompt += `## 專案背景 (from AGENTS.md)\n`;
        prompt += detection.agentsContext.substring(0, 1500) + '\n\n';
    }

    prompt += `## 以下是你過去的工作記錄：\n（請參考 memory.md）\n`;
    return prompt;
}

function generateMemory(name: string, detection: { projectName: string; techProfiles: TechProfile[] }): string {
    let mem = `# ${name} 的專屬記憶\n\n`;
    mem += `## 身份\n`;
    mem += `- **負責專案**：${detection.projectName}\n`;
    mem += `- **偵測到的技術棧**：${detection.techProfiles.map(t => t.name).join(', ')}\n`;
    mem += `- **建立日期**：${new Date().toLocaleDateString('zh-TW')}\n\n`;
    mem += `## 工作記錄\n\n（在此記錄此 Agent 的工作進度和重要筆記）\n`;
    return mem;
}
