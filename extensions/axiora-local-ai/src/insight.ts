/*---------------------------------------------------------------------------------------------
 *  Insight tools:
 *  - Time-Travel Debugging (Python): record every executed line + locals, then scrub back and
 *    forth with a slider; the editor follows the current line.
 *  - Custom Instruments: .axiora/instruments.json [{name, command, interval, regex, unit}] →
 *    live charts (e.g. RSS of a process, queue length, open connections).
 *  - APK / AAB analysis without the Android SDK: size breakdown, DEX class/method counts
 *    (64K limit), native ABIs, largest files.
 *  - Semantic index: local embeddings via your model server (/api/embed or /embeddings) with
 *    a hashed bag-of-words fallback; "/semantic <query>" answers from the closest chunks.
 *  - Extension REPL: a terminal that evaluates JavaScript with the live `vscode` API.
 *  - WASI plugins: .axiora/plugins/*.wasm run sandboxed (node:wasi) as text filters
 *    (document/selection on stdin → stdout replaces it).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { chatCommands, register, wsRoot, SYS, run } from './util';
import { chat } from './llm';

const TRACER = `import sys, json, runpy, os
target, out = sys.argv[1], sys.argv[2]
steps = []; root = os.path.dirname(os.path.abspath(target))
def r(v):
    try: s = repr(v)
    except Exception: s = '<unrepr>'
    return s[:120]
def tr(frame, event, arg):
    f = frame.f_code.co_filename
    if not os.path.abspath(f).startswith(root): return tr
    if event in ('line', 'return', 'exception') and len(steps) < 5000:
        st = {'file': os.path.abspath(f), 'line': frame.f_lineno, 'func': frame.f_code.co_name, 'event': event,
              'locals': {k: r(v) for k, v in frame.f_locals.items() if not k.startswith('__')}}
        d = 0; g = frame
        while g: d += 1; g = g.f_back
        st['depth'] = d
        if event == 'return': st['ret'] = r(arg)
        steps.append(st)
    return tr
sys.argv = [target]; sys.settrace(tr)
try: runpy.run_path(target, run_name='__main__')
except SystemExit: pass
except Exception as e: steps.append({'file': os.path.abspath(target), 'line': 0, 'func': '<error>', 'event': 'error', 'locals': {'error': r(e)}, 'depth': 0})
finally:
    sys.settrace(None); json.dump(steps, open(out, 'w'))
`;
export function dexCounts(b: Buffer): { classes: number; methods: number } | undefined {
	if (b.length < 0x70 || b.toString('latin1', 0, 3) !== 'dex') { return undefined; }
	return { methods: b.readUInt32LE(0x58), classes: b.readUInt32LE(0x60) };
}
const APK_PY = `import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1]); out = {'files': [], 'dex': {}}
for i in z.infolist():
    out['files'].append([i.filename, i.file_size, i.compress_size])
    if i.filename.endswith('.dex'):
        out['dex'][i.filename] = z.read(i.filename)[:0x70].hex()
print(json.dumps(out))`;
export function hashVec(text: string, dims = 512): number[] {
	const v = new Array(dims).fill(0);
	for (const w of text.toLowerCase().split(/[^a-z0-9_]+/).filter(x => x.length > 2)) { let h = 2166136261; for (let i = 0; i < w.length; i++) { h = Math.imul(h ^ w.charCodeAt(i), 16777619); } v[(h >>> 0) % dims] += 1; }
	const n = Math.hypot(...v) || 1; return v.map(x => x / n);
}
const cos = (a: number[], b: number[]) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na * nb) || 1); };
async function embed(texts: string[]): Promise<{ vecs: number[][]; kind: string }> {
	const c = vscode.workspace.getConfiguration('axiora.ai'); const prov = c.get<string>('provider', 'ollama'); const base = c.get<string>('baseUrl', 'http://127.0.0.1:11434').replace(/\/$/, ''); const model = c.get<string>('embeddingModel', 'nomic-embed-text');
	try {
		const r = await fetch(prov === 'ollama' ? `${base}/api/embed` : `${base}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts }), signal: AbortSignal.timeout(60000) });
		const j = await r.json() as any; const vecs: number[][] = prov === 'ollama' ? j.embeddings : j.data?.map((d: any) => d.embedding);
		if (Array.isArray(vecs) && vecs.length === texts.length && Array.isArray(vecs[0]) && vecs[0].length > 8) { return { vecs, kind: `embeddings (${model})` }; }
	} catch { /* fall back */ }
	return { vecs: texts.map(t => hashVec(t)), kind: 'local hashed vectors (no embedding model available)' };
}
export function activate(ctx: vscode.ExtensionContext) {
	// ---- time travel
	register(ctx, 'axiora.timeTravel.record', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed || ed.document.languageId !== 'python') { vscode.window.showInformationMessage('Open a Python script to record.'); return; }
		await ed.document.save();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiora-tt-')); const tr = path.join(tmp, 'tracer.py'), out = path.join(tmp, 'trace.json'); fs.writeFileSync(tr, TRACER);
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Recording execution…' }, () => run('python3', [tr, ed.document.fileName, out], path.dirname(ed.document.fileName)).catch(() => ''));
		const steps = JSON.parse(fs.readFileSync(out, 'utf8')) as { file: string; line: number; func: string; event: string; locals: Record<string, string>; depth: number; ret?: string }[];
		if (!steps.length) { vscode.window.showWarningMessage('Nothing recorded.'); return; }
		const deco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'), isWholeLine: true, after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2em' } });
		const panel = vscode.window.createWebviewPanel('axioraTT', `Time Travel: ${path.basename(ed.document.fileName)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
		const minD = Math.min(...steps.map(s => s.depth || 0));
		panel.webview.html = `<!doctype html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:10px}input[type=range]{width:100%}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 10px;margin-right:4px;border-radius:3px;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:8px;font-family:var(--vscode-editor-font-family);font-size:12px}td{border-bottom:1px solid var(--vscode-panel-border);padding:3px 6px;vertical-align:top}.chg{color:var(--vscode-charts-orange)}#h{opacity:.8;margin:6px 0}</style></head><body><div><button id=f>⏮</button><button id=p>◀ Back</button><button id=n>Step ▶</button><button id=l>⏭</button> <span id=c></span></div><input type=range id=s min=0 max=${steps.length - 1} value=0><div id=h></div><table id=t></table><script>const v=acquireVsCodeApi();const S=${JSON.stringify(steps)};const s=document.getElementById('s');function show(i){i=Math.max(0,Math.min(S.length-1,i));s.value=i;const st=S[i],pv=S[i-1]||{locals:{}};document.getElementById('c').textContent='step '+(i+1)+' / '+S.length;document.getElementById('h').textContent=st.func+'() · line '+st.line+' · '+st.event+(st.ret!==undefined?' → '+st.ret:'')+' · depth '+(st.depth-${minD});document.getElementById('t').innerHTML=Object.entries(st.locals).map(([k,x])=>'<tr><td>'+k+'</td><td class="'+(pv.locals[k]!==x&&pv.func===st.func?'chg':'')+'">'+x.replace(/</g,'&lt;')+'</td></tr>').join('')||'<tr><td>(no locals)</td></tr>';v.postMessage(i)}s.oninput=()=>show(+s.value);document.getElementById('p').onclick=()=>show(+s.value-1);document.getElementById('n').onclick=()=>show(+s.value+1);document.getElementById('f').onclick=()=>show(0);document.getElementById('l').onclick=()=>show(S.length-1);addEventListener('keydown',e=>{if(e.key==='ArrowLeft')show(+s.value-1);if(e.key==='ArrowRight')show(+s.value+1)});show(0)</script></body></html>`;
		panel.webview.onDidReceiveMessage(async (i: number) => {
			const st = steps[i]; if (!st.line) { return; }
			const e2 = vscode.window.visibleTextEditors.find(x => x.document.fileName === st.file) ?? await vscode.window.showTextDocument(vscode.Uri.file(st.file), { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
			const ln = Math.max(0, st.line - 1); const shown = Object.entries(st.locals).slice(0, 4).map(([k, v]) => `${k}=${v}`).join('  ');
			e2.setDecorations(deco, [{ range: new vscode.Range(ln, 0, ln, 0), renderOptions: { after: { contentText: `  ⏱ ${i + 1}/${steps.length}  ${shown.slice(0, 120)}` } } }]);
			e2.revealRange(new vscode.Range(ln, 0, ln, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		});
		panel.onDidDispose(() => deco.dispose());
	});
	// ---- instruments
	register(ctx, 'axiora.instruments.open', async () => {
		const r = wsRoot(); if (!r) { return; } const f = vscode.Uri.joinPath(r, '.axiora', 'instruments.json');
		let defs: { name: string; command: string; interval?: number; regex?: string; unit?: string }[];
		try { defs = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(f))); } catch {
			defs = [{ name: 'Editor host RSS', command: `ps -o rss= -p ${process.pid}`, interval: 1000, regex: '(\\d+)', unit: 'KB' }, { name: 'Load average (1m)', command: 'cat /proc/loadavg', interval: 2000, regex: '^([\\d.]+)', unit: '' }];
			await vscode.workspace.fs.writeFile(f, new TextEncoder().encode(JSON.stringify(defs, null, 2)));
		}
		const panel = vscode.window.createWebviewPanel('axioraInstr', 'Instruments', vscode.ViewColumn.Active, { enableScripts: true });
		panel.webview.html = `<!doctype html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:10px}.i{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;margin-bottom:10px}.i h4{margin:0 0 4px;display:flex;justify-content:space-between}canvas{width:100%;height:110px}</style></head><body>${defs.map((d, i) => `<div class=i><h4><span>${d.name.replace(/</g, '&lt;')}</span><span id=v${i}>—</span></h4><canvas id=c${i}></canvas></div>`).join('')}<script>const D=${JSON.stringify(defs.map(d => d.unit ?? ''))};const H=D.map(()=>[]);addEventListener('message',e=>{const{i,v}=e.data;const h=H[i];h.push(v);if(h.length>120)h.shift();document.getElementById('v'+i).textContent=v+' '+D[i];const c=document.getElementById('c'+i);c.width=c.clientWidth;c.height=110;const g=c.getContext('2d');const mn=Math.min(...h),mx=Math.max(...h),sp=(mx-mn)||1;g.strokeStyle=getComputedStyle(document.body).getPropertyValue('--vscode-charts-blue')||'#3b82f6';g.lineWidth=2;g.beginPath();h.forEach((y,k)=>{const X=k*(c.width/119),Y=100-((y-mn)/sp)*90;k?g.lineTo(X,Y):g.moveTo(X,Y)});g.stroke();g.fillStyle='#888';g.font='10px sans-serif';g.fillText(mx+'',2,10);g.fillText(mn+'',2,108)})</script></body></html>`;
		const timers = defs.map((d, i) => setInterval(() => cp.exec(d.command, { cwd: r.fsPath, timeout: 5000 }, (_e, so) => { const m = new RegExp(d.regex ?? '([\\d.]+)').exec(String(so)); if (m) { void panel.webview.postMessage({ i, v: +m[1] }); } }), Math.max(250, d.interval ?? 1000)));
		panel.onDidDispose(() => timers.forEach(clearInterval));
	});
	// ---- APK
	register(ctx, 'axiora.apk.analyze', async (u?: vscode.Uri) => {
		const f = u ?? (await vscode.window.showOpenDialog({ filters: { 'Android package': ['apk', 'aab'] } }))?.[0]; if (!f) { return; }
		const j = JSON.parse(await run('python3', ['-c', APK_PY, f.fsPath], os.tmpdir())) as { files: [string, number, number][]; dex: Record<string, string> };
		const total = j.files.reduce((n, x) => n + x[2], 0); const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
		const groups = new Map<string, number>(); for (const [n, , c] of j.files) { const g = n.includes('/') ? n.split('/')[0] + '/' : /\.dex$/.test(n) ? '*.dex' : n; groups.set(g, (groups.get(g) ?? 0) + c); }
		const dex = Object.entries(j.dex).map(([n, h]) => ({ n, c: dexCounts(Buffer.from(h, 'hex')) }));
		const abis = [...new Set(j.files.map(x => /^(?:base\/)?lib\/([^/]+)\//.exec(x[0])?.[1]).filter(Boolean))];
		const md = `# ${path.basename(f.fsPath)}\n\nDownload size (compressed): **${kb(total)}** · ${j.files.length} entries · manifest: ${j.files.some(x => /AndroidManifest\.xml$/.test(x[0])) ? 'present' : 'missing'}\n\n## Size by area\n| Area | Size | Share |\n|---|---|---|\n${[...groups].sort((a, b) => b[1] - a[1]).map(([g, n]) => `| ${g} | ${kb(n)} | ${(100 * n / (total || 1)).toFixed(1)}% |`).join('\n')}\n\n## DEX\n| File | Classes | Methods | 64K limit |\n|---|---|---|---|\n${dex.map(d => `| ${d.n} | ${d.c?.classes ?? '?'} | ${d.c?.methods ?? '?'} | ${d.c ? `${(100 * d.c.methods / 65536).toFixed(1)}%` : '?'} |`).join('\n') || '| — | | | |'}\n\n## Native ABIs\n${abis.length ? abis.join(', ') : 'none'}\n\n## Largest entries\n| Entry | Size |\n|---|---|\n${[...j.files].sort((a, b) => b[2] - a[2]).slice(0, 15).map(x => `| ${x[0]} | ${kb(x[2])} |`).join('\n')}\n`;
		await vscode.commands.executeCommand('markdown.showPreview', (await vscode.workspace.openTextDocument({ language: 'markdown', content: md })).uri);
	});
	// ---- semantic index
	const idxFile = () => path.join(ctx.storageUri?.fsPath ?? ctx.globalStorageUri.fsPath, 'semantic-index.json');
	let index: { kind: string; chunks: { file: string; start: number; text: string; v: number[] }[] } | undefined;
	const build = async () => {
		const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java,md,tsx,jsx,c,cpp,h,cs,rb,php}', '{**/node_modules/**,**/out/**,**/dist/**,**/.git/**}', 1500);
		const chunks: { file: string; start: number; text: string }[] = [];
		for (const u of files) { const t = new TextDecoder().decode(await vscode.workspace.fs.readFile(u)); if (t.length > 400_000) { continue; } const L = t.split('\n'); for (let i = 0; i < L.length; i += 40) { const text = L.slice(i, i + 50).join('\n'); if (text.trim().length > 30) { chunks.push({ file: vscode.workspace.asRelativePath(u), start: i, text }); } } }
		const out: { file: string; start: number; text: string; v: number[] }[] = []; let kind = '';
		for (let i = 0; i < chunks.length; i += 32) { const b = chunks.slice(i, i + 32); const e = await embed(b.map(c => `${c.file}\n${c.text}`)); kind = e.kind; b.forEach((c, k) => out.push({ ...c, v: e.vecs[k] })); }
		index = { kind, chunks: out }; fs.mkdirSync(path.dirname(idxFile()), { recursive: true }); fs.writeFileSync(idxFile(), JSON.stringify(index));
		return index;
	};
	const search = async (q: string, k = 6) => { index ??= fs.existsSync(idxFile()) ? JSON.parse(fs.readFileSync(idxFile(), 'utf8')) : await build(); const qv = index!.kind.startsWith('local') ? hashVec(q) : (await embed([q])).vecs[0]; return index!.chunks.map(c => ({ c, s: cos(qv, c.v) })).sort((a, b) => b.s - a.s).slice(0, k); };
	register(ctx, 'axiora.semantic.build', async () => { const i = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Building semantic index…' }, build); vscode.window.showInformationMessage(`Semantic index: ${i.chunks.length} chunks · ${i.kind}`); });
	chatCommands.set('semantic', async (req, stream, token) => {
		if (!req.prompt.trim()) { stream.markdown('Usage: `/semantic <what are you looking for>`'); return; }
		stream.progress('Searching the semantic index…'); const hits = await search(req.prompt);
		stream.markdown(`**Closest code** (${index!.kind}):\n`); for (const h of hits) { stream.markdown(`\n- \`${h.c.file}:${h.c.start + 1}\` (${h.s.toFixed(2)}) `); stream.anchor(new vscode.Location(vscode.Uri.joinPath(wsRoot()!, h.c.file), new vscode.Position(h.c.start, 0)), h.c.file); }
		stream.markdown('\n\n');
		await chat([{ role: 'system', content: `${SYS}\nAnswer using the retrieved code chunks; cite file:line.` }, { role: 'user', content: `${req.prompt}\n\n${hits.map(h => `--- ${h.c.file}:${h.c.start + 1}\n${h.c.text}`).join('\n').slice(0, 12000)}` }], s => stream.markdown(s), token);
	});
	// ---- REPL
	register(ctx, 'axiora.repl.open', () => {
		const ev = new vscode.EventEmitter<string>(); let line = ''; const hist: string[] = []; let hi = 0; const scope: Record<string, unknown> = {};
		const pty: vscode.Pseudoterminal = {
			onDidWrite: ev.event, open: () => ev.fire('Axiora Extension REPL — JavaScript with the live `vscode` API (await supported). Variables persist via `$.name`.\r\n> '), close() { /* */ },
			handleInput: async d => {
				if (d === '\r') { ev.fire('\r\n'); const src = line; line = ''; if (src.trim()) { hist.push(src); hi = hist.length; try { const AsyncFn = Object.getPrototypeOf(async () => undefined).constructor; const fn = new AsyncFn('vscode', '$', 'require', /^\s*(const|let|var|if|for|while|return|throw|try|class|function)\b|;/.test(src) ? src : `return (${src});`); const v = await fn(vscode, scope, require); ev.fire(`${(typeof v === 'string' ? JSON.stringify(v) : (() => { try { return JSON.stringify(v, null, 1) ?? String(v); } catch { return String(v); } })()).replace(/\n/g, '\r\n')}\r\n`); } catch (e) { ev.fire(`\x1b[31m${(e as Error).message}\x1b[0m\r\n`); } } ev.fire('> '); }
				else if (d === '\x7f') { if (line) { line = line.slice(0, -1); ev.fire('\b \b'); } }
				else if (d === '\x1b[A' || d === '\x1b[B') { hi = Math.max(0, Math.min(hist.length, hi + (d === '\x1b[A' ? -1 : 1))); ev.fire('\r\x1b[K> ' + (line = hist[hi] ?? '')); }
				else if (!d.startsWith('\x1b')) { line += d; ev.fire(d); }
			}
		};
		vscode.window.createTerminal({ name: 'Axiora REPL', pty, iconPath: new vscode.ThemeIcon('debug-console') }).show();
	});
	// ---- WASI plugins
	register(ctx, 'axiora.wasi.run', async () => {
		const r = wsRoot(); if (!r) { return; } const dir = vscode.Uri.joinPath(r, '.axiora', 'plugins');
		let ws: string[] = []; try { ws = (await vscode.workspace.fs.readDirectory(dir)).filter(([n]) => n.endsWith('.wasm')).map(([n]) => n); } catch { /* none */ }
		if (!ws.length) { vscode.window.showInformationMessage('No WASI plugins. Put *.wasm (wasip1) files in .axiora/plugins — they read the document/selection on stdin and write the replacement to stdout.'); return; }
		const p = ws.length === 1 ? ws[0] : await vscode.window.showQuickPick(ws, { placeHolder: 'Run WASI plugin' }); if (!p) { return; }
		const ed = vscode.window.activeTextEditor; const input = ed ? (ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection)) : '';
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiora-wasi-')); const inF = path.join(tmp, 'in'), outF = path.join(tmp, 'out'); fs.writeFileSync(inF, input);
		const { WASI } = await import('node:wasi'); const fin = fs.openSync(inF, 'r'), fout = fs.openSync(outF, 'w');
		const wasi = new WASI({ version: 'preview1', args: [p], env: {}, stdin: fin, stdout: fout, stderr: fout, returnOnExit: true, preopens: {} } as any);
		const WA = (globalThis as any).WebAssembly; const mod = await WA.compile(fs.readFileSync(path.join(dir.fsPath, p)));
		const inst = await WA.instantiate(mod, wasi.getImportObject());
		const code = wasi.start(inst); fs.closeSync(fin); fs.closeSync(fout); const out = fs.readFileSync(outF, 'utf8'); fs.rmSync(tmp, { recursive: true, force: true });
		if (code !== 0) { vscode.window.showErrorMessage(`Plugin ${p} exited ${code}: ${out.slice(0, 300)}`); return; }
		if (ed && vscode.workspace.getConfiguration('axiora.wasi').get('replace', true)) { await ed.edit(b => b.replace(ed.selection.isEmpty ? new vscode.Range(0, 0, ed.document.lineCount, 0) : ed.selection, out)); vscode.window.setStatusBarMessage(`WASI plugin ${p} applied (sandboxed, no file access)`, 4000); }
		else { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: out })); }
	});
}
