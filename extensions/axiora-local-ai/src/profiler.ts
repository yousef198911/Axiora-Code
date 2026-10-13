/*---------------------------------------------------------------------------------------------
 *  Built-in CPU profiler for Node.js and Python scripts. Editor title ▸ "Profile Script"
 *  (flame icon, JS/TS/Python files) or Palette "Profiler: Profile Current Script...".
 *  Node: --cpu-prof → .cpuprofile; Python: cProfile → pstats. Results open as a sortable hot-
 *  function table (self/total time, calls); click a row to jump to the source line; "Explain"
 *  asks @axiora how to speed up the hottest functions. Profiles are kept in .axiora/profiles/.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { register, wsRoot } from './util';

export type Row = { fn: string; file: string; line: number; self: number; total: number; calls?: number };
export function parseCpuProfile(p: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] }): Row[] {
	const self = new Map<number, number>(); p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
	const byId = new Map(p.nodes.map(n => [n.id, n]));
	const tot = new Map<number, number>(); const total = (id: number): number => { if (tot.has(id)) { return tot.get(id)!; } const n = byId.get(id)!; const t = (self.get(id) ?? 0) + (n.children ?? []).reduce((a, c) => a + total(c), 0); tot.set(id, t); return t; };
	const agg = new Map<string, Row>();
	const keyOf = (n: typeof p.nodes[number]) => `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}`;
	const skip = (n: typeof p.nodes[number]) => !n.callFrame.url || n.callFrame.url.startsWith('node:') || /^\((program|idle|garbage collector|root)\)$/.test(n.callFrame.functionName);
	// DFS from the root; total time counts only the outermost frame of a recursive function
	const root = p.nodes[0]; const active = new Map<string, number>();
	const walk = (id: number) => {
		const n = byId.get(id)!; const k = keyOf(n);
		if (!skip(n)) {
			const f = n.callFrame; const file = f.url.startsWith('file://') ? decodeURIComponent(f.url.slice(7)) : f.url;
			const r = agg.get(k) ?? { fn: f.functionName || '(anonymous)', file, line: f.lineNumber + 1, self: 0, total: 0 };
			r.self += (self.get(id) ?? 0) / 1000; if (!active.get(k)) { r.total += total(id) / 1000; } agg.set(k, r);
		}
		active.set(k, (active.get(k) ?? 0) + 1); for (const c of n.children ?? []) { walk(c); } active.set(k, active.get(k)! - 1);
	};
	if (root) { walk(root.id); }
	return [...agg.values()].sort((a, b) => b.self - a.self);
}
const PY = `import cProfile,pstats,sys,json,runpy
p=cProfile.Profile();sys.argv=sys.argv[2:]
try:
    p.runcall(runpy.run_path,sys.argv[0],run_name='__main__')
except SystemExit: pass
s=pstats.Stats(p);out=[]
for (f,l,n),(cc,nc,tt,ct,_) in s.stats.items():
    if f.startswith('<') or 'lib/python' in f: continue
    out.append({'fn':n,'file':f,'line':l,'self':tt*1000,'total':ct*1000,'calls':nc})
open(sys.argv_out if hasattr(sys,'argv_out') else __import__('os').environ['AXIORA_PROF_OUT'],'w').write(json.dumps(out))
`;
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.profile.run', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
		if (!doc) { return; } await doc.save();
		const file = doc.fileName; const isPy = doc.languageId === 'python';
		const root = wsRoot()?.fsPath ?? path.dirname(file); const dir = path.join(root, '.axiora', 'profiles'); fs.mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15); const out = path.join(dir, `${path.basename(file)}-${stamp}${isPy ? '.json' : '.cpuprofile'}`);
		const args = await vscode.window.showInputBox({ prompt: `Arguments for ${path.basename(file)} (optional)`, value: '' }); if (args === undefined) { return; }
		const t0 = Date.now();
		const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Profiling ${path.basename(file)}…`, cancellable: true }, (_p, tok) => new Promise<{ code: number | null; err: string }>(resolve => {
			const a = args.trim() ? args.trim().split(/\s+/) : [];
			const pr = isPy ? cp.spawn('python3', ['-c', PY, 'x', file, ...a], { cwd: path.dirname(file), env: { ...process.env, AXIORA_PROF_OUT: out } })
				: cp.spawn('node', ['--cpu-prof', `--cpu-prof-dir=${dir}`, `--cpu-prof-name=${path.basename(out)}`, '--cpu-prof-interval=200', file, ...a], { cwd: path.dirname(file), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
			let err = ''; pr.stderr.on('data', d => err += d); tok.onCancellationRequested(() => pr.kill()); pr.on('close', code => resolve({ code, err })); pr.on('error', e => resolve({ code: -1, err: e.message }));
		}));
		if (!fs.existsSync(out)) { vscode.window.showErrorMessage(`Profiling failed (exit ${res.code}): ${res.err.slice(0, 300)}`); return; }
		const rows: Row[] = isPy ? (JSON.parse(fs.readFileSync(out, 'utf8')) as Row[]).sort((a, b) => b.self - a.self) : parseCpuProfile(JSON.parse(fs.readFileSync(out, 'utf8')));
		show(rows, path.basename(file), Date.now() - t0, out);
	});
	register(ctx, 'axiora.profile.open', async () => {
		const u = await vscode.window.showOpenDialog({ filters: { Profiles: ['cpuprofile'] }, defaultUri: wsRoot() && vscode.Uri.joinPath(wsRoot()!, '.axiora', 'profiles') });
		if (u?.[0]) { show(parseCpuProfile(JSON.parse(fs.readFileSync(u[0].fsPath, 'utf8'))), path.basename(u[0].fsPath), 0, u[0].fsPath); }
	});
}
function show(rows: Row[], name: string, ms: number, file: string) {
	const p = vscode.window.createWebviewPanel('axiora.profile', `Profile: ${name}`, vscode.ViewColumn.Beside, { enableScripts: true });
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const top = rows.slice(0, 200); const max = Math.max(1, ...top.map(r => r.self));
	p.webview.html = `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px}table{border-collapse:collapse;width:100%}th,td{padding:3px 8px;text-align:left;border-bottom:1px solid var(--vscode-panel-border)}th{cursor:pointer;position:sticky;top:0;background:var(--vscode-editor-background)}tr.r:hover{background:var(--vscode-list-hoverBackground);cursor:pointer}.bar{height:8px;background:var(--vscode-charts-orange);display:inline-block}td.n{text-align:right;font-variant-numeric:tabular-nums}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:3px 10px;cursor:pointer}</style></head><body>
<p><b>${esc(name)}</b> · ${rows.length} functions${ms ? ` · ran ${(ms / 1000).toFixed(2)}s` : ''} · <span style="opacity:.7">${esc(file)}</span> <button id="ex">Explain hot spots</button></p>
<table><thead><tr><th data-k="self">Self ms ▾</th><th data-k="total">Total ms</th>${rows.some(r => r.calls) ? '<th data-k="calls">Calls</th>' : ''}<th></th><th>Function</th><th>Location</th></tr></thead><tbody>${top.map((r, i) => `<tr class="r" data-i="${i}"><td class="n">${r.self.toFixed(1)}</td><td class="n">${r.total.toFixed(1)}</td>${rows.some(x => x.calls) ? `<td class="n">${r.calls ?? ''}</td>` : ''}<td><span class="bar" style="width:${Math.round(80 * r.self / max)}px"></span></td><td>${esc(r.fn)}</td><td>${esc(path.basename(r.file))}:${r.line}</td></tr>`).join('')}</tbody></table>
<script>const vs=acquireVsCodeApi();document.querySelectorAll('tr.r').forEach(t=>t.onclick=()=>vs.postMessage({open:+t.dataset.i}));document.getElementById('ex').onclick=()=>vs.postMessage({explain:1});
document.querySelectorAll('th[data-k]').forEach(h=>h.onclick=()=>vs.postMessage({sort:h.dataset.k}));</script></body></html>`;
	p.webview.onDidReceiveMessage(async m => {
		if (m.open !== undefined) { const r = top[m.open]; if (fs.existsSync(r.file)) { const d = await vscode.window.showTextDocument(vscode.Uri.file(r.file), { viewColumn: vscode.ViewColumn.One }); const pos = new vscode.Position(Math.max(0, r.line - 1), 0); d.selection = new vscode.Selection(pos, pos); d.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter); } }
		else if (m.sort) { rows.sort((a, b) => ((b as unknown as Record<string, number>)[m.sort] ?? 0) - ((a as unknown as Record<string, number>)[m.sort] ?? 0)); p.dispose(); show(rows, name, ms, file); }
		else if (m.explain) { await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora These are the hottest functions from a CPU profile of ${name}. Explain the bottlenecks and how to speed them up:\n${top.slice(0, 15).map(r => `- ${r.fn} (${path.basename(r.file)}:${r.line}) self ${r.self.toFixed(1)}ms total ${r.total.toFixed(1)}ms${r.calls ? ` calls ${r.calls}` : ''}`).join('\n')}` }); }
	});
}
