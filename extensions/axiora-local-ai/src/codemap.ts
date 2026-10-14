/*---------------------------------------------------------------------------------------------
 *  Codemaps: an interactive map of the codebase — modules as boxes grouped by folder, import
 *  edges between them, symbol counts; click a box to open the file, hover to highlight its
 *  dependencies. Supports JS/TS, Python, Go, Rust, Java/Kotlin, C/C++ include.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { htmlDir, htmlLang } from './i18n';
import * as path from 'path';
import * as fs from 'fs';
import { register, run, wsRoot } from './util';
import { axioraIgnore } from './repoMap';

const SRC = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|c|cc|cpp|h|hpp)$/;
export function imports(file: string, text: string): string[] {
	const out: string[] = []; const ext = path.extname(file);
	const re = /\.(py)$/.test(ext) ? /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm : /\.(c|cc|cpp|h|hpp)$/.test(ext) ? /#include\s+"([^"]+)"/g : /\.(go)$/.test(ext) ? /"([\w./-]+)"/g : /\.(rs)$/.test(ext) ? /^\s*(?:use|mod)\s+(?:crate::)?([\w:]+)/gm : /\.(java|kt)$/.test(ext) ? /^\s*import\s+([\w.]+)/gm : /(?:import\s[^'"]*?from\s*|import\s*\(|require\s*\(|import\s+)['"]([^'"]+)['"]/g;
	for (const m of text.matchAll(re)) { out.push(m[1] ?? m[2]); }
	return out;
}
export function resolve(from: string, spec: string, files: Set<string>): string | undefined {
	const dir = path.posix.dirname(from);
	const cands: string[] = [];
	if (spec.startsWith('.')) { const b = path.posix.normalize(path.posix.join(dir, spec)); cands.push(b, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '/index.ts', '/index.js'].map(e => b + e)); }
	if (/^\.*\w/.test(spec) && !spec.includes('/')) { const p = spec.replace(/^\.+/, '').replace(/\./g, '/').replace(/::/g, '/'); cands.push(p + '.py', path.posix.join(dir, p + '.py'), p + '/__init__.py', p + '.rs', path.posix.join(dir, p + '.rs'), p.replace(/\//g, '/') + '.java'); }
	if (spec.includes('/') && !spec.startsWith('.')) { cands.push(spec, path.posix.join(dir, spec)); }
	return cands.find(c => files.has(c)) ?? [...files].find(f => spec.includes('.') && /\.(java|kt)$/.test(f) && f.endsWith(spec.replace(/\./g, '/') + path.extname(f)));
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.codemap.show', async () => {
		const root = wsRoot(); if (!root) { return; }
		const ign = await axioraIgnore();
		const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], root.fsPath)).split('\n').filter(f => SRC.test(f) && !ign(f) && !f.includes('node_modules')).slice(0, 400);
		const set = new Set(files); const edges: [string, string][] = []; const sizes: Record<string, number> = {};
		for (const f of files) {
			let t = ''; try { t = fs.readFileSync(path.join(root.fsPath, f), 'utf8'); } catch { continue; }
			sizes[f] = (t.match(/^\s*(export\s+)?(async\s+)?(function|class|def|fn|func|interface|type|struct|enum)\b/gm) ?? []).length;
			for (const s of imports(f, t)) { const r = resolve(f, s, set); if (r && r !== f) { edges.push([f, r]); } }
		}
		const p = vscode.window.createWebviewPanel('axiora.codemap', 'Codemap', vscode.ViewColumn.Active, { enableScripts: true });
		p.webview.onDidReceiveMessage(m => m.open && vscode.window.showTextDocument(vscode.Uri.joinPath(root, m.open), { viewColumn: vscode.ViewColumn.Beside }));
		const data = JSON.stringify({ files, edges, sizes });
		p.webview.html = `<!DOCTYPE html><html dir="${htmlDir()}" lang="${htmlLang()}"><head><style>
body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:11px;overflow:auto}
#bar{position:sticky;top:0;padding:6px 10px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border);z-index:2}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:2px 6px}
.g{fill:none;stroke:var(--vscode-panel-border);stroke-dasharray:3 3}.gl{fill:var(--vscode-descriptionForeground);font-weight:bold}
.n rect{fill:var(--vscode-editorWidget-background);stroke:var(--vscode-editorWidget-border,#555);rx:4}.n text{fill:var(--vscode-foreground);pointer-events:none}.n{cursor:pointer}
.n.hi rect{stroke:var(--vscode-focusBorder);stroke-width:2}.n.dep rect{fill:var(--vscode-diffEditor-insertedTextBackground)}.n.use rect{fill:var(--vscode-diffEditor-removedTextBackground)}.n.dim{opacity:.25}
line{stroke:var(--vscode-editorLineNumber-foreground);stroke-opacity:.35}line.hi{stroke:var(--vscode-focusBorder);stroke-opacity:1;stroke-width:1.5}</style></head><body>
<div id="bar"><b>Codemap</b> · <span id="st"></span> · filter <input id="q" placeholder="path or name"> <span style="opacity:.7">hover: green = imports, red = imported by · click opens</span></div><svg id="s"></svg>
<script>const vs=acquireVsCodeApi(),D=${data};const W=190,H=24,GX=24,GY=8;
const groups={};D.files.forEach(f=>{const g=f.includes('/')?f.slice(0,f.lastIndexOf('/')):'.';(groups[g]=groups[g]||[]).push(f)});
const pos={};let x=10,y=0,colH=0,maxW=Math.max(800,innerWidth-20),svg='';const gk=Object.keys(groups).sort();
let cx=10,cy=40,rowH=0;for(const g of gk){const fs=groups[g],h=fs.length*(H+GY)+26;if(cx+W+GX>maxW){cx=10;cy+=rowH+20;rowH=0}
svg+='<rect class="g" x="'+(cx-6)+'" y="'+(cy-18)+'" width="'+(W+12)+'" height="'+h+'"/><text class="gl" x="'+cx+'" y="'+(cy-5)+'">'+g+'/</text>';
fs.forEach((f,i)=>{pos[f]={x:cx,y:cy+i*(H+GY)+4}});rowH=Math.max(rowH,h);cx+=W+GX+12}
const edges=D.edges.map(([a,b],i)=>'<line data-a="'+a+'" data-b="'+b+'" x1="'+(pos[a].x+W)+'" y1="'+(pos[a].y+H/2)+'" x2="'+pos[b].x+'" y2="'+(pos[b].y+H/2)+'"/>').join('');
const nodes=D.files.map(f=>{const p=pos[f],n=f.split('/').pop();return '<g class="n" data-f="'+f+'" transform="translate('+p.x+','+p.y+')"><rect width="'+W+'" height="'+H+'"/><text x="6" y="16">'+n+(D.sizes[f]?'  ·'+D.sizes[f]:'')+'</text></g>'}).join('');
const s=document.getElementById('s');s.setAttribute('width',maxW);s.setAttribute('height',cy+rowH+40);s.innerHTML=svg+edges+nodes;
document.getElementById('st').textContent=D.files.length+' files · '+D.edges.length+' imports';
const all=[...s.querySelectorAll('.n')],ls=[...s.querySelectorAll('line')];
s.addEventListener('mouseover',e=>{const g=e.target.closest('.n');if(!g)return;const f=g.dataset.f;const deps=new Set(D.edges.filter(x=>x[0]===f).map(x=>x[1])),uses=new Set(D.edges.filter(x=>x[1]===f).map(x=>x[0]));
all.forEach(n=>{const k=n.dataset.f;n.classList.toggle('hi',k===f);n.classList.toggle('dep',deps.has(k));n.classList.toggle('use',uses.has(k));n.classList.toggle('dim',k!==f&&!deps.has(k)&&!uses.has(k))});ls.forEach(l=>l.classList.toggle('hi',l.dataset.a===f||l.dataset.b===f))});
s.addEventListener('mouseleave',()=>{all.forEach(n=>n.classList.remove('hi','dep','use','dim'));ls.forEach(l=>l.classList.remove('hi'))});
s.addEventListener('click',e=>{const g=e.target.closest('.n');if(g)vs.postMessage({open:g.dataset.f})});
document.getElementById('q').oninput=e=>{const q=e.target.value.toLowerCase();all.forEach(n=>n.classList.toggle('dim',!!q&&!n.dataset.f.toLowerCase().includes(q)))};</script></body></html>`;
	});
}
