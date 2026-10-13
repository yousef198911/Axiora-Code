/*---------------------------------------------------------------------------------------------
 *  Hex editor for binary files (and very large files, paged): offset / hex / ASCII columns,
 *  click a byte to edit it, Ctrl+S writes back. Opens via "Reopen Editor With… → Hex Editor".
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';

const PAGE = 64 * 1024;
class HexDoc implements vscode.CustomDocument {
	edits = new Map<number, number>();
	constructor(readonly uri: vscode.Uri, readonly size: number) { }
	dispose() { /* nothing */ }
}
export function activate(ctx: vscode.ExtensionContext) {
	const changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<HexDoc>>();
	const provider: vscode.CustomEditorProvider<HexDoc> = {
		onDidChangeCustomDocument: changed.event,
		openCustomDocument: uri => new HexDoc(uri, fs.statSync(uri.fsPath).size),
		resolveCustomEditor: (doc, panel) => {
			panel.webview.options = { enableScripts: true };
			const page = (n: number) => {
				const fd = fs.openSync(doc.uri.fsPath, 'r'); const buf = Buffer.alloc(Math.min(PAGE, Math.max(0, doc.size - n * PAGE)));
				fs.readSync(fd, buf, 0, buf.length, n * PAGE); fs.closeSync(fd);
				for (const [o, v] of doc.edits) { if (o >= n * PAGE && o < n * PAGE + buf.length) { buf[o - n * PAGE] = v; } }
				return buf;
			};
			const send = (n: number) => panel.webview.postMessage({ page: n, pages: Math.max(1, Math.ceil(doc.size / PAGE)), size: doc.size, data: Array.from(page(n)), edits: [...doc.edits.keys()] });
			panel.webview.onDidReceiveMessage(m => {
				if (m.go !== undefined) { send(m.go); }
				if (m.set) { const prev = doc.edits.get(m.set.o); doc.edits.set(m.set.o, m.set.v); changed.fire({ document: doc, label: 'Edit byte', undo: () => { if (prev === undefined) { doc.edits.delete(m.set.o); } else { doc.edits.set(m.set.o, prev); } send(Math.floor(m.set.o / PAGE)); }, redo: () => { doc.edits.set(m.set.o, m.set.v); send(Math.floor(m.set.o / PAGE)); } }); }
			});
			panel.webview.html = `<!DOCTYPE html><html><head><style>
body{font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);color:var(--vscode-editor-foreground);padding:6px}
.r{white-space:pre;line-height:1.5}.o{color:var(--vscode-editorLineNumber-foreground)}.b{cursor:pointer;padding:0 1px}.b:hover{background:var(--vscode-editor-hoverHighlightBackground)}
.e{color:var(--vscode-gitDecoration-modifiedResourceForeground);font-weight:bold}.a{color:var(--vscode-descriptionForeground)}#bar{margin-bottom:6px;display:flex;gap:8px;align-items:center}
button,input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}</style></head><body>
<div id="bar"><button id="p">◀</button><span id="info"></span><button id="n">▶</button> Go to offset <input id="g" size="10" placeholder="0x0"></div><div id="v"></div>
<script>const vs=acquireVsCodeApi();let st;const h=(x,w)=>x.toString(16).padStart(w,'0');
window.addEventListener('message',e=>{st=e.data;const ed=new Set(st.edits),base=st.page*65536;let out='';
for(let i=0;i<st.data.length;i+=16){const row=st.data.slice(i,i+16);out+='<div class="r"><span class="o">'+h(base+i,8)+'</span>  '+row.map((b,j)=>'<span class="b'+(ed.has(base+i+j)?' e':'')+'" data-o="'+(base+i+j)+'">'+h(b,2)+'</span>').join(' ')+'   '.repeat(16-row.length)+'  <span class="a">'+row.map(b=>b>31&&b<127?String.fromCharCode(b).replace('&','&amp;').replace('<','&lt;'):'.').join('')+'</span></div>'}
document.getElementById('v').innerHTML=out;document.getElementById('info').textContent='page '+(st.page+1)+'/'+st.pages+' · '+st.size+' bytes'});
document.getElementById('v').onclick=e=>{const t=e.target,o=t.dataset.o;if(o===undefined||t.querySelector('input'))return;const old=t.textContent;t.innerHTML='<input size=2 maxlength=2 value="'+old+'">';const i=t.firstChild;i.focus();i.select();
const done=ok=>{const v=i.value;if(ok&&/^[0-9a-f]{1,2}$/i.test(v)){vs.postMessage({set:{o:+o,v:parseInt(v,16)}});t.textContent=h(parseInt(v,16),2);t.classList.add('e')}else{t.textContent=old}};
i.onkeydown=k=>{if(k.key==='Enter')done(true);if(k.key==='Escape')done(false)};i.onblur=()=>done(true)};
document.getElementById('p').onclick=()=>st.page>0&&vs.postMessage({go:st.page-1});document.getElementById('n').onclick=()=>st.page<st.pages-1&&vs.postMessage({go:st.page+1});
document.getElementById('g').onchange=e=>{const o=parseInt(e.target.value);if(!isNaN(o))vs.postMessage({go:Math.floor(o/65536)})};</script></body></html>`;
			send(0);
		},
		saveCustomDocument: async doc => { const fd = fs.openSync(doc.uri.fsPath, 'r+'); for (const [o, v] of doc.edits) { fs.writeSync(fd, Buffer.from([v]), 0, 1, o); } fs.closeSync(fd); doc.edits.clear(); },
		saveCustomDocumentAs: async (doc, dest) => { fs.copyFileSync(doc.uri.fsPath, dest.fsPath); const fd = fs.openSync(dest.fsPath, 'r+'); for (const [o, v] of doc.edits) { fs.writeSync(fd, Buffer.from([v]), 0, 1, o); } fs.closeSync(fd); },
		revertCustomDocument: async doc => { doc.edits.clear(); },
		backupCustomDocument: async (_doc, c) => ({ id: c.destination.toString(), delete: () => undefined }),
	};
	ctx.subscriptions.push(vscode.window.registerCustomEditorProvider('axiora.hexEditor', provider, { supportsMultipleEditorsPerDocument: false }));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.hex.open', (u?: vscode.Uri) => { const t = u ?? vscode.window.activeTextEditor?.document.uri; if (t) { vscode.commands.executeCommand('vscode.openWith', t, 'axiora.hexEditor'); } }));
}
