/*---------------------------------------------------------------------------------------------
 *  Agent extras:
 *  - Context policy (.axiora/policy.json, or an org policy from axiora.policy.url on your own
 *    server): excluded globs + redact regexes, enforced on EVERY outbound model request.
 *  - Capability chips: status bar "$(sparkle) n/m" → toggle memory / repo map / live context /
 *    fast context / model router; "/caps" shows the chips in chat.
 *  - SOLO mode: "/solo <goal>" — autonomous loop: checkpoint → model writes files → run the
 *    test command → feed failures back, until green or axiora.solo.maxIterations.
 *  - Workflows: .axiora/workflows/<name>.json steps (chat / command / shell); record from your
 *    own @axiora prompts + terminal commands; replay with "/workflow <name>" or the palette.
 *  - Agent Board: Kanban of project tasks + background agent tasks; drag Backlog → Running
 *    starts a background agent on that task.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { chatCommands, register, wsRoot, SYS, contextProviders, run } from './util';
import { chat, outboundFilters, ChatMessage } from './llm';

type Policy = { exclude?: string[]; redact?: string[] };
let policy: Policy = {}; let excludedLines = new Set<string>(); let redactRes: RegExp[] = []; export let redactions = 0;
export function applyPolicy(msgs: ChatMessage[], lines: Set<string>, res: RegExp[]): { msgs: ChatMessage[]; n: number } {
	let n = 0;
	const out = msgs.map(m => {
		let c = m.content;
		if (lines.size) { for (const t of lines) { if (c.includes(t)) { c = c.split(t).join('[excluded by policy]'); n++; } else { const j = JSON.stringify(t).slice(1, -1); if (j !== t && c.includes(j)) { c = c.split(j).join('[excluded by policy]'); n++; } } } c = c.replace(/(\[excluded by policy\]\s*){2,}/g, '[excluded by policy]\n'); }
		for (const r of res) { c = c.replace(r, () => { n++; return '[redacted]'; }); }
		return { ...m, content: c };
	});
	return { msgs: out, n };
}
async function loadPolicy() {
	const r = wsRoot(); let p: Policy = {};
	const url = vscode.workspace.getConfiguration('axiora.policy').get<string>('url', '');
	if (url) { try { const j = await (await fetch(url)).json() as Policy; p = { exclude: [...(j.exclude ?? [])], redact: [...(j.redact ?? [])] }; } catch { /* offline: local only */ } }
	if (r) { try { const j = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, '.axiora', 'policy.json')))) as Policy; p.exclude = [...(p.exclude ?? []), ...(j.exclude ?? [])]; p.redact = [...(p.redact ?? []), ...(j.redact ?? [])]; } catch { /* none */ } }
	policy = p; const lines = new Set<string>();
	for (const g of p.exclude ?? []) { for (const u of await vscode.workspace.findFiles(g, undefined, 500)) { try { for (const l of new TextDecoder().decode(await vscode.workspace.fs.readFile(u)).split('\n')) { if (l.trim().length >= 12) { lines.add(l.trim()); } } } catch { /* */ } } }
	excludedLines = lines; redactRes = (p.redact ?? []).map(s => { try { return new RegExp(s, 'g'); } catch { return undefined; } }).filter(Boolean) as RegExp[];
}
const CAPS: { key: string; label: string; icon: string; def: boolean }[] = [
	{ key: 'axiora.memory.enabled', label: 'Memory', icon: '🧠', def: true },
	{ key: 'axiora.context.repoMap', label: 'Repo map', icon: '🗺️', def: true },
	{ key: 'axiora.context.liveActions', label: 'Live context', icon: '📡', def: true },
	{ key: 'axiora.context.fastContext', label: 'Fast context', icon: '⚡', def: true },
	{ key: 'axiora.ai.router.enabled', label: 'Model router', icon: '🔀', def: false },
];
const getCap = (k: string, d: boolean) => { const i = k.lastIndexOf('.'); return vscode.workspace.getConfiguration(k.slice(0, i)).get<boolean>(k.slice(i + 1), d); };
const setCap = (k: string, v: boolean) => { const i = k.lastIndexOf('.'); return vscode.workspace.getConfiguration(k.slice(0, i)).update(k.slice(i + 1), v, vscode.ConfigurationTarget.Global); };
/** Parse "<<<FILE path>>>\n...\n<<<END>>>" blocks from a model reply. */
export function parseFiles(s: string): { file: string; body: string }[] {
	// tolerant of real-model quirks: CRLF, a ``` fence inside the block, a missing final <<<END>>>
	s = s.replace(/\r\n/g, '\n');
	return [...s.matchAll(/<<<FILE\s+([^>\n]+?)\s*>>>[ \t]*\n([\s\S]*?)(?:\n?<<<END>>>|(?=\n<<<FILE\s)|$(?![\s\S]))/g)].map(m => ({ file: m[1].trim().replace(/^[`'"]|[`'"]$/g, ''), body: m[2].replace(/^```[\w+-]*\n/, '').replace(/\n```\s*$/, '').replace(/\nDONE\s*$/, '') + (m[2].endsWith('\n') ? '' : '\n') }));
}
type Step = { chat?: string; command?: string; shell?: string };
export function activate(ctx: vscode.ExtensionContext) {
	// ---- policy
	outboundFilters.push(m => { if (!excludedLines.size && !redactRes.length) { return m; } const r = applyPolicy(m, excludedLines, redactRes); redactions += r.n; return r.msgs; });
	void loadPolicy();
	const w = vscode.workspace.createFileSystemWatcher('**/.axiora/policy.json'); ctx.subscriptions.push(w, w.onDidChange(loadPolicy), w.onDidCreate(loadPolicy), w.onDidDelete(loadPolicy));
	register(ctx, 'axiora.policy.show', async () => {
		await loadPolicy();
		vscode.window.showInformationMessage(`Context policy: ${policy.exclude?.length ?? 0} excluded pattern(s) (${excludedLines.size} protected lines), ${redactRes.length} redact rule(s); ${redactions} redaction(s) this session.`, 'Edit policy.json').then(async a => {
			if (a && wsRoot()) { const u = vscode.Uri.joinPath(wsRoot()!, '.axiora', 'policy.json'); try { await vscode.workspace.fs.stat(u); } catch { await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(JSON.stringify({ exclude: ['**/secrets/**', '**/*.pem'], redact: ['(?i)password\\s*=\\s*\\S+'] }, null, 2))); } await vscode.window.showTextDocument(u); }
		});
	});
	// ---- capability chips
	const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99); sb.command = 'axiora.caps.toggle'; ctx.subscriptions.push(sb);
	const upd = () => { const on = CAPS.filter(c => getCap(c.key, c.def)); sb.text = `$(sparkle) ${on.length}/${CAPS.length}`; sb.tooltip = `Axiora capabilities: ${CAPS.map(c => `${getCap(c.key, c.def) ? '●' : '○'} ${c.label}`).join('  ')}${excludedLines.size || redactRes.length ? '  · 🛡 policy active' : ''}`; sb.show(); };
	upd(); ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (CAPS.some(c => e.affectsConfiguration(c.key))) { upd(); } }));
	register(ctx, 'axiora.caps.toggle', async () => {
		const items = CAPS.map(c => ({ label: `${c.icon} ${c.label}`, picked: getCap(c.key, c.def), c }));
		const p = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: 'Agent capabilities (checked = on)' });
		if (p) { for (const c of CAPS) { await setCap(c.key, p.some(x => x.c === c)); } upd(); }
	});
	chatCommands.set('caps', async (_req, stream) => {
		stream.markdown(CAPS.map(c => `\`${getCap(c.key, c.def) ? '●' : '○'} ${c.icon} ${c.label}\``).join(' ') + (excludedLines.size || redactRes.length ? ' `🛡 policy`' : '') + '\n\n');
		stream.button({ command: 'axiora.caps.toggle', title: 'Toggle Capabilities' });
	});
	// ---- SOLO
	chatCommands.set('solo', async (req, stream, token) => {
		const r = wsRoot(); if (!r || !req.prompt.trim()) { stream.markdown('Usage: `/solo <goal>` in an open folder.'); return; }
		const c = vscode.workspace.getConfiguration('axiora.solo'); const max = c.get<number>('maxIterations', 5);
		let test = c.get<string>('testCommand', '');
		if (!test) { try { const pj = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, 'package.json')))); if (pj.scripts?.test) { test = 'npm test --silent'; } } catch { /* */ } }
		await vscode.commands.executeCommand('axiora.checkpoint.create').then(undefined, () => undefined);
		stream.markdown(`**SOLO** — goal: _${req.prompt}_ · checkpoint created · verify: \`${test || '(none)'}\` · max ${max} iterations\n\n`);
		let ctxs = ''; for (const p of contextProviders.slice(0, 3)) { ctxs += await p().catch(() => ''); }
		let feedback = ''; const touched = new Set<string>();
		for (let it = 1; it <= max && !token.isCancellationRequested; it++) {
			stream.progress(`SOLO iteration ${it}/${max}…`);
			const reply = await chat([{ role: 'system', content: `${SYS}\nYou are working autonomously (SOLO). Output complete files ONLY as blocks:\n<<<FILE relative/path>>>\n<full content>\n<<<END>>>\nThen one line "DONE" if the goal is fully met.` }, { role: 'user', content: `Goal: ${req.prompt}${feedback ? `\n\nThe last verification failed:\n${feedback}` : ''}${ctxs}` }], () => undefined, token);
			const files = parseFiles(reply);
			for (const f of files) { const u = vscode.Uri.joinPath(r, f.file.replace(/^\/+/, '')); if (!u.fsPath.startsWith(r.fsPath)) { continue; } await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(u.fsPath))); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(f.body)); touched.add(f.file); }
			stream.markdown(`- iteration ${it}: ${files.length ? `wrote ${files.map(f => `\`${f.file}\``).join(', ')}` : 'no file changes proposed'}`);
			if (!test) { stream.markdown(' — no test command, stopping.\n'); break; }
			const res = await run('bash', ['-lc', `${test} 2>&1`], r.fsPath).then(o => ({ ok: true, o }), e => ({ ok: false, o: String(e.message) }));
			stream.markdown(res.ok ? ' — ✅ verification passed\n' : ' — ❌ verification failed\n');
			if (res.ok && (files.length === 0 || /\bDONE\b/.test(reply))) { break; }
			if (!res.ok && !files.length && it > 1) { break; }
			feedback = res.o.slice(-3000);
		}
		stream.markdown(`\n**SOLO finished.** Files touched: ${touched.size ? [...touched].map(f => `\`${f}\``).join(', ') : 'none'}.`);
		stream.button({ command: 'axiora.checkpoint.restore', title: 'Undo (restore checkpoint)' });
	});
	// ---- workflows
	const wdir = () => wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'workflows');
	let rec: Step[] | undefined; const recSb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 47); recSb.command = 'axiora.workflow.record'; ctx.subscriptions.push(recSb);
	(globalThis as any).axioraOnPrompt = (cmd: string | undefined, prompt: string) => { if (rec && cmd !== 'workflow') { rec.push({ chat: `${cmd ? `/${cmd} ` : ''}${prompt}` }); recSb.text = `$(record) Recording workflow (${rec.length})`; } };
	ctx.subscriptions.push(vscode.window.onDidEndTerminalShellExecution?.(e => { if (rec) { rec.push({ shell: e.execution.commandLine.value }); recSb.text = `$(record) Recording workflow (${rec.length})`; } }) ?? { dispose() { /* */ } });
	register(ctx, 'axiora.workflow.record', async () => {
		if (!rec) { rec = []; recSb.text = '$(record) Recording workflow (0)'; recSb.tooltip = 'Click to stop and save'; recSb.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground'); recSb.show(); return; }
		const steps = rec; rec = undefined; recSb.hide();
		if (!steps.length || !wdir()) { vscode.window.showInformationMessage('Nothing recorded.'); return; }
		const name = await vscode.window.showInputBox({ prompt: `Save ${steps.length} step(s) as workflow`, value: 'my-workflow' }); if (!name) { return; }
		await vscode.workspace.fs.createDirectory(wdir()!); const u = vscode.Uri.joinPath(wdir()!, `${name}.json`);
		await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(JSON.stringify({ name, steps }, null, 2))); await vscode.window.showTextDocument(u);
	});
	const listW = async () => { try { return (await vscode.workspace.fs.readDirectory(wdir()!)).filter(([n]) => n.endsWith('.json')).map(([n]) => n.slice(0, -5)); } catch { return []; } };
	const runW = async (name: string, say: (s: string) => void) => {
		const wf = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(wdir()!, `${name}.json`)))) as { steps: Step[] };
		let term: vscode.Terminal | undefined;
		for (const [i, s] of wf.steps.entries()) {
			say(`${i + 1}. ${s.chat ? `💬 ${s.chat}` : s.command ? `⚙️ ${s.command}` : `$ ${s.shell}`}`);
			if (s.command) { await vscode.commands.executeCommand(s.command); }
			else if (s.shell) { term ??= vscode.window.createTerminal(`Workflow: ${name}`); term.show(true); term.sendText(s.shell); }
			else if (s.chat) { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora ${s.chat}` }); await new Promise(r => setTimeout(r, 1500)); }
		}
	};
	register(ctx, 'axiora.workflow.run', async (n?: string) => { const name = n ?? (await vscode.window.showQuickPick(await listW(), { placeHolder: 'Run workflow' })); if (name) { await runW(name, s => vscode.window.setStatusBarMessage(`Workflow ${name}: ${s}`, 4000)); } });
	chatCommands.set('workflow', async (req, stream) => {
		const ws = await listW(); const n = req.prompt.trim();
		if (!n || !ws.includes(n)) { stream.markdown(ws.length ? `Workflows: ${ws.map(x => `\`${x}\``).join(', ')}. Run with \`/workflow <name>\`.` : 'No workflows yet — **Axiora AI: Record Workflow** (status bar) or add `.axiora/workflows/<name>.json`.'); return; }
		stream.markdown(`Running workflow **${n}**…\n\n`); await runW(n, s => stream.markdown(s + '\n\n'));
	});
	// ---- Agent Board (Kanban)
	register(ctx, 'axiora.board.open', async () => {
		const panel = vscode.window.createWebviewPanel('axioraBoard', 'Agent Board', vscode.ViewColumn.Active, { enableScripts: true });
		const data = async () => {
			const bg = ((globalThis as any).axioraBg?.tasks ?? []) as { id: number; prompt: string; state: string }[];
			const cards: { col: string; text: string; src: string }[] = bg.map(t => ({ col: t.state === 'running' ? 'running' : 'done', text: `#${t.id} ${t.prompt}`, src: t.state === 'running' ? 'agent' : `agent · ${t.state}` }));
			const r = wsRoot();
			if (r) { try { for (const [f] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(r, '.axiora', 'projects'))) { if (!f.endsWith('.md')) { continue; } const md = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, '.axiora', 'projects', f))); for (const m of md.matchAll(/^- \[( |x)\] (.+)$/gm)) { if (!bg.some(b => b.prompt.includes(m[2]))) { cards.push({ col: m[1] === 'x' ? 'done' : 'backlog', text: m[2], src: `project · ${f.slice(0, -3)}` }); } } } } catch { /* none */ } }
			return cards;
		};
		const render = async () => { panel.webview.html = `<!doctype html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);margin:0;padding:12px}.b{display:flex;gap:12px;height:calc(100vh - 24px)}.c{flex:1;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;overflow:auto}.c h3{margin:2px 4px 8px;font-size:12px;text-transform:uppercase;opacity:.8}.k{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;margin:6px 0;cursor:grab;font-size:13px}.k small{display:block;opacity:.6;margin-top:4px}.c.o{outline:2px dashed var(--vscode-focusBorder)}</style></head><body><div class="b">${['backlog', 'running', 'done'].map(c => `<div class="c" data-col="${c}"><h3>${c === 'backlog' ? 'Backlog' : c === 'running' ? 'Running' : 'Done'}</h3></div>`).join('')}</div><script>const v=acquireVsCodeApi();const cards=${JSON.stringify(await data())};for(const k of cards){const d=document.createElement('div');d.className='k';d.draggable=true;d.textContent=k.text;const s=document.createElement('small');s.textContent=k.src;d.appendChild(s);d.ondragstart=e=>e.dataTransfer.setData('text',k.text);document.querySelector('[data-col='+k.col+']').appendChild(d);}document.querySelectorAll('.c').forEach(c=>{c.ondragover=e=>{e.preventDefault();c.classList.add('o')};c.ondragleave=()=>c.classList.remove('o');c.ondrop=e=>{c.classList.remove('o');v.postMessage({col:c.dataset.col,text:e.dataTransfer.getData('text')})}});</script></body></html>`; };
		await render();
		panel.webview.onDidReceiveMessage(async m => { if (m.col === 'running') { (globalThis as any).axioraBg?.start(m.text); } await render(); });
		const t = setInterval(() => void render(), 5000); panel.onDidDispose(() => clearInterval(t));
	});
}
