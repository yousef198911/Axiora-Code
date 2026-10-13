/*---------------------------------------------------------------------------------------------
 *  Dev-loop tools:
 *  - Hot Reload (editor title Run ▸ "Run with Hot Reload"): Node.js files run under
 *    `node --watch` (restart on save); Python files run in a watcher that re-executes on save.
 *    In the Python data console, saving an imported module hot-reloads it
 *    (importlib.reload) so running state is kept.
 *  - Structural selection: "Select Enclosing Function / Class / Block" and "Select Next/Previous
 *    Symbol" from the language's symbol tree (Ctrl+K Alt+F / Ctrl+K Alt+C).
 *  - Tool Sketchpad (Palette "Axiora AI: Open Tool Sketchpad"): a scratch .axiora/sketchpad.js
 *    where you call the agent's tools directly — tools.read/ls/grep/run/edit/ask — and run the
 *    selection or file with Ctrl+Enter; results print to the "Tool Sketchpad" output.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { register, wsRoot, ask, run } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	// ---- hot reload
	register(ctx, 'axiora.hot.run', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document; if (!doc) { return; } await doc.save();
		const f = doc.fileName; const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
		const t = vscode.window.createTerminal({ name: `Hot: ${path.basename(f)}`, cwd: path.dirname(f), iconPath: new vscode.ThemeIcon('flame') });
		if (doc.languageId === 'python') { t.sendText(`python3 -c ${q(`import os,sys,time,subprocess\nf=sys.argv[1];m=0;p=None\nwhile True:\n    n=os.stat(f).st_mtime\n    if n!=m:\n        m=n\n        if p: p.terminate(); p.wait()\n        print('\\x1b[2m[hot] running',os.path.basename(f),time.strftime('%X'),'\\x1b[0m',flush=True)\n        p=subprocess.Popen([sys.executable,f])\n    time.sleep(0.3)`)} ${q(f)}`); }
		else { t.sendText(`node --watch ${q(f)}`); }
		t.show(true);
	});
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
		if (d.languageId !== 'python') { return; }
		const con = vscode.window.terminals.find(t => /^Console: python/.test(t.name)); if (!con) { return; }
		const mod = path.basename(d.fileName, '.py');
		const imp = new RegExp(`^\\s*(import\\s+${mod}\\b|from\\s+${mod}\\s+import)`, 'm');
		if (!vscode.workspace.textDocuments.some(x => x !== d && x.languageId === 'python' && imp.test(x.getText()))) { return; }
		con.sendText(`exec("import sys,importlib\\nif ${JSON.stringify(mod).replace(/"/g, "'")} in sys.modules: importlib.reload(sys.modules[${JSON.stringify(mod).replace(/"/g, "'")}]); print('[hot] reloaded ${mod}')")`);
	}));

	// ---- structural selection
	const symbols = async (doc: vscode.TextDocument) => (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri)) ?? [];
	const flatten = (s: vscode.DocumentSymbol[], out: vscode.DocumentSymbol[] = []) => { for (const x of s) { if (x.range) { out.push(x); flatten(x.children ?? [], out); } } return out; };
	const KINDS: Record<string, vscode.SymbolKind[]> = { function: [vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor], class: [vscode.SymbolKind.Class, vscode.SymbolKind.Interface, vscode.SymbolKind.Struct, vscode.SymbolKind.Enum, vscode.SymbolKind.Module, vscode.SymbolKind.Namespace] };
	const enclosing = async (kind: 'function' | 'class' | 'any') => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const all = flatten(await symbols(ed.document)).filter(s => s.range.contains(ed.selection) && !s.range.isEqual(ed.selection) && (kind === 'any' || KINDS[kind].includes(s.kind)));
		const best = all.sort((a, b) => ed.document.offsetAt(a.range.end) - ed.document.offsetAt(a.range.start) - (ed.document.offsetAt(b.range.end) - ed.document.offsetAt(b.range.start)))[0];
		if (!best) { vscode.window.setStatusBarMessage(`No enclosing ${kind === 'any' ? 'symbol' : kind}`, 2000); return; }
		ed.selection = new vscode.Selection(best.range.start, best.range.end); ed.revealRange(best.range);
	};
	register(ctx, 'axiora.struct.function', () => enclosing('function'));
	register(ctx, 'axiora.struct.class', () => enclosing('class'));
	register(ctx, 'axiora.struct.symbol', () => enclosing('any'));
	const sibling = async (dir: 1 | -1) => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const all = flatten(await symbols(ed.document)).sort((a, b) => a.range.start.compareTo(b.range.start));
		const pos = ed.selection.active; const n = dir > 0 ? all.find(s => s.range.start.isAfter(pos)) : [...all].reverse().find(s => s.range.start.isBefore(ed.selection.start));
		if (n) { ed.selection = new vscode.Selection(n.range.start, n.range.end); ed.revealRange(n.range); }
	};
	register(ctx, 'axiora.struct.next', () => sibling(1));
	register(ctx, 'axiora.struct.prev', () => sibling(-1));

	// ---- tool sketchpad
	const out = vscode.window.createOutputChannel('Tool Sketchpad'); ctx.subscriptions.push(out);
	register(ctx, 'axiora.sketch.open', async () => {
		const r = wsRoot(); if (!r) { return; }
		const u = vscode.Uri.joinPath(r, '.axiora', 'sketchpad.js');
		try { await vscode.workspace.fs.stat(u); } catch { await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(r, '.axiora')); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(`// Tool Sketchpad — call the agent's tools directly. Select lines (or nothing = whole file) and press Ctrl+Enter.
// tools.ls(glob) · tools.read(path) · tools.grep(regex, glob?) · tools.run(cmd) · tools.edit(path, find, replace) · tools.ask(prompt)
const files = await tools.ls('**/*.js');
print(files.slice(0, 5));
print(await tools.grep('function \\\\w+', '**/*.js'));
`)); }
		await vscode.window.showTextDocument(u);
	});
	register(ctx, 'axiora.sketch.run', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; }
		const code = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
		const abs = (p: string) => path.isAbsolute(p) ? p : path.join(r.fsPath, p);
		const print = (...a: unknown[]) => out.appendLine(a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 2)).join(' '));
		const tools = {
			ls: async (g = '**/*') => (await vscode.workspace.findFiles(g, '**/node_modules/**', 500)).map(u => vscode.workspace.asRelativePath(u)),
			read: async (p: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(abs(p)))),
			grep: async (re: string, g = '**/*') => { const rx = new RegExp(re); const hits: string[] = []; for (const u of await vscode.workspace.findFiles(g, '**/node_modules/**', 500)) { const t = new TextDecoder().decode(await vscode.workspace.fs.readFile(u)); t.split('\n').forEach((l, i) => { if (rx.test(l)) { hits.push(`${vscode.workspace.asRelativePath(u)}:${i + 1}: ${l.trim().slice(0, 120)}`); } }); } return hits; },
			run: (cmd: string) => new Promise<string>(res => cp.exec(cmd, { cwd: r.fsPath, timeout: 60000 }, (e, so, se) => res(`${so}${se}${e ? `\n[exit ${e.code}]` : ''}`))),
			edit: async (p: string, find: string, rep: string) => { const u = vscode.Uri.file(abs(p)); const d = await vscode.workspace.openTextDocument(u); const t = d.getText(); const i = t.indexOf(find); if (i < 0) { return false; } const we = new vscode.WorkspaceEdit(); we.replace(u, new vscode.Range(d.positionAt(i), d.positionAt(i + find.length)), rep); return vscode.workspace.applyEdit(we); },
			ask: (p: string) => ask(p),
			git: (...a: string[]) => run('git', a, r.fsPath),
		};
		out.show(true); out.appendLine(`▶ ${new Date().toLocaleTimeString()} — running ${ed.selection.isEmpty ? 'sketchpad' : 'selection'}`);
		try { const AsyncFn = Object.getPrototypeOf(async () => undefined).constructor; const v = await new AsyncFn('tools', 'print', code)(tools, print); if (v !== undefined) { print(v); } }
		catch (e) { out.appendLine(`✖ ${(e as Error).stack ?? e}`); }
	});
}
