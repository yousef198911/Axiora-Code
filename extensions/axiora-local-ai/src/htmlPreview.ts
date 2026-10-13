/*---------------------------------------------------------------------------------------------
 *  Live HTML preview beside the editor (updates while typing; local CSS/JS/images resolved).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.html.preview', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document; if (!doc) { return; }
		const dir = vscode.Uri.file(path.dirname(doc.uri.fsPath));
		const roots = [dir, ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [])];
		const panel = vscode.window.createWebviewPanel('axiora.htmlPreview', `Preview: ${path.basename(doc.fileName)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: roots });
		const render = () => {
			const base = panel.webview.asWebviewUri(dir).toString() + '/';
			let html = doc.getText();
			html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`) : `<base href="${base}">${html}`;
			const picker = `<script>(()=>{const vs=acquireVsCodeApi();let on=false,last;const b=document.createElement('button');b.textContent='⌖ Pick element';b.title='Pick an element and send it to @axiora';b.style.cssText='position:fixed;top:6px;right:6px;z-index:2147483647;font:12px system-ui;padding:3px 8px;border-radius:4px;border:1px solid #888;background:#1e1e1e;color:#fff;opacity:.75;cursor:pointer';
const sel=e=>{const p=[];for(;e&&e.nodeType===1&&e!==document.body;e=e.parentElement){let s=e.tagName.toLowerCase();if(e.id){p.unshift(s+'#'+e.id);break}const c=[...e.classList].slice(0,2).join('.');if(c)s+='.'+c;const sib=[...(e.parentElement?.children||[])].filter(x=>x.tagName===e.tagName);if(sib.length>1)s+=':nth-of-type('+(sib.indexOf(e)+1)+')';p.unshift(s)}return p.join(' > ')};
const off=()=>{on=false;b.style.opacity='.75';if(last)last.style.outline=last._o||''};
b.onclick=e=>{e.stopPropagation();on=!on;b.style.opacity=on?'1':'.75'};
document.addEventListener('mouseover',e=>{if(!on||e.target===b)return;if(last)last.style.outline=last._o||'';last=e.target;last._o=last.style.outline;last.style.outline='2px solid #3794ff'},true);
document.addEventListener('click',e=>{if(!on||e.target===b)return;e.preventDefault();e.stopPropagation();const t=e.target;off();vs.postMessage({pick:{selector:sel(t),html:t.outerHTML.replace(/ style=""/,'').slice(0,3000),text:(t.innerText||'').slice(0,200)}})},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')off()});document.documentElement.appendChild(b)})()</script>`;
			html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, picker + '</body>') : html + picker;
			panel.webview.html = html;
		};
		render();
		panel.webview.onDidReceiveMessage(async (m: { pick?: { selector: string; html: string; text: string } }) => {
			if (!m.pick) { return; }
			// reveal the element in the source: match its opening tag
			const open = /^<[^>]+>/.exec(m.pick.html)?.[0] ?? ''; const idx = open ? doc.getText().indexOf(open) : -1;
			if (idx >= 0) { const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true }); const p = doc.positionAt(idx); ed.selection = new vscode.Selection(p, doc.positionAt(idx + open.length)); ed.revealRange(ed.selection, vscode.TextEditorRevealType.InCenter); }
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora In ${vscode.workspace.asRelativePath(doc.uri)}, change this element (${m.pick.selector}${idx >= 0 ? `, line ${doc.positionAt(idx).line + 1}` : ''}):\n\`\`\`html\n${m.pick.html}\n\`\`\`\n`, isPartialQuery: true });
		});
		let t: ReturnType<typeof setTimeout> | undefined;
		const subs = [
			vscode.workspace.onDidChangeTextDocument(e => { if (e.document === doc) { clearTimeout(t); t = setTimeout(render, 300); } }),
			vscode.workspace.onDidSaveTextDocument(d => { if (d.uri.fsPath.startsWith(dir.fsPath)) { render(); } }), // css/js saved
		];
		panel.onDidDispose(() => subs.forEach(s => s.dispose()));
	});
}
