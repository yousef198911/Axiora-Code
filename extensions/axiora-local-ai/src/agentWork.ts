/*---------------------------------------------------------------------------------------------
 *  Agent artifacts, background tasks and Focus Mode.
 *  - Artifacts: "/artifact <what>" produces a durable deliverable (plan, doc, diagram, script)
 *    saved under .axiora/artifacts/; "/artifacts <what>" produces several at once
 *    (multi-artifacts). "Axiora AI: Browse Artifacts..." lists them.
 *  - Background: "/background <task>" returns immediately; the agent works in the background,
 *    the status bar shows running tasks, and the result lands as an artifact + notification.
 *  - Focus Mode (Ctrl+K Ctrl+Alt+F): hides sidebar/panel and gives the chat the screen;
 *    toggling again restores the layout.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, register, wsRoot, SYS, contextProviders } from './util';
import { chat } from './llm';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'artifact';
const artDir = () => wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'artifacts');
export function splitArtifacts(s: string): { name: string; body: string }[] {
	const parts = s.split(/^=== ?ARTIFACT:\s*(.+?)\s*===\s*$/m);
	if (parts.length < 3) { return [{ name: 'artifact.md', body: s.trim() }]; }
	const out: { name: string; body: string }[] = [];
	for (let i = 1; i < parts.length; i += 2) { out.push({ name: parts[i].trim(), body: parts[i + 1].trim().replace(/^```\w*\n([\s\S]*?)\n```$/, '$1') }); }
	return out;
}
async function saveArtifact(name: string, body: string, title: string): Promise<vscode.Uri | undefined> {
	const d = artDir(); if (!d) { return undefined; }
	const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
	const ext = /\.\w+$/.test(name) ? '' : '.md';
	const u = vscode.Uri.joinPath(d, `${stamp}-${slug(title)}`, name.replace(/[\\/]/g, '_') + ext);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(u, '..'));
	await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(body + '\n'));
	return u;
}
async function baseCtx() { let s = ''; for (const p of contextProviders.slice(0, 3)) { s += await p().catch(() => ''); } return s; }
const ART_SYS = `${SYS}\nYou produce durable artifacts (documents, plans, checklists, mermaid diagrams, scripts). Output ONLY artifacts, each starting with a line "=== ARTIFACT: <file name with extension> ===" followed by its full content.`;

export function activate(ctx: vscode.ExtensionContext) {
	const runArtifacts = async (prompt: string, multi: boolean, token: vscode.CancellationToken) => {
		const out = await chat([{ role: 'system', content: ART_SYS }, { role: 'user', content: `${multi ? 'Produce SEVERAL complementary artifacts (2-5) for' : 'Produce ONE artifact for'}: ${prompt}${await baseCtx()}` }], () => undefined, token);
		const arts = splitArtifacts(out); const uris: vscode.Uri[] = [];
		for (const a of (multi ? arts : arts.slice(0, 1))) { const u = await saveArtifact(a.name, a.body, prompt); if (u) { uris.push(u); } }
		return uris;
	};
	for (const [cmd, multi] of [['artifact', false], ['artifacts', true]] as const) {
		chatCommands.set(cmd, async (req, stream, token) => {
			if (!wsRoot()) { stream.markdown('Open a folder first — artifacts are saved in `.axiora/artifacts/`.'); return; }
			stream.progress(multi ? 'Producing artifacts…' : 'Producing artifact…');
			const uris = await runArtifacts(req.prompt, multi, token);
			stream.markdown(`**${uris.length} artifact${uris.length === 1 ? '' : 's'} saved:**\n`);
			for (const u of uris) { stream.reference(u); }
			if (uris[0]) { stream.button({ command: 'vscode.open', title: 'Open', arguments: [uris[0]] }); }
		});
	}
	register(ctx, 'axiora.artifacts.browse', async () => {
		const d = artDir(); if (!d) { return; }
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(d, '**/*'));
		if (!files.length) { vscode.window.showInformationMessage('No artifacts yet. Ask "@axiora /artifact <what>".'); return; }
		const p = await vscode.window.showQuickPick(files.sort((a, b) => b.path.localeCompare(a.path)).map(u => ({ label: u.path.split('/').pop()!, description: u.path.split('/').slice(-2, -1)[0], u })), { placeHolder: 'Agent artifacts', matchOnDescription: true });
		if (p) { await vscode.window.showTextDocument(p.u); }
	});

	// --- background tasks
	type Task = { id: number; prompt: string; started: number; cts: vscode.CancellationTokenSource; state: 'running' | 'done' | 'failed' | 'cancelled'; result?: vscode.Uri };
	const tasks: Task[] = []; let next = 1;
	const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50); sb.command = 'axiora.background.list'; ctx.subscriptions.push(sb);
	const upd = () => { const n = tasks.filter(t => t.state === 'running').length; if (n) { sb.text = `$(sync~spin) ${n} agent task${n > 1 ? 's' : ''}`; sb.tooltip = 'Axiora background tasks — click to manage'; sb.show(); } else { sb.hide(); } };
	const startBg = (prompt: string) => {
		const t: Task = { id: next++, prompt, started: Date.now(), cts: new vscode.CancellationTokenSource(), state: 'running' }; tasks.push(t); upd();
		(async () => {
			try {
				const out = await chat([{ role: 'system', content: `${SYS}\nYou are working on a background task without supervision. Produce a complete, self-contained result.` }, { role: 'user', content: prompt + await baseCtx() }], () => undefined, t.cts.token);
				t.result = await saveArtifact('result.md', `# Background task #${t.id}\n\n> ${prompt}\n\n${out}`, `task-${t.id}-${prompt}`); t.state = 'done';
				const a = await vscode.window.showInformationMessage(`Background task #${t.id} finished: ${prompt.slice(0, 60)}`, 'Open Result');
				if (a && t.result) { await vscode.window.showTextDocument(t.result); }
			} catch (e) { t.state = t.cts.token.isCancellationRequested ? 'cancelled' : 'failed'; if (t.state === 'failed') { vscode.window.showWarningMessage(`Background task #${t.id} failed: ${(e as Error).message}`); } }
			upd();
		})();
		return t;
	};
	chatCommands.set('background', async (req, stream) => {
		if (!req.prompt.trim()) { stream.markdown('Usage: `/background <task>` — runs without blocking the chat.'); return; }
		const t = startBg(req.prompt);
		stream.markdown(`Started **background task #${t.id}**. Keep working — you'll get a notification when it's done (status bar shows progress).`);
		stream.button({ command: 'axiora.background.list', title: 'Manage Tasks' });
	});
	register(ctx, 'axiora.background.start', async () => { const p = await vscode.window.showInputBox({ prompt: 'Task for a background agent' }); if (p) { startBg(p); } });
	register(ctx, 'axiora.background.list', async () => {
		if (!tasks.length) { vscode.window.showInformationMessage('No background tasks. Use "@axiora /background <task>".'); return; }
		const icon = { running: '$(sync~spin)', done: '$(pass)', failed: '$(error)', cancelled: '$(circle-slash)' };
		const p = await vscode.window.showQuickPick([...tasks].reverse().map(t => ({ label: `${icon[t.state]} #${t.id} ${t.prompt.slice(0, 70)}`, description: `${t.state} · ${Math.round((Date.now() - t.started) / 1000)}s`, t })), { placeHolder: 'Background agent tasks' });
		if (!p) { return; }
		if (p.t.state === 'running') { if (await vscode.window.showWarningMessage(`Cancel task #${p.t.id}?`, 'Cancel Task') === 'Cancel Task') { p.t.cts.cancel(); } }
		else if (p.t.result) { await vscode.window.showTextDocument(p.t.result); }
	});

	// --- focus mode
	let focus = false;
	const fsb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49); fsb.text = '$(eye) Focus'; fsb.tooltip = 'Agent Focus Mode — click to exit'; fsb.command = 'axiora.focus.toggle'; ctx.subscriptions.push(fsb);
	register(ctx, 'axiora.focus.toggle', async () => {
		focus = !focus;
		const x = (c: string) => vscode.commands.executeCommand(c).then(undefined, () => undefined);
		if (focus) { await x('workbench.action.closeSidebar'); await x('workbench.action.closePanel'); await x('workbench.action.chat.open'); await x('workbench.action.closeEditorsInOtherGroups'); fsb.show(); }
		else { await x('workbench.view.explorer'); fsb.hide(); }
		vscode.commands.executeCommand('setContext', 'axiora.focusMode', focus);
	});
}
