/*---------------------------------------------------------------------------------------------
 *  App kit for generated apps / prototypes:
 *  - Add Backend (SQLite + Auth): writes server.mjs (node:sqlite, scrypt passwords, signed
 *    session cookies, per-user items CRUD) — zero dependencies, runs anywhere Node ≥ 22 runs.
 *  - Publish Folder to Git Remote: init/commit/push a prototype to any remote (GitHub, GitLab,
 *    Bitbucket, your own Gitea…) using your normal git credentials.
 *  - Export Embed: selection/file → self-contained highlighted HTML + <iframe> snippet.
 *  - Publish Data App: CSV → self-contained interactive table/chart app → .axiora/apps/<name>
 *    (deploy it with the one-click deploy target).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register, wsRoot, run } from './util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const SERVER = `// Axiora backend: SQLite + auth, no dependencies (Node >= 22.5). node server.mjs
import http from 'node:http'; import crypto from 'node:crypto'; import { DatabaseSync } from 'node:sqlite'; import fs from 'node:fs';
const db = new DatabaseSync(process.env.DB_FILE || 'app.db');
db.exec('CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, done INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP)');
const SECRET = process.env.SESSION_SECRET || (fs.existsSync('.secret') ? fs.readFileSync('.secret', 'utf8') : (s => (fs.writeFileSync('.secret', s, { mode: 0o600 }), s))(crypto.randomBytes(32).toString('hex')));
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = s => { const i = (s || '').lastIndexOf('.'); if (i < 0) return null; const v = s.slice(0, i); const a = Buffer.from(sign(v)), b = Buffer.from(s); return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null; };
const hash = (p, salt) => crypto.scryptSync(p, salt, 64).toString('hex');
const body = req => new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const user = req => { const c = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x[0])); const id = unsign(decodeURIComponent(c.sid || '')); return id ? db.prepare('SELECT id,email FROM users WHERE id=?').get(+id) : null; };
http.createServer(async (req, res) => {
  const json = (c, o, h = {}) => { res.writeHead(c, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (req.method === 'POST' && (p === '/api/register' || p === '/api/login')) {
    const { email, password } = await body(req); if (!email || !password || password.length < 8) return json(400, { error: 'email and password (8+ chars) required' });
    let row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (p === '/api/register') { if (row) return json(409, { error: 'exists' }); const salt = crypto.randomBytes(16).toString('hex'); db.prepare('INSERT INTO users(email,hash,salt) VALUES(?,?,?)').run(email, hash(password, salt), salt); row = db.prepare('SELECT * FROM users WHERE email=?').get(email); }
    else if (!row || !crypto.timingSafeEqual(Buffer.from(hash(password, row.salt)), Buffer.from(row.hash))) return json(401, { error: 'invalid credentials' });
    return json(200, { id: row.id, email: row.email }, { 'set-cookie': 'sid=' + encodeURIComponent(sign(String(row.id))) + '; HttpOnly; SameSite=Lax; Path=/' });
  }
  if (p === '/api/logout') return json(200, {}, { 'set-cookie': 'sid=; Max-Age=0; Path=/' });
  if (p.startsWith('/api/')) {
    const me = user(req); if (!me) return json(401, { error: 'login required' });
    if (p === '/api/me') return json(200, me);
    if (p === '/api/items' && req.method === 'GET') return json(200, db.prepare('SELECT * FROM items WHERE user_id=? ORDER BY id DESC').all(me.id));
    if (p === '/api/items' && req.method === 'POST') { const b = await body(req); if (!b.title) return json(400, { error: 'title required' }); const r = db.prepare('INSERT INTO items(user_id,title) VALUES(?,?)').run(me.id, String(b.title)); return json(201, db.prepare('SELECT * FROM items WHERE id=?').get(r.lastInsertRowid)); }
    const m = /^\\/api\\/items\\/(\\d+)$/.exec(p);
    if (m && req.method === 'PATCH') { const b = await body(req); db.prepare('UPDATE items SET title=COALESCE(?,title), done=COALESCE(?,done) WHERE id=? AND user_id=?').run(b.title ?? null, b.done == null ? null : +!!b.done, +m[1], me.id); return json(200, db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(+m[1], me.id) ?? {}); }
    if (m && req.method === 'DELETE') { db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(+m[1], me.id); return json(204, {}); }
    return json(404, { error: 'not found' });
  }
  const f = p === '/' ? 'index.html' : p.slice(1).replace(/\\.\\.+/g, '');
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'content-type': { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', svg: 'image/svg+xml' }[f.split('.').pop()] || 'application/octet-stream' }); res.end(d); });
}).listen(+(process.env.PORT || 3000), () => console.log('Backend on http://localhost:' + (process.env.PORT || 3000)));
`;
export function dataApp(name: string, csv: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(name)}</title><style>body{font-family:system-ui;margin:16px;color:#222;background:#fff}h1{font-size:20px}#c{width:100%;height:260px;border:1px solid #ddd;border-radius:6px}table{border-collapse:collapse;margin-top:12px;font-size:13px}td,th{border:1px solid #ddd;padding:4px 8px}th{cursor:pointer;background:#f5f5f5}input,select{padding:4px;margin-right:8px}</style></head><body><h1>${esc(name)}</h1><div><input id=q placeholder="Filter rows…"> Chart <select id=x></select> vs <select id=y></select></div><canvas id=c></canvas><table id=t></table><script>
const raw=${JSON.stringify(csv)};const rows=raw.trim().split(/\\r?\\n/).map(l=>l.split(','));const head=rows.shift();let sortK=-1,asc=true;
const X=document.getElementById('x'),Y=document.getElementById('y');head.forEach((h,i)=>{X.add(new Option(h,i));Y.add(new Option(h,i))});Y.value=Math.min(1,head.length-1);
function view(){const q=document.getElementById('q').value.toLowerCase();let r=rows.filter(x=>x.join(' ').toLowerCase().includes(q));if(sortK>=0)r=[...r].sort((a,b)=>{const u=+a[sortK],v=+b[sortK];const c=isNaN(u)||isNaN(v)?String(a[sortK]).localeCompare(b[sortK]):u-v;return asc?c:-c});return r}
function draw(){const r=view(),t=document.getElementById('t');t.innerHTML='<tr>'+head.map((h,i)=>'<th data-i='+i+'>'+h+(i===sortK?(asc?' ▲':' ▼'):'')+'</th>').join('')+'</tr>'+r.map(x=>'<tr>'+x.map(v=>'<td>'+v.replace(/</g,'&lt;')+'</td>').join('')+'</tr>').join('');t.querySelectorAll('th').forEach(h=>h.onclick=()=>{const i=+h.dataset.i;asc=sortK===i?!asc:true;sortK=i;draw()});
const c=document.getElementById('c'),g=c.getContext('2d');c.width=c.clientWidth;c.height=260;g.clearRect(0,0,c.width,c.height);const yi=+Y.value,xi=+X.value;const vals=r.map(x=>+x[yi]).filter(v=>!isNaN(v));if(!vals.length)return;const mx=Math.max(...vals,0),w=(c.width-40)/vals.length;g.fillStyle='#3b82f6';r.forEach((x,i)=>{const v=+x[yi];if(isNaN(v))return;const h=(c.height-30)*v/(mx||1);g.fillRect(30+i*w+2,c.height-20-h,Math.max(1,w-4),h)});g.fillStyle='#555';g.font='11px system-ui';r.forEach((x,i)=>{if(r.length<=20)g.fillText(String(x[xi]).slice(0,8),30+i*w+2,c.height-6)});g.fillText(String(mx),2,12)}
document.getElementById('q').oninput=draw;X.onchange=draw;Y.onchange=draw;draw();</script></body></html>`;
}
export function embedHtml(file: string, lang: string, code: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(file)}</title><style>body{margin:0;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#1e1e1e;color:#d4d4d4}header{padding:6px 12px;background:#252526;color:#aaa;font-family:system-ui;font-size:12px;display:flex;justify-content:space-between}pre{margin:0;padding:12px;overflow:auto;counter-reset:l}.l{display:block}.l:before{counter-increment:l;content:counter(l);display:inline-block;width:3ch;margin-right:12px;text-align:right;color:#6e7681}.k{color:#569cd6}.s{color:#ce9178}.c{color:#6a9955}.n{color:#b5cea8}</style></head><body><header><span>${esc(file)}</span><span>${esc(lang)} · Axiora</span></header><pre>${code.split('\n').map(l => `<span class="l">${hl(l)}</span>`).join('')}</pre></body></html>`;
}
function hl(line: string): string {
	const tok = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|class|import|from|export|def|async|await|new|try|catch|true|false|null|None|True|False|self|this)\b/g;
	let out = '', last = 0;
	for (const m of line.matchAll(tok)) { out += esc(line.slice(last, m.index)); out += `<span class="${m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : 'k'}">${esc(m[0])}</span>`; last = m.index! + m[0].length; }
	return out + esc(line.slice(last));
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.app.addBackend', async (u?: vscode.Uri) => {
		const r = wsRoot(); if (!r) { return; }
		const dir = u ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: r, openLabel: 'Add backend here' }))?.[0]; if (!dir) { return; }
		const f = vscode.Uri.joinPath(dir, 'server.mjs');
		try { await vscode.workspace.fs.stat(f); if (await vscode.window.showWarningMessage('server.mjs exists. Overwrite?', { modal: true }, 'Overwrite') !== 'Overwrite') { return; } } catch { /* new */ }
		await vscode.workspace.fs.writeFile(f, new TextEncoder().encode(SERVER));
		await vscode.window.showTextDocument(f);
		const t = vscode.window.createTerminal({ name: 'Backend', cwd: dir.fsPath }); t.show(true); t.sendText('node server.mjs');
		vscode.window.showInformationMessage('Backend added: SQLite (app.db) + auth (/api/register, /api/login, /api/me, /api/items). Running on :3000.');
	});
	register(ctx, 'axiora.app.publishGit', async (u?: vscode.Uri) => {
		const r = wsRoot(); if (!r) { return; }
		const dir = u ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.joinPath(r, '.axiora', 'prototypes'), openLabel: 'Publish this folder' }))?.[0]; if (!dir) { return; }
		const remote = await vscode.window.showInputBox({ prompt: 'Git remote URL (GitHub / GitLab / Bitbucket / your own server)', placeHolder: 'git@gitlab.com:you/app.git' }); if (!remote) { return; }
		const branch = await vscode.window.showInputBox({ prompt: 'Branch', value: 'main' }) ?? 'main';
		const d = dir.fsPath;
		const isRepo = await run('git', ['rev-parse', '--show-toplevel'], d).then(t => path.resolve(t.trim()) === path.resolve(d), () => false);
		if (!isRepo) { await run('git', ['init', '-q', '-b', branch], d); }
		await run('git', ['add', '-A'], d);
		await run('git', ['commit', '-qm', `Publish ${path.basename(d)} from Axiora`], d).catch(e => { if (/Author identity unknown|tell me who you are/i.test(String(e.message))) { throw new Error('Git needs your name/email first: git config --global user.name "…" && git config --global user.email "…"'); } if (!/nothing to commit|nothing added/i.test(String(e.message))) { throw e; } });
		await run('git', ['remote', 'remove', 'axiora-publish'], d).catch(() => undefined);
		await run('git', ['remote', 'add', 'axiora-publish', remote], d);
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pushing ${path.basename(d)} → ${remote}` }, () => run('git', ['push', '-u', 'axiora-publish', `HEAD:${branch}`], d));
		vscode.window.showInformationMessage(`Published ${path.basename(d)} to ${remote} (${branch}). Re-run to sync new changes.`);
	});
	register(ctx, 'axiora.app.embed', async () => {
		const ed = vscode.window.activeTextEditor; const r = wsRoot(); if (!ed || !r) { return; }
		const code = ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection);
		const rel = vscode.workspace.asRelativePath(ed.document.uri); const name = `${path.basename(rel).replace(/\W+/g, '-')}-${Date.now().toString(36)}.html`;
		const dir = vscode.Uri.joinPath(r, '.axiora', 'embeds'); await vscode.workspace.fs.createDirectory(dir);
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), new TextEncoder().encode(embedHtml(rel, ed.document.languageId, code)));
		const base = vscode.workspace.getConfiguration('axiora.embed').get<string>('baseUrl', '');
		const snippet = `<iframe src="${base ? base.replace(/\/$/, '') + '/' : ''}${name}" style="width:100%;height:${Math.min(600, 40 + code.split('\n').length * 20)}px;border:0;border-radius:6px" loading="lazy" title="${esc(rel)}"></iframe>`;
		await vscode.env.clipboard.writeText(snippet);
		const a = await vscode.window.showInformationMessage(`Embed saved to .axiora/embeds/${name}; iframe snippet copied.${base ? '' : ' Set axiora.embed.baseUrl to where you host embeds.'}`, 'Preview');
		if (a) { await vscode.commands.executeCommand('axiora.html.preview', vscode.Uri.joinPath(dir, name)).then(undefined, () => vscode.env.openExternal(vscode.Uri.joinPath(dir, name))); }
	});
	register(ctx, 'axiora.app.dataApp', async (u?: vscode.Uri) => {
		const r = wsRoot(); if (!r) { return; }
		const f = u ?? (await vscode.window.showOpenDialog({ filters: { CSV: ['csv'] }, defaultUri: r }))?.[0]; if (!f) { return; }
		const name = path.basename(f.fsPath, '.csv'); const dir = vscode.Uri.joinPath(r, '.axiora', 'apps', name); await vscode.workspace.fs.createDirectory(dir);
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'index.html'), new TextEncoder().encode(dataApp(name, new TextDecoder().decode(await vscode.workspace.fs.readFile(f)))));
		const a = await vscode.window.showInformationMessage(`Data app built: .axiora/apps/${name}/index.html`, 'Preview', 'Deploy');
		if (a === 'Preview') { await vscode.commands.executeCommand('axiora.html.preview', vscode.Uri.joinPath(dir, 'index.html')).then(undefined, () => undefined); }
		if (a === 'Deploy') { await vscode.commands.executeCommand('axiora.deploy.upload', vscode.Uri.joinPath(dir, 'index.html')); }
	});
}
