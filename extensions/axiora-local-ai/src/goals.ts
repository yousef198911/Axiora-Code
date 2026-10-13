/*---------------------------------------------------------------------------------------------
 *  /goal: turn a goal into dependency-annotated tasks; compute execution waves (tasks whose
 *  dependencies are done can run in parallel) for any tasks.md (goals or specs).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ask, chatCommands, register, wsRoot } from './util';

export interface Task { id: string; title: string; deps: string[]; done: boolean; line: number }
export function parseTasks(md: string): Task[] {
	const out: Task[] = [];
	md.split('\n').forEach((l, line) => {
		const m = /^\s*[-*]\s*\[( |x|X)\]\s*(?:\*\*)?([A-Za-z]*\d+(?:\.\d+)*)[.):]?(?:\*\*)?\s*(.*)$/.exec(l);
		if (!m) { return; }
		const dm = /\((?:deps?|depends(?: on)?|after)\s*:?\s*([^)]*)\)/i.exec(m[3]);
		out.push({ id: m[2], title: m[3].replace(dm?.[0] ?? '', '').trim(), deps: dm ? dm[1].split(/[,\s]+/).filter(Boolean) : [], done: m[1] !== ' ', line });
	});
	return out;
}
export function waves(tasks: Task[]): Task[][] {
	const done = new Set(tasks.filter(t => t.done).map(t => t.id));
	let left = tasks.filter(t => !t.done); const out: Task[][] = [];
	while (left.length) {
		const ready = left.filter(t => t.deps.every(d => done.has(d) || !tasks.some(x => x.id === d)));
		if (!ready.length) { out.push(left); break; } // cycle: dump remainder
		out.push(ready); ready.forEach(t => done.add(t.id)); left = left.filter(t => !ready.includes(t));
	}
	return out;
}
function render(ws: Task[][]): string {
	return ws.map((w, i) => `**Wave ${i + 1}** (parallel): ${w.map(t => `\`${t.id}\` ${t.title}${t.deps.length ? ` _(after ${t.deps.join(', ')})_` : ''}`).join(' · ')}`).join('\n\n') || 'All tasks done ✅';
}
function slug(s: string) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'goal'; }
export function activate(ctx: vscode.ExtensionContext) {
	chatCommands.set('goal', async (req, stream, token) => {
		const r = wsRoot(); if (!r) { stream.markdown('Open a folder first.'); return; }
		stream.progress('Breaking the goal into tasks…');
		const md = await ask(`Goal: ${req.prompt}\nWrite a Markdown checklist of 4-12 small implementation tasks. Format EXACTLY: "- [ ] T1. title (deps: )" and list dependencies by task id, e.g. "- [ ] T3. write tests (deps: T1, T2)". Output only the checklist.`, undefined, token);
		const tasks = parseTasks(md);
		const uri = vscode.Uri.joinPath(r, '.axiora', 'goals', `${slug(req.prompt)}.md`);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`# Goal: ${req.prompt}\n\n${md.trim()}\n`));
		stream.markdown(`Saved **${tasks.length} tasks** to \`${vscode.workspace.asRelativePath(uri)}\`.\n\n${render(waves(tasks))}`);
		stream.reference(uri);
		stream.button({ command: 'axiora.tasks.showWaves', title: 'Show execution waves', arguments: [uri] });
	});
	chatCommands.set('waves', async (_req, stream) => {
		const d = vscode.window.activeTextEditor?.document;
		stream.markdown(d ? render(waves(parseTasks(d.getText()))) : 'Open a tasks.md / goal file first.');
	});
	register(ctx, 'axiora.tasks.showWaves', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document; if (!doc) { return; }
		const ws = waves(parseTasks(doc.getText()));
		const items = ws.flatMap((w, i) => [{ label: `Wave ${i + 1}`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem & { t?: Task }, ...w.map(t => ({ label: `$(circle-large-outline) ${t.id} ${t.title}`, description: t.deps.length ? `after ${t.deps.join(', ')}` : 'no dependencies', t }))]);
		const p = await vscode.window.showQuickPick(items, { placeHolder: 'Execution waves — pick a task to jump to it' });
		if (p?.t) { const ed = await vscode.window.showTextDocument(doc); const pos = new vscode.Position(p.t.line, 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos)); }
	});
	register(ctx, 'axiora.tasks.startNext', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const next = waves(parseTasks(ed.document.getText()))[0]?.[0];
		if (!next) { vscode.window.showInformationMessage('All tasks are done.'); return; }
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: `Implement task ${next.id}: ${next.title}. When finished, mark it [x] in ${vscode.workspace.asRelativePath(ed.document.uri)}.`, mode: 'agent' });
	});
}
