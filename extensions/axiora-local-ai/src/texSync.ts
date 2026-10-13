/*---------------------------------------------------------------------------------------------
 *  LaTeX SyncTeX viewer: renders the PDF built with -synctex=1 page-by-page (poppler pdftoppm),
 *  forward search (source line → highlighted spot in the PDF) and reverse search
 *  (Ctrl/Cmd+click in the PDF → jump to the source line) using the `synctex` CLI shipped with
 *  TeX Live / MiKTeX.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register, run } from './util';

interface View { panel: vscode.WebviewPanel; pdf: string; dir: string; pages: number; dpi: number }
const views = new Map<string, View>();
const parse = (out: string, key: string) => out.split('\n').filter(l => l.startsWith(key + ':')).map(l => l.slice(key.length + 1).trim());

async function render(pdf: string, dpi: number): Promise<{ dir: string; pages: number }> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiora-pdf-'));
	await run('pdftoppm', ['-r', String(dpi), '-png', pdf, path.join(dir, 'p')], path.dirname(pdf)).catch(e => { throw new Error(`pdftoppm not found (${e.message}). Install poppler-utils (Linux), "brew install poppler" (macOS) or poppler for Windows.`); });
	return { dir, pages: fs.readdirSync(dir).filter(f => f.endsWith('.png')).length };
}
async function open(pdf: string): Promise<View> {
	let v = views.get(pdf); const dpi = vscode.workspace.getConfiguration('axiora.latex').get<number>('viewerDpi', 110);
	const r = await render(pdf, dpi);
	if (!v) {
		const panel = vscode.window.createWebviewPanel('axiora.synctex', `PDF: ${path.basename(pdf)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [vscode.Uri.file(os.tmpdir())], retainContextWhenHidden: true });
		v = { panel, pdf, dpi, ...r }; views.set(pdf, v); panel.onDidDispose(() => views.delete(pdf));
		panel.webview.onDidReceiveMessage(async m => { if (m.type === 'click') { await reverse(views.get(pdf)!, m.page, m.x, m.y); } });
	} else { fs.rmSync(v.dir, { recursive: true, force: true }); Object.assign(v, r, { dpi }); }
	const files = fs.readdirSync(v.dir).filter(f => f.endsWith('.png')).sort();
	const imgs = files.map((f, i) => `<div class=pg data-p="${i + 1}"><img src="${v!.panel.webview.asWebviewUri(vscode.Uri.file(path.join(v!.dir, f)))}"><div class=hl></div></div>`).join('');
	v.panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${v.panel.webview.cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>body{margin:0;background:#525659;text-align:center}.pg{position:relative;display:inline-block;margin:8px auto;box-shadow:0 1px 4px #0008}.pg img{display:block;max-width:100%}.hl{position:absolute;display:none;left:0;right:0;height:18px;background:#ffeb3b66;pointer-events:none}</style></head><body title="Ctrl/Cmd+click to jump to source">${imgs}<script>
const v=acquireVsCodeApi(),DPI=${v.dpi};document.querySelectorAll('.pg').forEach(d=>d.addEventListener('click',e=>{if(!(e.ctrlKey||e.metaKey))return;const im=d.querySelector('img'),r=im.getBoundingClientRect(),s=im.naturalWidth/r.width;v.postMessage({type:'click',page:+d.dataset.p,x:(e.clientX-r.left)*s*72/DPI,y:(e.clientY-r.top)*s*72/DPI})}));
addEventListener('message',e=>{const m=e.data;if(m.type!=='show')return;document.querySelectorAll('.hl').forEach(h=>h.style.display='none');const d=document.querySelector('.pg[data-p="'+m.page+'"]');if(!d)return;const im=d.querySelector('img'),s=im.getBoundingClientRect().width/im.naturalWidth,h=d.querySelector('.hl');h.style.top=((m.y-m.h)*DPI/72*s)+'px';h.style.height=Math.max(14,m.h*DPI/72*s+4)+'px';h.style.display='block';h.scrollIntoView({block:'center',behavior:'smooth'})});
</script></body></html>`;
	return v;
}
async function reverse(v: View, page: number, x: number, y: number) {
	const out = await run('synctex', ['edit', '-o', `${page}:${x.toFixed(1)}:${y.toFixed(1)}:${v.pdf}`], path.dirname(v.pdf)).catch(e => { vscode.window.showErrorMessage(`synctex CLI not available: ${e.message}`); return ''; });
	const input = parse(out, 'Input')[0], line = +(parse(out, 'Line')[0] ?? 0), col = Math.max(0, +(parse(out, 'Column')[0] ?? 0));
	if (!input || !line) { vscode.window.setStatusBarMessage('SyncTeX: no source location here', 3000); return; }
	const file = path.isAbsolute(input) ? input : path.resolve(path.dirname(v.pdf), input);
	const ed = await vscode.window.showTextDocument(vscode.Uri.file(path.normalize(file)), { viewColumn: vscode.ViewColumn.One });
	const pos = new vscode.Position(line - 1, col); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.tex.syncView', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed || !ed.document.fileName.endsWith('.tex')) { return; }
		await ed.document.save();
		const pdf = ed.document.fileName.replace(/\.tex$/, '.pdf');
		if (!fs.existsSync(pdf) || fs.statSync(pdf).mtimeMs < fs.statSync(ed.document.fileName).mtimeMs) { await vscode.commands.executeCommand('axiora.tex.build'); }
		if (!fs.existsSync(pdf)) { return; }
		const v = views.get(pdf) ?? await open(pdf);
		const out = await run('synctex', ['view', '-i', `${ed.selection.active.line + 1}:${ed.selection.active.character + 1}:${ed.document.fileName}`, '-o', pdf], path.dirname(pdf)).catch(e => { vscode.window.showErrorMessage(`synctex CLI not available (${e.message}); build with -synctex=1 using TeX Live/MiKTeX.`); return ''; });
		const page = +(parse(out, 'Page')[0] ?? 0); if (!page) { return; }
		v.panel.reveal(undefined, true); void v.panel.webview.postMessage({ type: 'show', page, y: +(parse(out, 'v')[0] ?? 0) + +(parse(out, 'H')[0] ?? 0), h: +(parse(out, 'H')[0] ?? 12) });
	});
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async d => { const pdf = d.fileName.replace(/\.tex$/, '.pdf'); if (d.fileName.endsWith('.tex') && views.has(pdf)) { setTimeout(() => { if (fs.existsSync(pdf)) { void open(pdf); } }, 1500); } }));
}
