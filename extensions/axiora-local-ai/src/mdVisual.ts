/*---------------------------------------------------------------------------------------------
 *  Visual (WYSIWYG) Markdown editing: "Reopen With → Markdown Visual Editor" or the editor
 *  title button on .md files. Edit formatted text directly (toolbar: headings, bold, italic,
 *  code, link, lists, quote, code block, table); changes are converted back to Markdown and
 *  written to the document (undo/redo, dirty state and Save work as for text). Text and visual
 *  views stay in sync when both are open.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s: string): string {
	return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
}
export function mdToHtml(md: string): string {
	const L = md.replace(/\r/g, '').split('\n'); const out: string[] = []; let i = 0;
	while (i < L.length) {
		const l = L[i];
		if (/^```/.test(l)) { const lang = l.slice(3).trim(); const b: string[] = []; i++; while (i < L.length && !/^```/.test(L[i])) { b.push(L[i++]); } i++; out.push(`<pre data-lang="${esc(lang)}"><code>${esc(b.join('\n'))}</code></pre>`); continue; }
		let m = /^(#{1,6})\s+(.*)$/.exec(l); if (m) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
		if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
		if (/^>\s?/.test(l)) { const b: string[] = []; while (i < L.length && /^>\s?/.test(L[i])) { b.push(L[i++].replace(/^>\s?/, '')); } out.push(`<blockquote>${mdToHtml(b.join('\n'))}</blockquote>`); continue; }
		if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(L[i + 1] ?? '')) { const row = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()); const h = row(l); i += 2; const rows: string[][] = []; while (i < L.length && /^\|.*\|\s*$/.test(L[i])) { rows.push(row(L[i++])); } out.push(`<table><thead><tr>${h.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue; }
		m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
		if (m) { const ordered = /\d/.test(m[2]); const items: string[] = []; while (i < L.length && /^\s*([-*+]|\d+[.)])\s+/.test(L[i])) { const t = L[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''); const c = /^\[( |x)\]\s+(.*)$/.exec(t); items.push(c ? `<li data-task="${c[1] === 'x' ? 'x' : ' '}"><input type="checkbox"${c[1] === 'x' ? ' checked' : ''}> ${inline(c[2])}</li>` : `<li>${inline(t)}</li>`); } out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue; }
		if (!l.trim()) { i++; continue; }
		const p: string[] = []; while (i < L.length && L[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|)/.test(L[i])) { p.push(L[i++]); } out.push(`<p>${inline(p.join('\n')).replace(/\n/g, '<br>')}</p>`);
	}
	return out.join('\n');
}
export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push(vscode.window.registerCustomEditorProvider('axiora.mdVisual', {
		resolveCustomTextEditor(doc, panel) {
			panel.webview.options = { enableScripts: true };
			panel.webview.html = page();
			let selfEdit = false; let lastSent = '';
			const push = () => { if (doc.getText() !== lastSent) { lastSent = doc.getText(); void panel.webview.postMessage({ html: mdToHtml(doc.getText()) }); } };
			const sub = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === doc && !selfEdit) { push(); } });
			panel.onDidDispose(() => sub.dispose());
			panel.webview.onDidReceiveMessage(async m => {
				if (m.ready) { push(); return; }
				if (typeof m.md === 'string' && m.md !== doc.getText()) {
					selfEdit = true; lastSent = m.md;
					const we = new vscode.WorkspaceEdit(); we.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), m.md); await vscode.workspace.applyEdit(we); selfEdit = false;
				}
				if (m.openText) { await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default'); }
			});
		},
	}, { webviewOptions: { retainContextWhenHidden: true } }));
	register(ctx, 'axiora.md.visual', (uri?: vscode.Uri) => { const u = uri ?? vscode.window.activeTextEditor?.document.uri; return u && vscode.commands.executeCommand('vscode.openWith', u, 'axiora.mdVisual'); });
}
function page() {
	return `<!DOCTYPE html><html dir="auto"><head><style>
body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}
#tb{position:sticky;top:0;display:flex;gap:2px;flex-wrap:wrap;padding:4px 8px;background:var(--vscode-editorWidget-background);border-bottom:1px solid var(--vscode-panel-border);z-index:2}
#tb button{background:transparent;color:var(--vscode-foreground);border:1px solid transparent;border-radius:3px;padding:2px 7px;cursor:pointer;font:12px var(--vscode-font-family)}#tb button:hover{background:var(--vscode-toolbar-hoverBackground)}#tb .sp{flex:1}
#ed{max-width:820px;margin:0 auto;padding:16px 32px 80px;outline:none;line-height:1.6;font-size:14px}
#ed pre{background:var(--vscode-textCodeBlock-background);padding:8px 12px;border-radius:4px;font-family:var(--vscode-editor-font-family)}#ed code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:0 3px;border-radius:3px}#ed pre code{background:none;padding:0}
#ed blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);margin:0;padding:0 12px;opacity:.9}#ed table{border-collapse:collapse}#ed td,#ed th{border:1px solid var(--vscode-panel-border);padding:3px 8px}#ed a{color:var(--vscode-textLink-foreground)}#ed li[data-task]{list-style:none;margin-left:-20px}
</style></head><body><div id="tb">
<button data-b="h1" title="Heading 1">H1</button><button data-b="h2">H2</button><button data-b="h3">H3</button><button data-b="p" title="Paragraph">¶</button>
<button data-c="bold" title="Bold (Ctrl+B)"><b>B</b></button><button data-c="italic" title="Italic (Ctrl+I)"><i>I</i></button><button data-c="strikeThrough"><s>S</s></button><button id="code" title="Inline code">&lt;/&gt;</button><button id="link" title="Link">🔗</button>
<button data-c="insertUnorderedList" title="Bullet list">• List</button><button data-c="insertOrderedList">1. List</button><button id="task">☑ Task</button><button data-b="blockquote">❝ Quote</button><button id="pre">Code block</button><button id="table">Table</button><button data-c="insertHorizontalRule">—</button>
<span class="sp"></span><button id="text" title="Open as text">Open as Text</button></div><div id="ed" contenteditable="true"></div>
<script>const vs=acquireVsCodeApi();const E=document.getElementById('ed');let t=null;
const md=n=>{let o='';for(const c of n.childNodes)o+=blk(c);return o.replace(/\\n{3,}/g,'\\n\\n').trim()+'\\n'};
const inl=n=>{if(n.nodeType===3)return n.textContent.replace(/\\u00a0/g,' ');if(n.nodeType!==1)return '';const k=[...n.childNodes].map(inl).join('');switch(n.tagName){case 'STRONG':case 'B':return k.trim()?'**'+k+'**':k;case 'EM':case 'I':return k.trim()?'*'+k+'*':k;case 'DEL':case 'S':case 'STRIKE':return '~~'+k+'~~';case 'CODE':return '\`'+n.textContent+'\`';case 'A':return '['+k+']('+(n.getAttribute('href')||'')+')';case 'IMG':return '!['+(n.alt||'')+']('+n.getAttribute('src')+')';case 'BR':return '\\n';case 'INPUT':return '';default:return k}};
const blk=n=>{if(n.nodeType===3)return n.textContent.trim()?n.textContent.trim()+'\\n\\n':'';if(n.nodeType!==1)return '';const g=n.tagName;
if(/^H[1-6]$/.test(g))return '#'.repeat(+g[1])+' '+inl(n).trim()+'\\n\\n';if(g==='P'||g==='DIV')return inl(n).trim()?inl(n).trim()+'\\n\\n':'';if(g==='HR')return '---\\n\\n';
if(g==='PRE')return '\`\`\`'+(n.dataset.lang||'')+'\\n'+n.textContent.replace(/\\n$/,'')+'\\n\`\`\`\\n\\n';if(g==='BLOCKQUOTE')return md(n).trim().split('\\n').map(l=>'> '+l).join('\\n')+'\\n\\n';
if(g==='UL'||g==='OL'){let i=1;return [...n.children].map(li=>{const cb=li.querySelector('input[type=checkbox]');const m=g==='OL'?(i++)+'.':'-';return m+' '+(cb?'['+(cb.checked?'x':' ')+'] ':'')+inl(li).trim()}).join('\\n')+'\\n\\n'}
if(g==='TABLE'){const rows=[...n.querySelectorAll('tr')].map(r=>[...r.children].map(c=>inl(c).trim().replace(/\\|/g,'\\\\|')));if(!rows.length)return '';return '| '+rows[0].join(' | ')+' |\\n|'+rows[0].map(()=>' --- ').join('|')+'|\\n'+rows.slice(1).map(r=>'| '+r.join(' | ')+' |').join('\\n')+'\\n\\n'}
return inl(n).trim()?inl(n).trim()+'\\n\\n':''};
const send=()=>{clearTimeout(t);t=setTimeout(()=>vs.postMessage({md:md(E)}),250)};
E.addEventListener('input',send);E.addEventListener('change',send);
window.addEventListener('message',e=>{if(e.data.html!==undefined&&document.activeElement!==E){E.innerHTML=e.data.html}else if(e.data.html!==undefined&&!E.innerHTML){E.innerHTML=e.data.html}});
const ex=(c,v)=>{E.focus();document.execCommand(c,false,v);send()};
document.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>ex(b.dataset.c));document.querySelectorAll('[data-b]').forEach(b=>b.onclick=()=>ex('formatBlock',b.dataset.b));
document.getElementById('code').onclick=()=>{const s=getSelection().toString()||'code';ex('insertHTML','<code>'+s.replace(/</g,'&lt;')+'</code>&nbsp;')};
document.getElementById('link').onclick=()=>{const u=prompt?null:null;const s=getSelection().toString()||'link';ex('insertHTML','<a href="https://">'+s.replace(/</g,'&lt;')+'</a>')};
document.getElementById('task').onclick=()=>ex('insertHTML','<ul><li data-task=" "><input type="checkbox"> task</li></ul>');
document.getElementById('pre').onclick=()=>ex('insertHTML','<pre data-lang=""><code>code</code></pre><p><br></p>');
document.getElementById('table').onclick=()=>ex('insertHTML','<table><thead><tr><th>Col 1</th><th>Col 2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><p><br></p>');
document.getElementById('text').onclick=()=>vs.postMessage({openText:1});
E.addEventListener('click',e=>{if(e.target.type==='checkbox'){e.target.toggleAttribute('checked',e.target.checked);send()}});
vs.postMessage({ready:1});</script></body></html>`;
}
