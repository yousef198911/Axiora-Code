/*---------------------------------------------------------------------------------------------
 *  Long-running Projects: multi-session work that survives restarts. Each project is a plain
 *  Markdown file .axiora/projects/<name>.md (Goal, Tasks checklist, Log, Notes).
 *  "@axiora /project new <name>: <goal>" plans tasks; "/project <name>" continues with the
 *  next open task using the goal, notes and log as memory; "Mark Done" ticks it and logs it.
 *  The active project shows in the status bar (name + done/total) → open / switch.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chatCommands, register, wsRoot, SYS, contextProviders } from './util';
import { chat } from './llm';

const dir = () => wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'projects');
const uriOf = (n: string) => vscode.Uri.joinPath(dir()!, `${n}.md`);
const read = async (u: vscode.Uri) => { try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(u)); } catch { return undefined; } };
const write = (u: vscode.Uri, s: string) => vscode.workspace.fs.writeFile(u, new TextEncoder().encode(s));
export const tasksOf = (md: string) => [...md.matchAll(/^- \[( |x)\] (.+)$/gm)].map(m => ({ done: m[1] === 'x', text: m[2] }));
export function markDone(md: string, task: string, note: string) {
	const s = md.replace(`- [ ] ${task}`, `- [x] ${task}`);
	const entry = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — done: ${task}${note ? ` — ${note.replace(/\n+/g, ' ').slice(0, 200)}` : ''}`;
	return /^## Log\s*$/m.test(s) ? s.replace(/^## Log\s*$/m, `## Log\n${entry}`) : `${s}\n## Log\n${entry}\n`;
}
export function activate(ctx: vscode.ExtensionContext) {
	const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48); sb.command = 'axiora.project.open'; ctx.subscriptions.push(sb);
	const active = () => ctx.workspaceState.get<string>('axiora.project.active');
	const refresh = async () => { const a = active(); const md = a && dir() && await read(uriOf(a)); if (!md) { sb.hide(); return; } const t = tasksOf(md); sb.text = `$(project) ${a} ${t.filter(x => x.done).length}/${t.length}`; sb.tooltip = 'Axiora project — click to open or switch'; sb.show(); };
	void refresh();
	const list = async () => { const d = dir(); if (!d) { return []; } try { return (await vscode.workspace.fs.readDirectory(d)).filter(([n]) => n.endsWith('.md')).map(([n]) => n.slice(0, -3)); } catch { return []; } };
	chatCommands.set('project', async (req, stream, token) => {
		if (!dir()) { stream.markdown('Open a folder first.'); return; }
		const q = req.prompt.trim();
		const nm = /^new\s+([\w-]+)\s*:\s*([\s\S]+)$/.exec(q);
		if (nm) {
			const [, name, goal] = nm; stream.progress('Planning the project…');
			let ctxs = ''; for (const p of contextProviders.slice(0, 2)) { ctxs += await p().catch(() => ''); }
			const plan = await chat([{ role: 'system', content: `${SYS}\nBreak the goal into 4-10 concrete, ordered tasks, each completable in one session. Output ONLY lines "- [ ] task".` }, { role: 'user', content: goal + ctxs }], () => undefined, token);
			let tasks = plan.split('\n').map(l => l.trim()).filter(l => /^- \[ \] /.test(l));
			if (!tasks.length) { tasks = plan.split('\n').map(l => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(l => l.length > 3).slice(0, 10).map(l => `- [ ] ${l}`); }
			await vscode.workspace.fs.createDirectory(dir()!);
			await write(uriOf(name), `# Project: ${name}\n\n## Goal\n${goal.trim()}\n\n## Tasks\n${tasks.join('\n')}\n\n## Notes\n\n## Log\n`);
			await ctx.workspaceState.update('axiora.project.active', name); await refresh();
			stream.markdown(`Created project **${name}** with ${tasks.length} tasks. Continue any time with \`/project ${name}\`.\n\n${tasks.join('\n')}`); stream.anchor(uriOf(name), `${name}.md`); return;
		}
		const name = q.split(/\s+/)[0] || active();
		if (!name) { const ps = await list(); stream.markdown(ps.length ? `Projects: ${ps.map(p => `\`${p}\``).join(', ')}. Continue with \`/project <name>\`.` : 'No projects yet. Start one: `/project new <name>: <goal>`'); return; }
		const md = await read(uriOf(name)); if (!md) { stream.markdown(`No project \`${name}\`. Start it with \`/project new ${name}: <goal>\`.`); return; }
		await ctx.workspaceState.update('axiora.project.active', name); await refresh();
		const next = tasksOf(md).find(t => !t.done);
		if (!next) { stream.markdown(`🎉 All tasks in **${name}** are done.`); return; }
		const extra = q.split(/\s+/).slice(1).join(' ');
		stream.markdown(`**${name}** — next task: _${next.text}_\n\n`);
		let ctxs = ''; for (const p of contextProviders.slice(0, 3)) { ctxs += await p().catch(() => ''); }
		const r = await chat([{ role: 'system', content: `${SYS}\nYou are continuing a long-running project across sessions. The project file (goal, tasks, notes, log) is your memory. Do the next task now: concrete steps and code.` }, { role: 'user', content: `Project file:\n${md}\n\nDo this task: ${next.text}${extra ? `\nUser note: ${extra}` : ''}${ctxs}` }], s => stream.markdown(s), token);
		stream.button({ command: 'axiora.project.done', title: '✓ Mark Done', arguments: [name, next.text, r.split('\n').find(l => l.trim())?.slice(0, 160) ?? ''] });
	});
	register(ctx, 'axiora.project.done', async (name: string, task: string, note: string) => { const md = await read(uriOf(name)); if (md) { await write(uriOf(name), markDone(md, task, note)); await refresh(); vscode.window.setStatusBarMessage(`✓ ${task}`, 3000); } });
	register(ctx, 'axiora.project.open', async () => {
		const ps = await list(); if (!ps.length) { vscode.window.showInformationMessage('No projects. Ask "@axiora /project new <name>: <goal>".'); return; }
		const p = await vscode.window.showQuickPick(ps.map(n => ({ label: n, description: n === active() ? 'active' : '' })), { placeHolder: 'Open or switch project' });
		if (p) { await ctx.workspaceState.update('axiora.project.active', p.label); await refresh(); await vscode.window.showTextDocument(uriOf(p.label)); }
	});
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => { if (d.uri.path.includes('/.axiora/projects/')) { void refresh(); } }));
}
