/*---------------------------------------------------------------------------------------------
 *  Jupyter-style data workflow without Jupyter: "# %%" cells in .py/.R/.jl files with
 *  Run Cell / Run Cell and Advance / Run All Above CodeLens, a persistent interactive console
 *  per language, and a variable explorer (Python) rendered as a table.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { register, chatCommands, SYS } from './util';
import { chat } from './llm';

const CELL = /^\s*(#\s*%%|#\s*In\[|##\s*%%)/;
const REPL: Record<string, string> = { python: 'python3 -q -i', r: 'R --quiet --no-save', julia: 'julia -q' };
function cells(doc: vscode.TextDocument): vscode.Range[] {
	const starts: number[] = [];
	for (let i = 0; i < doc.lineCount; i++) { if (CELL.test(doc.lineAt(i).text)) { starts.push(i); } }
	if (!starts.length) { return []; }
	return starts.map((s, i) => { const e = (starts[i + 1] ?? doc.lineCount) - 1; return new vscode.Range(s, 0, e, doc.lineAt(e).text.length); });
}
export function activate(ctx: vscode.ExtensionContext) {
	const terms = new Map<string, vscode.Terminal>();
	ctx.subscriptions.push(vscode.window.onDidCloseTerminal(t => { for (const [k, v] of terms) { if (v === t) { terms.delete(k); } } }));
	let session = 'main';
	const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101); sb.command = 'axiora.cells.session'; ctx.subscriptions.push(sb);
	const showSb = () => { const l = vscode.window.activeTextEditor?.document.languageId; if (l && REPL[l]) { sb.text = `$(notebook) ${session}`; sb.tooltip = 'Console session for # %% cells (click to switch)'; sb.show(); } else { sb.hide(); } };
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(showSb)); showSb();
	register(ctx, 'axiora.cells.session', async () => {
		const ex = [...new Set([...terms.keys()].map(k => k.split(':')[1]))];
		const p = await vscode.window.showQuickPick([...ex.map(e => ({ label: e, description: e === session ? 'current' : '' })), { label: '$(add) New Session...', description: '' }], { placeHolder: 'Console session (each has its own interpreter state)' });
		if (!p) { return; }
		session = p.label.startsWith('$(add)') ? (await vscode.window.showInputBox({ prompt: 'Session name', value: `session${ex.length + 1}` })) ?? session : p.label; showSb();
	});
	register(ctx, 'axiora.cells.restart', async () => { const l = vscode.window.activeTextEditor?.document.languageId ?? 'python'; terms.get(`${l}:${session}`)?.dispose(); terms.delete(`${l}:${session}`); consoleFor(l); });
	const consoleFor = (lang: string) => {
		const key = `${lang}:${session}`;
		let t = terms.get(key);
		if (!t) { t = vscode.window.createTerminal({ name: `Console: ${lang} [${session}]`, iconPath: new vscode.ThemeIcon('notebook') }); t.sendText(REPL[lang] ?? 'python3 -q -i'); terms.set(key, t); }
		t.show(true); return t;
	};
	const send = (lang: string, code: string) => {
		const t = consoleFor(lang);
		if (lang === 'python') {
			// paste-safe: execute via a temp file so indentation/blank lines work in the REPL
			const f = path.join(os.tmpdir(), `axiora-cell-${process.pid}.py`); fs.writeFileSync(f, code);
			t.sendText(`exec(compile(open(${JSON.stringify(f)}).read(), "<cell>", "exec"))`);
		} else { t.sendText(code); }
	};
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider([{ language: 'python' }, { language: 'r' }, { language: 'julia' }], {
		provideCodeLenses(doc) {
			return cells(doc).flatMap(r => [
				new vscode.CodeLens(r, { title: '▶ Run Cell', command: 'axiora.cells.run', arguments: [doc.uri, r.start.line] }),
				new vscode.CodeLens(r, { title: 'Run Above', command: 'axiora.cells.runAbove', arguments: [doc.uri, r.start.line] }),
				new vscode.CodeLens(r, { title: 'Variables', command: 'axiora.cells.variables', arguments: [doc.uri] }),
				...(doc.languageId === 'python' ? [new vscode.CodeLens(r, { title: 'Output in Tab', command: 'axiora.cells.runToTab', arguments: [doc.uri, r.start.line] })] : []),
			]);
		}
	}));
	const at = async (uri: vscode.Uri | undefined, line?: number) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor!.document;
		const l = line ?? vscode.window.activeTextEditor!.selection.active.line;
		const cs = cells(doc); const i = cs.findIndex(r => r.start.line <= l && r.end.line >= l);
		return { doc, cs, i };
	};
	register(ctx, 'axiora.cells.run', async (uri?: vscode.Uri, line?: number) => {
		const { doc, cs, i } = await at(uri, line);
		const ed = vscode.window.activeTextEditor;
		const code = i >= 0 ? doc.getText(cs[i]) : (ed && !ed.selection.isEmpty ? doc.getText(ed.selection) : doc.lineAt(ed?.selection.active.line ?? 0).text);
		send(doc.languageId, code);
	});
	register(ctx, 'axiora.cells.runAdvance', async () => {
		const { doc, cs, i } = await at(undefined); if (i < 0) { await vscode.commands.executeCommand('axiora.cells.run'); return; }
		send(doc.languageId, doc.getText(cs[i]));
		const next = cs[i + 1]; const ed = vscode.window.activeTextEditor;
		if (next && ed) { const p = new vscode.Position(next.start.line + 1, 0); ed.selection = new vscode.Selection(p, p); ed.revealRange(next); }
	});
	register(ctx, 'axiora.cells.runAbove', async (uri?: vscode.Uri, line?: number) => {
		const { doc, cs, i } = await at(uri, line); if (i < 0) { return; }
		send(doc.languageId, cs.slice(0, i + 1).map(r => doc.getText(r)).join('\n'));
	});
	register(ctx, 'axiora.cells.runFile', async () => { const doc = vscode.window.activeTextEditor?.document; if (doc) { send(doc.languageId, doc.getText()); } });
	register(ctx, 'axiora.cells.variables', async () => {
		// Python only: dump user variables as JSON via the console, read the file back, show as a table
		const f = path.join(os.tmpdir(), `axiora-vars-${process.pid}-${session}.json`); try { fs.unlinkSync(f); } catch { /* none */ }
		consoleFor('python').sendText(`exec("import json as _j\\n_d={k:{'type':type(v).__name__,'value':repr(v)[:200],'shape':str(getattr(v,'shape',''))} for k,v in globals().items() if not k.startswith('_') and type(v).__name__ not in ('module','function','type','builtin_function_or_method')}\\nopen(${JSON.stringify(f).replace(/"/g, '\\"')},'w').write(_j.dumps(_d))")`);
		for (let n = 0; n < 30 && !fs.existsSync(f); n++) { await new Promise(r => setTimeout(r, 200)); }
		if (!fs.existsSync(f)) { vscode.window.showWarningMessage('No response from the Python console.'); return; }
		const vars = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, { type: string; value: string; shape: string }>;
		const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
		const p = vscode.window.createWebviewPanel('axiora.vars', 'Variables', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {});
		p.webview.html = `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--vscode-panel-border);padding:3px 8px;text-align:left;vertical-align:top}th{background:var(--vscode-editorGroupHeader-tabsBackground)}</style></head><body><table><tr><th>Name</th><th>Type</th><th>Shape</th><th>Value</th></tr>${Object.entries(vars).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v.type)}</td><td>${esc(v.shape)}</td><td><code>${esc(v.value)}</code></td></tr>`).join('')}</table></body></html>`;
	});

	// --- run a Python cell with its output (text + matplotlib figures) shown in an editor tab
	const pyRun = async (code: string, tag: string) => {
		const base = path.join(os.tmpdir(), `axiora-cell-${process.pid}-${Date.now()}`);
		fs.writeFileSync(`${base}.code.py`, code);
		fs.writeFileSync(`${base}.run.py`, `import contextlib as _c, io as _i, traceback as _t, json as _j, sys as _s
_b = _i.StringIO(); _imgs = []
with _c.redirect_stdout(_b), _c.redirect_stderr(_b):
    try:
        exec(compile(open(${JSON.stringify(base + '.code.py')}).read(), ${JSON.stringify(tag)}, 'exec'), globals())
    except Exception:
        _t.print_exc()
    if 'matplotlib.pyplot' in _s.modules:
        _plt = _s.modules['matplotlib.pyplot']
        for _n in _plt.get_fignums():
            _f = ${JSON.stringify(base)} + '-%d.png' % _n; _plt.figure(_n).savefig(_f); _imgs.append(_f)
        _plt.close('all')
open(${JSON.stringify(base + '.out.json')}, 'w').write(_j.dumps({'text': _b.getvalue(), 'images': _imgs}))
`);
		consoleFor('python').sendText(`exec(open(${JSON.stringify(base + '.run.py')}).read())`);
		const out = `${base}.out.json`;
		for (let n = 0; n < 300 && !fs.existsSync(out); n++) { await new Promise(r => setTimeout(r, 200)); }
		if (!fs.existsSync(out)) { throw new Error('No response from the Python console (still running?)'); }
		return JSON.parse(fs.readFileSync(out, 'utf8')) as { text: string; images: string[] };
	};
	let outPanel: vscode.WebviewPanel | undefined;
	register(ctx, 'axiora.cells.runToTab', async (uri?: vscode.Uri, line?: number) => {
		const { doc, cs, i } = await at(uri, line);
		if (doc.languageId !== 'python') { vscode.window.showInformationMessage('Output in a tab is available for Python cells.'); return; }
		const code = i >= 0 ? doc.getText(cs[i]) : doc.getText();
		const title = i >= 0 ? (doc.lineAt(cs[i].start.line).text.replace(/^#\s*%%\s*/, '') || `Cell ${i + 1}`) : path.basename(doc.fileName);
		const r = await pyRun(code, `${path.basename(doc.fileName)}#cell${i + 1}`);
		const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
		if (!outPanel) { outPanel = vscode.window.createWebviewPanel('axiora.cellOut', 'Cell Output', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { localResourceRoots: [vscode.Uri.file(os.tmpdir())] }); outPanel.onDidDispose(() => outPanel = undefined); }
		outPanel.title = `Output: ${title}`;
		const w = outPanel.webview;
		w.html = `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px}pre{font-family:var(--vscode-editor-font-family);white-space:pre-wrap}img{max-width:100%;background:#fff}h3{font-weight:600;opacity:.8}</style></head><body><h3>${esc(title)} <small>· ${new Date().toLocaleTimeString()} · session ${esc(session)}</small></h3><pre>${esc(r.text) || '<i>(no output)</i>'}</pre>${r.images.map(f => `<img src="${w.asWebviewUri(vscode.Uri.file(f))}">`).join('')}</body></html>`;
		outPanel.reveal(undefined, true);
	});
	// --- @axiora /data: assistant connected to the live data session (variables + current cell)
	chatCommands.set('data', async (req, stream, token) => {
		const ed = vscode.window.activeTextEditor; const doc = ed?.document;
		let ctxText = '';
		if (doc?.languageId === 'python') {
			stream.progress('Reading the live Python session…');
			try {
				const r = await pyRun(`import json as _jj\nprint(_jj.dumps({k:{'type':type(v).__name__,'value':repr(v)[:300],'shape':str(getattr(v,'shape',''))} for k,v in globals().items() if not k.startswith('_') and type(v).__name__ not in ('module','function','type','builtin_function_or_method')}))`, 'vars');
				ctxText += `\n\nLive session "${session}" variables (name: type shape = value):\n` + Object.entries(JSON.parse(r.text.trim().split('\n').pop() || '{}') as Record<string, { type: string; value: string; shape: string }>).map(([k, v]) => `- ${k}: ${v.type}${v.shape ? ` ${v.shape}` : ''} = ${v.value}`).join('\n');
			} catch (e) { ctxText += `\n\n(session not readable: ${(e as Error).message})`; }
			const { cs, i } = await at(doc.uri); if (i >= 0) { ctxText += `\n\nCurrent cell:\n\`\`\`python\n${doc.getText(cs[i])}\n\`\`\``; }
		} else { ctxText = '\n\n(open a Python file with # %% cells to connect to its session)'; }
		await chat([{ role: 'system', content: `${SYS}\nYou are a data-science assistant connected to the user's live Python session. Use the real variable names/types/shapes below. Give runnable code for a new # %% cell.` }, { role: 'user', content: req.prompt + ctxText }], s => stream.markdown(s), token);
		stream.button({ command: 'axiora.cells.variables', title: 'Show Variables' });
	});
	void cp;
}
