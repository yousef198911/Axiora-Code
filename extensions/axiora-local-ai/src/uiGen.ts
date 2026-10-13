/*---------------------------------------------------------------------------------------------
 *  UI generation & design:
 *  - "@axiora /prototype <app description>": app-prototyping agent → a runnable single-file
 *    HTML/CSS/JS app in .axiora/prototypes/<name>/index.html, opened in Live Preview; follow up
 *    with "/prototype refine: <change>" to iterate on the last prototype.
 *  - "Generate UI from Screenshot..." (Explorer right-click on .png/.jpg, or Palette): sends the
 *    image to a vision model (axiora.ai.visionModel) and writes matching HTML/CSS.
 *  - Visual Designer (Explorer right-click on .html → "Open in Visual Designer"): drag-and-drop
 *    palette (heading, text, button, input, image, card, columns, list, link), select + edit
 *    text/styles, reorder, delete; Save writes the <body> back to the file.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { chatCommands, register, wsRoot, SYS, unfence, withProgress } from './util';
import { chat } from './llm';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'app';
const UI_SYS = `${SYS}\nYou are a senior front-end engineer and designer. Output ONE complete, self-contained index.html (inline <style> and <script>, no external assets or CDNs), modern responsive design, accessible, working interactivity with sample data. Output only the HTML.`;
export function extractHtml(s: string): string { const u = unfence(s.trim()); const m = /<!DOCTYPE html>[\s\S]*<\/html>/i.exec(u) ?? /<html[\s\S]*<\/html>/i.exec(u); return m ? m[0] : u.includes('<') ? `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${u}\n</body></html>` : `<!DOCTYPE html>\n<html><body><pre>${u.replace(/</g, '&lt;')}</pre></body></html>`; }
async function writeApp(name: string, html: string) {
	const d = vscode.Uri.joinPath(wsRoot()!, '.axiora', 'prototypes', name); await vscode.workspace.fs.createDirectory(d);
	const u = vscode.Uri.joinPath(d, 'index.html'); await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(html)); return u;
}
export function activate(ctx: vscode.ExtensionContext) {
	chatCommands.set('prototype', async (req, stream, token) => {
		if (!wsRoot()) { stream.markdown('Open a folder first.'); return; }
		const last = ctx.workspaceState.get<string>('axiora.proto.last');
		const refine = /^refine:\s*([\s\S]+)/i.exec(req.prompt.trim());
		if (refine && !last) { stream.markdown('No prototype yet — describe an app first.'); return; }
		const name = refine ? last! : `${slug(req.prompt)}`;
		const prev = refine ? fs.readFileSync(path.join(wsRoot()!.fsPath, '.axiora', 'prototypes', name, 'index.html'), 'utf8') : '';
		stream.progress(refine ? 'Refining the prototype…' : 'Building the prototype…');
		const out = await chat([{ role: 'system', content: UI_SYS }, { role: 'user', content: refine ? `Current app:\n${prev}\n\nChange: ${refine[1]}\nReturn the full updated index.html.` : `Build this app: ${req.prompt}` }], () => undefined, token);
		const u = await writeApp(name, extractHtml(out)); await ctx.workspaceState.update('axiora.proto.last', name);
		stream.markdown(`Prototype **${name}** ${refine ? 'updated' : 'created'}: `); stream.anchor(u, vscode.workspace.asRelativePath(u));
		stream.markdown('\n\nIterate with `/prototype refine: <change>`.');
		stream.button({ command: 'axiora.html.preview', title: 'Open Live Preview', arguments: [u] });
		await vscode.commands.executeCommand('axiora.html.preview', u).then(undefined, () => undefined);
	});
	register(ctx, 'axiora.ui.fromImage', async (uri?: vscode.Uri) => {
		const img = uri ?? (await vscode.window.showOpenDialog({ filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] } }))?.[0]; if (!img || !wsRoot()) { return; }
		const model = vscode.workspace.getConfiguration('axiora.ai').get<string>('visionModel', '') || undefined;
		const b64 = Buffer.from(await vscode.workspace.fs.readFile(img)).toString('base64');
		const html = await withProgress('Generating UI from screenshot…', t => chat([{ role: 'system', content: UI_SYS }, { role: 'user', content: 'Recreate this screenshot as a pixel-faithful, responsive web page: same layout, colors, typography, spacing and text. Use semantic HTML.', images: [b64] }], () => undefined, t, model));
		const u = await writeApp(`from-${slug(path.basename(img.path, path.extname(img.path)))}`, extractHtml(html));
		await vscode.window.showTextDocument(u, { viewColumn: vscode.ViewColumn.One }); await vscode.commands.executeCommand('axiora.html.preview', u).then(undefined, () => undefined);
	});
	register(ctx, 'axiora.ui.designer', async (uri?: vscode.Uri) => {
		const u = uri ?? vscode.window.activeTextEditor?.document.uri; if (!u || !/\.html?$/.test(u.path)) { vscode.window.showInformationMessage('Open or select an .html file.'); return; }
		const src = new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
		const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(src)?.[1] ?? '';
		const head = /<head[^>]*>([\s\S]*)<\/head>/i.exec(src)?.[1] ?? '';
		const p = vscode.window.createWebviewPanel('axiora.designer', `Design: ${path.basename(u.path)}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(u, '..'), ...(wsRoot() ? [wsRoot()!] : [])] });
		const base = `<base href="${p.webview.asWebviewUri(vscode.Uri.joinPath(u, '..'))}/">`;
		p.webview.html = designerHtml(base + head.replace(/<script[\s\S]*?<\/script>/gi, ''), body);
		p.webview.onDidReceiveMessage(async m => {
			if (m.save !== undefined) {
				const cur = new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
				const next = /<body[^>]*>[\s\S]*<\/body>/i.test(cur) ? cur.replace(/(<body[^>]*>)[\s\S]*(<\/body>)/i, (_a, o, c) => `${o}\n${m.save}\n${c}`) : `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n${m.save}\n</body></html>`;
				await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(next)); vscode.window.setStatusBarMessage(`Saved ${path.basename(u.path)}`, 2500);
			}
		});
	});
}
function designerHtml(head: string, body: string) {
	const items: [string, string][] = [['Heading', '<h2>Heading</h2>'], ['Text', '<p>Some text</p>'], ['Button', '<button>Button</button>'], ['Input', '<input placeholder="Type here">'], ['Image', '<img src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27120%27%3E%3Crect width=%27100%25%27 height=%27100%25%27 fill=%27%23ccc%27/%3E%3C/svg%3E" alt="" style="max-width:100%">'], ['Link', '<a href="#">Link</a>'], ['List', '<ul><li>Item one</li><li>Item two</li></ul>'], ['Card', '<div style="padding:16px;border:1px solid #ddd;border-radius:8px;margin:8px 0"><h3>Card</h3><p>Card text</p></div>'], ['Columns', '<div style="display:flex;gap:16px"><div style="flex:1;min-height:40px;padding:8px">Column</div><div style="flex:1;min-height:40px;padding:8px">Column</div></div>'], ['Section', '<section style="padding:24px"><h2>Section</h2></section>']];
	return `<!DOCTYPE html><html><head>${head}<style>
html,body{margin:0;height:100%}#ui{display:flex;height:100vh;font:12px var(--vscode-font-family);color:var(--vscode-foreground)}
#pal,#props{width:170px;background:var(--vscode-sideBar-background);padding:8px;overflow:auto;border-right:1px solid var(--vscode-panel-border)}#props{width:220px;border-left:1px solid var(--vscode-panel-border);border-right:0}
#pal div{padding:6px 8px;margin:3px 0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:grab;border-radius:3px}
#wrap{flex:1;overflow:auto;background:#e9e9ec;padding:16px}#canvas{background:#fff;color:#111;min-height:90%;padding:12px;font:14px system-ui}
#canvas .sel{outline:2px solid #0a84ff!important;outline-offset:1px}#canvas .drop{box-shadow:0 -3px 0 #0a84ff}
h4{margin:6px 0;font-weight:600;opacity:.8}label{display:block;margin-top:6px;opacity:.8}#props input,#props textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}
button.t{margin:4px 2px 0 0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 8px;cursor:pointer}
</style></head><body><div id="ui"><div id="pal"><h4>Elements</h4>${items.map(([n, h]) => `<div draggable="true" data-h="${h.replace(/"/g, '&quot;')}">${n}</div>`).join('')}<p style="opacity:.7">Drag onto the page, or click to add after the selection.</p></div>
<div id="wrap"><div id="canvas">${body}</div></div>
<div id="props"><h4>Properties</h4><div id="none" style="opacity:.7">Select an element.</div><div id="ed" style="display:none"><div id="tag" style="font-family:monospace"></div><label>Text</label><textarea id="text" rows="3"></textarea><label>Color</label><input id="color" placeholder="#333"><label>Background</label><input id="bg" placeholder="#fff"><label>Padding</label><input id="pad" placeholder="8px"><label>Width</label><input id="w" placeholder="auto"><label>Font size</label><input id="fs" placeholder="14px"><label>Style (raw)</label><textarea id="style" rows="3"></textarea>
<button class="t" id="up">▲</button><button class="t" id="down">▼</button><button class="t" id="dup">Duplicate</button><button class="t" id="del">Delete</button><button class="t" id="parent">Parent</button></div><hr><button class="t" id="save">💾 Save to file</button></div></div>
<script>const vs=acquireVsCodeApi();const C=document.getElementById('canvas');let sel=null;const $=i=>document.getElementById(i);
C.querySelectorAll('script').forEach(s=>s.remove());
function pick(el){if(sel)sel.classList.remove('sel');sel=el&&el!==C?el:null;$('none').style.display=sel?'none':'';$('ed').style.display=sel?'':'none';if(!sel)return;sel.classList.add('sel');$('tag').textContent='<'+sel.tagName.toLowerCase()+'>';
$('text').value=sel.children.length?'':sel.textContent;$('text').disabled=!!sel.children.length;$('color').value=sel.style.color;$('bg').value=sel.style.background;$('pad').value=sel.style.padding;$('w').value=sel.style.width;$('fs').value=sel.style.fontSize;$('style').value=sel.getAttribute('style')||''}
C.addEventListener('click',e=>{e.preventDefault();pick(e.target)},true);
const bind=(id,f)=>$(id).addEventListener('input',()=>{if(sel){f($(id).value);$('style').value=sel.getAttribute('style')||''}});
bind('text',v=>sel.textContent=v);bind('color',v=>sel.style.color=v);bind('bg',v=>sel.style.background=v);bind('pad',v=>sel.style.padding=v);bind('w',v=>sel.style.width=v);bind('fs',v=>sel.style.fontSize=v);$('style').addEventListener('input',()=>sel&&sel.setAttribute('style',$('style').value));
$('del').onclick=()=>{if(sel){const s=sel;pick(null);s.remove()}};$('dup').onclick=()=>{if(sel){const c=sel.cloneNode(true);c.classList.remove('sel');sel.after(c);pick(c)}};$('up').onclick=()=>{if(sel&&sel.previousElementSibling)sel.previousElementSibling.before(sel)};$('down').onclick=()=>{if(sel&&sel.nextElementSibling)sel.nextElementSibling.after(sel)};$('parent').onclick=()=>{if(sel)pick(sel.parentElement)};
const make=h=>{const t=document.createElement('template');t.innerHTML=h;return t.content.firstElementChild};
document.querySelectorAll('#pal [data-h]').forEach(d=>{d.addEventListener('dragstart',e=>e.dataTransfer.setData('text/x-h',d.dataset.h));d.onclick=()=>{const el=make(d.dataset.h);if(sel&&sel.parentElement)sel.after(el);else C.appendChild(el);pick(el)}});
let over=null;C.addEventListener('dragover',e=>{e.preventDefault();if(over)over.classList.remove('drop');over=e.target!==C?e.target:null;if(over)over.classList.add('drop')});
C.addEventListener('drop',e=>{e.preventDefault();const h=e.dataTransfer.getData('text/x-h');if(over)over.classList.remove('drop');if(!h)return;const el=make(h);const t=e.target;if(t===C)C.appendChild(el);else if(/^(DIV|SECTION|MAIN|ARTICLE|ASIDE|HEADER|FOOTER|NAV)$/.test(t.tagName)&&!t.textContent.trim().length||(e.altKey))t.appendChild(el);else t.before(el);pick(el)});
document.addEventListener('keydown',e=>{if((e.key==='Delete')&&sel&&document.activeElement===document.body){$('del').click()}if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();$('save').click()}});
$('save').onclick=()=>{const c=C.cloneNode(true);c.querySelectorAll('.sel,.drop').forEach(x=>x.classList.remove('sel','drop'));c.querySelectorAll('[class=""]').forEach(x=>x.removeAttribute('class'));vs.postMessage({save:c.innerHTML.trim()})};</script></body></html>`;
}
