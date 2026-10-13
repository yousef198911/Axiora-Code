/*---------------------------------------------------------------------------------------------
 *  Deploy / transfer files to servers (like JetBrains Deployment / PhpStorm SFTP):
 *  targets in .axiora/deploy.json { "name", "target": "user@host:/var/www/app" | "/local/path",
 *  "exclude": [...], "uploadOnSave": true }. Uses rsync (falls back to scp).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { register, wsRoot } from './util';

type T = { name: string; target: string; exclude?: string[]; uploadOnSave?: boolean; build?: string; health?: string; rollback?: string; confirm?: boolean; checks?: number; interval?: number };
/** Rollout check: poll the health URL; returns how many checks passed and the first failure. */
export async function watchRollout(url: string, checks: number, intervalMs: number, onTick: (i: number, ok: boolean, info: string) => void): Promise<{ ok: number; fail?: string }> {
	let ok = 0;
	for (let i = 1; i <= checks; i++) {
		const t0 = Date.now(); let info = '';
		try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); info = `HTTP ${r.status} · ${Date.now() - t0} ms`; if (!r.ok) { onTick(i, false, info); return { ok, fail: info }; } } catch (e) { info = (e as Error).message; onTick(i, false, info); return { ok, fail: info }; }
		ok++; onTick(i, true, info); if (i < checks) { await new Promise(r => setTimeout(r, intervalMs)); }
	}
	return { ok };
}
const out = vscode.window.createOutputChannel('Axiora Deploy');
function sh(cmd: string, args: string[], cwd: string): Promise<void> {
	out.appendLine(`$ ${cmd} ${args.join(' ')}`);
	return new Promise((res, rej) => { const p = cp.spawn(cmd, args, { cwd }); p.stdout.on('data', d => out.append(String(d))); p.stderr.on('data', d => out.append(String(d))); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))); });
}
export function activate(ctx: vscode.ExtensionContext) {
	const targets = async (): Promise<T[]> => { const r = wsRoot(); if (!r) { return []; } try { return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(r, '.axiora', 'deploy.json'))).toString()); } catch { return []; } };
	const pick = async () => { const ts = await targets(); if (!ts.length) { await vscode.commands.executeCommand('axiora.deploy.configure'); return undefined; } return ts.length === 1 ? ts[0] : (await vscode.window.showQuickPick(ts.map(t => ({ label: t.name, description: t.target, t })), { placeHolder: 'Deployment target' }))?.t; };
	const upload = async (t: T, rels: string[], mirror = false) => {
		const root = wsRoot()!.fsPath; const dest = t.target.endsWith('/') ? t.target : t.target + '/';
		const ex = ['.git', 'node_modules', '.axiora', ...(t.exclude ?? [])].flatMap(e => ['--exclude', e]);
		if (!/^[^/\\]+:/.test(t.target)) { // local / mounted folder target: copy directly
			const fs = await import('fs');
			for (const r of rels) { const src = path.join(root, r), dst = path.join(t.target, r === '.' ? '' : r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true, filter: s => !['.git', 'node_modules', '.axiora'].some(x => s.split(path.sep).includes(x)) }); out.appendLine(`copied ${r} -> ${dst}`); }
			return;
		}
		try { await sh('rsync', ['-az', '--relative', ...(mirror ? ['--delete'] : []), ...ex, ...rels, dest], root); }
		catch (e) { if (!/ENOENT/.test(String(e))) { throw e; } for (const r of rels) { await sh('scp', ['-r', path.join(root, r), dest + (r === '.' ? '' : path.dirname(r) + '/')], root); } }
	};
	register(ctx, 'axiora.deploy.configure', async () => {
		const r = wsRoot(); if (!r) { return; } const f = vscode.Uri.joinPath(r, '.axiora', 'deploy.json');
		try { await vscode.workspace.fs.stat(f); } catch { await vscode.workspace.fs.writeFile(f, Buffer.from(JSON.stringify([{ name: 'production', target: 'user@example.com:/var/www/app', exclude: ['*.log'], uploadOnSave: false }], null, 2))); }
		await vscode.window.showTextDocument(f);
	});
	register(ctx, 'axiora.deploy.upload', async (u?: vscode.Uri, us?: vscode.Uri[]) => {
		const t = await pick(); if (!t) { return; } const root = wsRoot()!;
		const sel = (us?.length ? us : u ? [u] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : []).map(x => path.relative(root.fsPath, x.fsPath) || '.');
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Uploading to ${t.name}…` }, () => upload(t, sel));
		vscode.window.setStatusBarMessage(`$(cloud-upload) Uploaded ${sel.length} item(s) to ${t.name}`, 5000);
	});
	register(ctx, 'axiora.deploy.all', async () => {
		const t = await pick(); if (!t) { return; }
		if (await vscode.window.showWarningMessage(`Sync whole project to ${t.target}? Remote files not in the project will be deleted.`, { modal: true }, 'Deploy') !== 'Deploy') { return; }
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deploying to ${t.name}…` }, () => upload(t, ['.'], true));
		vscode.window.showInformationMessage(`Deployed to ${t.name}.`);
	});
	// one-click deploy (status bar) + rollout monitoring with rollback
	const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 46); sb.command = 'axiora.deploy.oneClick'; ctx.subscriptions.push(sb);
	const showSb = async () => { const ts = await targets(); if (ts.length) { sb.text = '$(rocket) Deploy'; sb.tooltip = `One-click deploy → ${ts[0].name} (build, sync, health-check)`; sb.show(); } else { sb.hide(); } };
	void showSb(); const w = vscode.workspace.createFileSystemWatcher('**/.axiora/deploy.json'); ctx.subscriptions.push(w, w.onDidChange(showSb), w.onDidCreate(showSb), w.onDidDelete(showSb));
	const rollout = async (t: T) => {
		if (!t.health) { return; }
		sb.text = '$(pulse) Rollout…';
		const res = await watchRollout(t.health, t.checks ?? 5, t.interval ?? 3000, (i, ok, info) => { sb.text = `$(pulse) Rollout ${i}/${t.checks ?? 5} ${ok ? '✓' : '✗'}`; out.appendLine(`[rollout] check ${i}: ${ok ? 'healthy' : 'UNHEALTHY'} — ${info}`); });
		sb.text = '$(rocket) Deploy';
		if (!res.fail) { vscode.window.showInformationMessage(`Rollout to ${t.name} healthy (${res.ok} checks).`); return; }
		const a = await vscode.window.showErrorMessage(`Rollout to ${t.name} unhealthy: ${res.fail}`, ...(t.rollback ? ['Roll Back'] : []), 'Show Log');
		if (a === 'Roll Back' && t.rollback) { await sh('bash', ['-lc', t.rollback], wsRoot()!.fsPath); vscode.window.showInformationMessage(`Rolled back ${t.name}.`); } else if (a === 'Show Log') { out.show(); }
	};
	register(ctx, 'axiora.deploy.oneClick', async () => {
		const t = await pick(); if (!t) { return; }
		if (t.confirm !== false && await vscode.window.showWarningMessage(`Deploy to ${t.name} (${t.target})?`, { modal: true }, 'Deploy') !== 'Deploy') { return; }
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deploying to ${t.name}…` }, async p => { if (t.build) { p.report({ message: 'building' }); await sh('bash', ['-lc', t.build], wsRoot()!.fsPath); } p.report({ message: 'syncing' }); await upload(t, ['.'], true); });
		out.appendLine(`deployed to ${t.name}`); await rollout(t);
	});
	register(ctx, 'axiora.deploy.watch', async () => { const t = await pick(); if (t?.health) { await rollout(t); } else if (t) { vscode.window.showInformationMessage('Add "health": "https://…/health" (and optional "rollback": "<command>") to this target in .axiora/deploy.json.'); } });
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async d => {
		const root = wsRoot(); if (!root || !d.uri.fsPath.startsWith(root.fsPath) || d.uri.fsPath.includes(`${path.sep}.axiora${path.sep}`)) { return; }
		for (const t of (await targets()).filter(t => t.uploadOnSave)) { upload(t, [path.relative(root.fsPath, d.uri.fsPath)]).then(() => vscode.window.setStatusBarMessage(`$(cloud-upload) ${path.basename(d.fileName)} → ${t.name}`, 3000), e => out.appendLine(String(e))); }
	}));
}
