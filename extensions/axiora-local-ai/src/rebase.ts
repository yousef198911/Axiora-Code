/*---------------------------------------------------------------------------------------------
 *  Visual interactive rebase: pick a base commit, reorder commits by drag & drop, choose
 *  pick / reword / squash / fixup / drop per commit, then run git rebase -i non-interactively.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register, run, wsRoot } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.git.interactiveRebase', async () => {
		const root = wsRoot()?.fsPath; if (!root) { return; }
		const log = (await run('git', ['log', '--format=%h%x09%s%x09%an%x09%ar', '-n', '30'], root)).trim().split('\n');
		const base = await vscode.window.showQuickPick(log.slice(1).map(l => { const [h, s, a, r] = l.split('\t'); return { label: `$(git-commit) ${h}`, description: s, detail: `${a} · ${r}`, h }; }), { placeHolder: 'Rebase commits after which commit? (the base stays unchanged)' });
		if (!base) { return; }
		const commits = (await run('git', ['log', '--reverse', '--format=%h%x09%s', `${base.h}..HEAD`], root)).trim().split('\n').filter(Boolean).map(l => { const [h, s] = l.split('\t'); return { h, s }; });
		const p = vscode.window.createWebviewPanel('axiora.rebase', `Interactive Rebase onto ${base.h}`, vscode.ViewColumn.Active, { enableScripts: true });
		const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
		p.webview.html = `<!DOCTYPE html><html><head><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:13px;padding:12px}
li{list-style:none;display:flex;gap:8px;align-items:center;padding:6px 8px;margin:3px 0;border:1px solid var(--vscode-panel-border);border-radius:4px;cursor:grab;background:var(--vscode-editor-background)}
li.drop{opacity:.45;text-decoration:line-through}li.dragging{opacity:.4}code{color:var(--vscode-textLink-foreground)}
select,input,button{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:3px}
input{flex:1}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:5px 14px;cursor:pointer;border:0}ul{padding:0}
</style></head><body><p>Drag to reorder (oldest at top). Choose an action for each commit.</p><ul id="l">${commits.map(c => `<li draggable="true" data-h="${c.h}"><span>⋮⋮</span><select><option>pick</option><option>reword</option><option>squash</option><option>fixup</option><option>drop</option></select><code>${c.h}</code><input value="${esc(c.s)}" disabled></li>`).join('')}</ul>
<button id="go">Start Rebase</button> <button id="cancel" style="background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)">Cancel</button>
<script>const vs=acquireVsCodeApi(),l=document.getElementById('l');let d;
l.addEventListener('dragstart',e=>{d=e.target.closest('li');d.classList.add('dragging')});l.addEventListener('dragend',()=>d.classList.remove('dragging'));
l.addEventListener('dragover',e=>{e.preventDefault();const t=e.target.closest('li');if(t&&t!==d){const r=t.getBoundingClientRect();l.insertBefore(d,e.clientY<r.top+r.height/2?t:t.nextSibling)}});
l.addEventListener('change',e=>{const li=e.target.closest('li'),v=e.target.value;li.classList.toggle('drop',v==='drop');li.querySelector('input').disabled=v!=='reword'});
document.getElementById('go').onclick=()=>vs.postMessage({todo:[...l.children].map(li=>({a:li.querySelector('select').value,h:li.dataset.h,m:li.querySelector('input').value}))});
document.getElementById('cancel').onclick=()=>vs.postMessage({cancel:1});</script></body></html>`;
		p.webview.onDidReceiveMessage(async (msg: { cancel?: number; todo?: { a: string; h: string; m: string }[] }) => {
			if (msg.cancel || !msg.todo) { p.dispose(); return; }
			if ((await run('git', ['status', '--porcelain', '--untracked-files=no'], root)).trim()) { vscode.window.showErrorMessage('Commit or stash your changes before rebasing.'); return; }
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiora-rebase-'));
			const lines: string[] = [];
			for (const t of msg.todo) {
				if (t.a === 'reword') { lines.push(`pick ${t.h}`); const mf = path.join(dir, `${t.h}.msg`); fs.writeFileSync(mf, t.m + '\n'); lines.push(`exec git commit --amend -q -F "${mf}"`); }
				else { lines.push(`${t.a} ${t.h}`); }
			}
			const todo = path.join(dir, 'todo'); fs.writeFileSync(todo, lines.join('\n') + '\n');
			cp.execFile('git', ['-c', 'core.editor=true', 'rebase', '-i', base.h], { cwd: root, env: { ...process.env, GIT_SEQUENCE_EDITOR: `cp "${todo}"`, GIT_EDITOR: 'true' } }, async (err: Error | null, _o: string, se: string) => {
				if (err) {
					const a = await vscode.window.showErrorMessage(`Rebase stopped: ${se.split('\n').find(Boolean) ?? err.message}`, 'Abort Rebase', 'Resolve Conflicts');
					if (a === 'Abort Rebase') { await run('git', ['rebase', '--abort'], root).catch(() => undefined); } else if (a) { vscode.commands.executeCommand('workbench.view.scm'); }
				} else { vscode.window.showInformationMessage(`Rebase complete (${msg.todo!.length} commits).`); p.dispose(); }
			});
		});
	});
}
