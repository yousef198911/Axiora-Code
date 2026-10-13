/*---------------------------------------------------------------------------------------------
 *  Scheduled automations & triggers from .axiora/automations.json:
 *  [{ "name": "...", "on": "save" | "startup" | "interval" | "cron" | "gitCommit",
 *     "glob": "**\/*.ts", "every": "10m", "cron": "0 9 * * 1-5",
 *     "run": "npm test" | "command": "editor.action.formatDocument" | "prompt": "summarize changes" }]
 *  Shell runs go to an "Automations" terminal; prompts run through the local model and are
 *  written to .axiora/automations/<name>.md.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register, wsRoot, ask, log } from './util';

type Auto = { name: string; on: string; glob?: string; every?: string; cron?: string; run?: string; command?: string; prompt?: string; enabled?: boolean };
const dur = (s = '10m') => { const m = /^(\d+)\s*(s|m|h)$/.exec(s); return m ? +m[1] * ({ s: 1e3, m: 6e4, h: 36e5 } as Record<string, number>)[m[2]] : 6e5; };
export function cronMatch(expr: string, d: Date): boolean {
	const f = expr.trim().split(/\s+/); if (f.length !== 5) { return false; }
	const vals = [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()];
	return f.every((p, i) => p.split(',').some(part => {
		const [r, st] = part.split('/'); const step = st ? +st : 1;
		const [lo, hi] = r === '*' ? [0, 99] : r.includes('-') ? r.split('-').map(Number) : [+r, +r];
		return vals[i] >= lo && vals[i] <= hi && (vals[i] - (r === '*' ? 0 : lo)) % step === 0;
	}));
}
function globRe(g: string) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$'); }
export function activate(ctx: vscode.ExtensionContext) {
	let autos: Auto[] = []; const timers: NodeJS.Timeout[] = [];
	const out = vscode.window.createOutputChannel('Axiora Automations');
	let term: vscode.Terminal | undefined;
	ctx.subscriptions.push(vscode.window.onDidCloseTerminal(t => { if (t === term) { term = undefined; } }));
	const fire = async (a: Auto, why: string) => {
		out.appendLine(`[${new Date().toLocaleTimeString()}] ${a.name} (${why})`);
		try {
			if (a.command) { await vscode.commands.executeCommand(a.command); }
			if (a.run) { term ??= vscode.window.createTerminal({ name: 'Automations', iconPath: new vscode.ThemeIcon('zap'), cwd: wsRoot() }); term.sendText(a.run); }
			if (a.prompt) {
				const r = await ask(a.prompt); const root = wsRoot();
				if (root) { const f = vscode.Uri.joinPath(root, '.axiora', 'automations', `${a.name.replace(/[^\w-]+/g, '_')}.md`); await vscode.workspace.fs.writeFile(f, Buffer.from(`# ${a.name}\n_${new Date().toLocaleString()}_\n\n${r}\n`)); }
			}
		} catch (e) { out.appendLine(`  error: ${(e as Error).message}`); }
	};
	const load = async () => {
		timers.splice(0).forEach(clearInterval);
		const root = wsRoot(); autos = [];
		if (root) { try { autos = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.axiora', 'automations.json'))).toString()); } catch { /* none */ } }
		autos = autos.filter(a => a.enabled !== false);
		for (const a of autos) {
			if (a.on === 'interval') { timers.push(setInterval(() => fire(a, `every ${a.every}`), dur(a.every))); }
			if (a.on === 'cron' && a.cron) { timers.push(setInterval(() => cronMatch(a.cron!, new Date()) && fire(a, `cron ${a.cron}`), 60_000)); }
		}
		log.info(`automations loaded: ${autos.length}`);
		return autos;
	};
	ctx.subscriptions.push({ dispose: () => timers.forEach(clearInterval) });
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
		if (d.fileName.endsWith(path.join('.axiora', 'automations.json'))) { load(); return; }
		const rel = vscode.workspace.asRelativePath(d.uri, false);
		for (const a of autos) { if (a.on === 'save' && (!a.glob || globRe(a.glob).test(rel))) { fire(a, `saved ${rel}`); } }
	}));
	const gitHead = vscode.workspace.createFileSystemWatcher('**/.git/logs/HEAD');
	ctx.subscriptions.push(gitHead, gitHead.onDidChange(() => autos.filter(a => a.on === 'gitCommit').forEach(a => fire(a, 'git commit'))));
	load().then(as => as.filter(a => a.on === 'startup').forEach(a => fire(a, 'startup')));
	register(ctx, 'axiora.automations.edit', async () => {
		const root = wsRoot(); if (!root) { return; }
		const f = vscode.Uri.joinPath(root, '.axiora', 'automations.json');
		try { await vscode.workspace.fs.stat(f); } catch { await vscode.workspace.fs.writeFile(f, Buffer.from(JSON.stringify([{ name: 'test on save', on: 'save', glob: 'src/**/*.ts', run: 'npm test', enabled: false }, { name: 'daily summary', on: 'cron', cron: '0 9 * * 1-5', prompt: 'Write a short standup summary of yesterday\'s work.', enabled: false }], null, 2))); }
		await vscode.window.showTextDocument(f);
	});
	register(ctx, 'axiora.automations.run', async () => {
		const p = await vscode.window.showQuickPick(autos.map(a => ({ label: `$(zap) ${a.name}`, description: `${a.on}${a.glob ? ' ' + a.glob : ''}${a.every ? ' ' + a.every : ''}${a.cron ? ' ' + a.cron : ''}`, a })), { placeHolder: autos.length ? 'Run automation now' : 'No automations: use "Automations: Edit"' });
		if (p) { await fire(p.a, 'manual'); out.show(true); }
	});
}
