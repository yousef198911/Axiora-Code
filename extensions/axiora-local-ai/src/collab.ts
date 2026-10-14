/*---------------------------------------------------------------------------------------------
 *  Live collaboration over the self-hosted relay (bin/axiora-relay.mjs). Both peers open the
 *  same repository checkout; edits, saves-on-open and cursors of every workspace text file are
 *  exchanged end-to-end encrypted (AES-256-GCM, key only in the invite link fragment).
 *  Host: "Collaboration: Start Session" → invite link copied. Guest: "Collaboration: Join...".
 *  Status bar shows peers; "Collaboration: Leave" ends it. Conflicts: last writer per range
 *  wins; on join the guest receives the host's full text of every open file.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { register, wsRoot } from './util';

interface Session { relay: string; room: string; key: Buffer; peer: string; req?: http.ClientRequest; peers: Set<string>; subs: vscode.Disposable[]; applying: number; deco: vscode.TextEditorDecorationType; cursors: Map<string, { file: string; line: number; ch: number }> }
let s: Session | undefined; let item: vscode.StatusBarItem;
const enc = (key: Buffer, o: unknown) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const b = Buffer.concat([c.update(JSON.stringify(o)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64'); };
const dec = (key: Buffer, d: string) => { const b = Buffer.from(d, 'base64'); const c = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([c.update(b.subarray(28)), c.final()]).toString()); };
const rel = (u: vscode.Uri) => { const r = wsRoot(); return r && u.scheme === 'file' && u.fsPath.startsWith(r.fsPath) ? vscode.workspace.asRelativePath(u, false) : undefined; };
const abs = (f: string) => vscode.Uri.joinPath(wsRoot()!, f);
async function send(o: unknown) { if (!s) { return; } await fetch(`${s.relay}/r/${s.room}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ peer: s.peer, data: enc(s.key, o) }) }).catch(() => undefined); }
function status() { if (!s) { item.hide(); return; } item.text = vscode.l10n.t("$(live-share) {0} peer{1}", s.peers.size, s.peers.size === 1 ? '' : 's'); item.tooltip = vscode.l10n.t("Collaboration session — click for options"); item.show(); }
async function onMsg(m: any) {
	if (!s) { return; }
	if (m.t === 'edit' || m.t === 'full') {
		const uri = abs(m.f); const doc = await vscode.workspace.openTextDocument(uri).then(d => d, () => undefined); if (!doc) { return; }
		const we = new vscode.WorkspaceEdit();
		if (m.t === 'full') { if (doc.getText() === m.text) { return; } we.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), m.text); }
		else { for (const c of m.c) { we.replace(uri, new vscode.Range(c[0], c[1], c[2], c[3]), c[4]); } }
		s.applying++; try { await vscode.workspace.applyEdit(we); } finally { s.applying--; }
	}
	if (m.t === 'cursor') { s.cursors.set(m.p, m); paintCursors(); }
	if (m.t === 'need') { for (const d of vscode.workspace.textDocuments) { const f = rel(d.uri); if (f) { await send({ t: 'full', f, text: d.getText() }); } } }
}
function paintCursors() { if (!s) { return; } for (const e of vscode.window.visibleTextEditors) { const f = rel(e.document.uri); e.setDecorations(s.deco, [...s.cursors.entries()].filter(([, c]) => c.file === f).map(([p, c]) => ({ range: new vscode.Range(c.line, c.ch, c.line, c.ch), hoverMessage: `Peer ${p.slice(0, 6)}` }))); } }
function listen() {
	if (!s) { return; } const sess = s; const url = new URL(`${sess.relay}/r/${sess.room}/events?peer=${sess.peer}`);
	sess.req = (url.protocol === 'https:' ? https : http).get(url, res => {
		let buf = ''; res.setEncoding('utf8');
		res.on('data', (d: string) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (\w+)/m.exec(block)?.[1] ?? 'message'; const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n'); if (!data) { continue; } const j = JSON.parse(data);
			if (ev === 'hello') { j.peers.forEach((p: string) => sess.peers.add(p)); if (j.peers.length) { void send({ t: 'need' }); } }
			else if (ev === 'join') { sess.peers.add(j.peer); vscode.window.setStatusBarMessage(vscode.l10n.t("$(person-add) A peer joined the session"), 4000); }
			else if (ev === 'leave') { sess.peers.delete(j.peer); sess.cursors.delete(j.peer); paintCursors(); }
			else { try { void onMsg({ ...dec(sess.key, j.data), p: j.peer }); } catch { /* wrong key */ } }
			status(); } });
		res.on('end', () => { if (s === sess) { setTimeout(listen, 2000); } });
	}); sess.req.on('error', () => { if (s === sess) { setTimeout(listen, 3000); } });
}
function start(relay: string, room: string, key: Buffer) {
	stop();
	s = { relay: relay.replace(/\/$/, ''), room, key, peer: crypto.randomBytes(6).toString('hex'), peers: new Set(), subs: [], applying: 0, cursors: new Map(), deco: vscode.window.createTextEditorDecorationType({ borderColor: '#f59e0b', borderStyle: 'solid', borderWidth: '0 0 0 2px' }) };
	s.subs.push(vscode.workspace.onDidChangeTextDocument(e => { const f = rel(e.document.uri); if (!s || s.applying || !f || !e.contentChanges.length) { return; } void send({ t: 'edit', f, c: e.contentChanges.map(c => [c.range.start.line, c.range.start.character, c.range.end.line, c.range.end.character, c.text]) }); }));
	s.subs.push(vscode.window.onDidChangeTextEditorSelection(e => { const f = rel(e.textEditor.document.uri); if (f) { const p = e.selections[0].active; void send({ t: 'cursor', file: f, line: p.line, ch: p.character }); } }));
	s.subs.push(vscode.window.onDidChangeVisibleTextEditors(paintCursors));
	listen(); status();
}
function stop() { if (!s) { return; } s.req?.destroy(); s.subs.forEach(d => d.dispose()); s.deco.dispose(); s = undefined; status(); }
export function activate(ctx: vscode.ExtensionContext) {
	item = vscode.window.createStatusBarItem('axiora.collab', vscode.StatusBarAlignment.Left, 50); item.name = 'Collaboration'; item.command = 'axiora.collab.menu'; ctx.subscriptions.push(item, { dispose: stop });
	register(ctx, 'axiora.collab.start', async () => {
		const relay = vscode.workspace.getConfiguration('axiora.collab').get<string>('relayUrl', 'http://127.0.0.1:7790');
		const room = crypto.randomBytes(9).toString('base64url'), key = crypto.randomBytes(32);
		start(relay, room, key); const link = `${relay.replace(/\/$/, '')}/r/${room}#${key.toString('base64url')}`;
		await vscode.env.clipboard.writeText(link); vscode.window.showInformationMessage(vscode.l10n.t("Collaboration session started — invite link copied. Your peer opens the same repository and runs \"Collaboration: Join Session...\"."));
	});
	register(ctx, 'axiora.collab.join', async (link?: string) => {
		link ??= await vscode.window.showInputBox({ prompt: vscode.l10n.t("Invite link"), placeHolder: vscode.l10n.t("http://relay:7790/r/<room>#<key>"), ignoreFocusOut: true }); const m = link && /^(https?:\/\/[^#]+)\/r\/([\w-]+)#([\w-]+)$/.exec(link.trim());
		if (!m) { if (link) { vscode.window.showErrorMessage(vscode.l10n.t("Not a valid Axiora invite link.")); } return; } start(m[1], m[2], Buffer.from(m[3], 'base64url'));
	});
	register(ctx, 'axiora.collab.leave', stop);
	register(ctx, 'axiora.collab.menu', async () => { const a = await vscode.window.showQuickPick(['Copy Invite Link', 'Leave Session']); if (a === 'Leave Session') { stop(); } if (a?.startsWith('Copy') && s) { await vscode.env.clipboard.writeText(`${s.relay}/r/${s.room}#${s.key.toString('base64url')}`); } });
}
