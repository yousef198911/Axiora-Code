/*---------------------------------------------------------------------------------------------
 *  Kernel-backed Markdown documents (R Markdown / Quarto style): fenced ```python and ```js
 *  blocks in .md/.qmd files get "▶ Run | Run All | Restart Kernel" CodeLenses. Each document
 *  has its own live kernel (state persists across blocks); output is written back below the
 *  block as an ```output fence, so the document stays plain, diffable Markdown.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { register } from './util';

const PY_KERNEL = `import sys,json,io,contextlib,traceback
g={'__name__':'__main__'}
for line in sys.stdin:
    req=json.loads(line);b=io.StringIO()
    with contextlib.redirect_stdout(b),contextlib.redirect_stderr(b):
        try:
            import ast
            t=ast.parse(req['code']);last=t.body[-1] if t.body and isinstance(t.body[-1],ast.Expr) else None
            if last: t.body=t.body[:-1]
            exec(compile(t,'<block>','exec'),g)
            if last:
                v=eval(compile(ast.Expression(last.value),'<block>','eval'),g)
                if v is not None: print(repr(v))
        except Exception: traceback.print_exc()
    sys.__stdout__.write(json.dumps({'out':b.getvalue()})+'\\n');sys.__stdout__.flush()
`;
const JS_KERNEL = `const vm=require('vm'),rl=require('readline').createInterface({input:process.stdin});const ctx=vm.createContext({require,console:null,process});
rl.on('line',async l=>{const {code}=JSON.parse(l);let out='';const w=(...a)=>{out+=a.map(x=>typeof x==='string'?x:require('util').inspect(x)).join(' ')+'\\n'};ctx.console={log:w,error:w,warn:w,info:w};
try{let v=vm.runInContext(code,ctx);if(v&&typeof v.then==='function')v=await v;if(v!==undefined)w(v)}catch(e){out+=(e&&e.stack)||String(e)}process.stdout.write(JSON.stringify({out})+'\\n')});`;
type Kernel = { p: cp.ChildProcess; queue: ((s: string) => void)[]; buf: string };
export type Block = { lang: 'python' | 'js'; start: number; end: number; code: string; outStart?: number; outEnd?: number };
export function blocks(text: string): Block[] {
	const lines = text.split('\n'); const out: Block[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^```\s*\{?(python|py|js|javascript|node)\}?\s*$/.exec(lines[i]); if (!m) { continue; }
		let j = i + 1; while (j < lines.length && !/^```\s*$/.test(lines[j])) { j++; }
		const b: Block = { lang: /^py/.test(m[1]) ? 'python' : 'js', start: i, end: j, code: lines.slice(i + 1, j).join('\n') };
		let k = j + 1; while (k < lines.length && lines[k].trim() === '') { k++; }
		if (/^```output\s*$/.test(lines[k] ?? '')) { let e = k + 1; while (e < lines.length && !/^```\s*$/.test(lines[e])) { e++; } b.outStart = k; b.outEnd = e; }
		out.push(b); i = b.outEnd ?? j;
	}
	return out;
}
export function activate(ctx: vscode.ExtensionContext) {
	const kernels = new Map<string, Kernel>();
	const kernel = (doc: vscode.TextDocument, lang: Block['lang']) => {
		const key = `${doc.uri}|${lang}`; let k = kernels.get(key);
		if (!k || k.p.exitCode !== null) {
			const p = lang === 'python' ? cp.spawn('python3', ['-u', '-c', PY_KERNEL], { cwd: path.dirname(doc.fileName) }) : cp.spawn('node', ['-e', JS_KERNEL], { cwd: path.dirname(doc.fileName) });
			const kk: Kernel = { p, queue: [], buf: '' }; k = kk;
			p.stdout!.on('data', d => { kk.buf += d; let i; while ((i = kk.buf.indexOf('\n')) >= 0) { const l = kk.buf.slice(0, i); kk.buf = kk.buf.slice(i + 1); try { kk.queue.shift()?.(JSON.parse(l).out); } catch { /* noise */ } } });
			p.on('error', e => { kk.queue.splice(0).forEach(f => f(`Kernel failed to start: ${e.message}`)); });
			kernels.set(key, k);
		}
		return k;
	};
	const exec = (doc: vscode.TextDocument, b: Block) => new Promise<string>(res => { const k = kernel(doc, b.lang); k.queue.push(res); k.p.stdin!.write(JSON.stringify({ code: b.code }) + '\n'); });
	const writeOut = async (doc: vscode.TextDocument, idx: number, out: string) => {
		const b = blocks(doc.getText())[idx]; if (!b) { return; }
		const fence = `\`\`\`output\n${out.replace(/\n+$/, '') || '(no output)'}\n\`\`\``;
		const we = new vscode.WorkspaceEdit();
		if (b.outStart !== undefined) { we.replace(doc.uri, new vscode.Range(b.outStart, 0, b.outEnd!, doc.lineAt(Math.min(b.outEnd!, doc.lineCount - 1)).text.length), fence); }
		else { we.insert(doc.uri, new vscode.Position(b.end, doc.lineAt(b.end).text.length), `\n\n${fence}`); }
		await vscode.workspace.applyEdit(we);
	};
	register(ctx, 'axiora.kdoc.run', async (uri: vscode.Uri, idx: number) => { const doc = await vscode.workspace.openTextDocument(uri); const b = blocks(doc.getText())[idx]; if (b) { await writeOut(doc, idx, await exec(doc, b)); } });
	register(ctx, 'axiora.kdoc.runAll', async (uri?: vscode.Uri) => { const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document; if (!doc) { return; } const n = blocks(doc.getText()).length; for (let i = 0; i < n; i++) { const b = blocks(doc.getText())[i]; await writeOut(doc, i, await exec(doc, b)); } });
	register(ctx, 'axiora.kdoc.restart', (uri?: vscode.Uri) => { const u = (uri ?? vscode.window.activeTextEditor?.document.uri)?.toString(); for (const [k, v] of kernels) { if (k.startsWith(`${u}|`)) { v.p.kill(); kernels.delete(k); } } vscode.window.setStatusBarMessage('Kernel restarted', 2000); });
	register(ctx, 'axiora.kdoc.clear', async () => { const ed = vscode.window.activeTextEditor; if (!ed) { return; } const bs = blocks(ed.document.getText()).filter(b => b.outStart !== undefined).reverse(); await ed.edit(e => bs.forEach(b => e.delete(new vscode.Range(b.end + 1, 0, b.outEnd! + 1, 0)))); });
	ctx.subscriptions.push({ dispose: () => kernels.forEach(k => k.p.kill()) });
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider([{ language: 'markdown' }, { pattern: '**/*.qmd' }], {
		provideCodeLenses: doc => blocks(doc.getText()).flatMap((b, i) => { const r = new vscode.Range(b.start, 0, b.start, 0); return [new vscode.CodeLens(r, { title: '▶ Run', command: 'axiora.kdoc.run', arguments: [doc.uri, i] }), ...(i === 0 ? [new vscode.CodeLens(r, { title: 'Run All', command: 'axiora.kdoc.runAll', arguments: [doc.uri] }), new vscode.CodeLens(r, { title: 'Restart Kernel', command: 'axiora.kdoc.restart', arguments: [doc.uri] })] : [])]; }),
	}));
}
