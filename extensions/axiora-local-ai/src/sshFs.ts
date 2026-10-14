/*---------------------------------------------------------------------------------------------
 *  SSH remote editing without a remote server: a FileSystemProvider for axiora-ssh://user@host/path
 *  backed by the system ssh client (key/agent auth, ControlMaster connection reuse).
 *  Open a remote folder in the Explorer, edit/save files, and open a remote terminal.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { register } from './util';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Command line that runs a shell command on the target for each transport. */
export function transport(scheme: string, target: string, cmd: string, tty = false): [string, string[]] {
	if (scheme === 'axiora-container') { return ['docker', ['exec', tty ? '-it' : '-i', target, 'sh', '-c', cmd]]; }
	if (scheme === 'axiora-wsl') { return ['wsl.exe', ['-d', target, '--', 'sh', '-c', cmd]]; }
	const ctl = path.join(os.tmpdir(), 'axiora-ssh-%r@%h-%p');
	return ['ssh', [...(tty ? ['-t'] : []), '-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${ctl}`, '-o', 'ControlPersist=600', target, cmd]];
}
const curScheme = 'axiora-ssh';
function ssh(host: string, cmd: string, input?: Uint8Array, scheme = curScheme): Promise<Buffer> {
	return new Promise((res, rej) => {
		const [bin, args] = transport(scheme, host, cmd);
		const p = cp.spawn(bin, args);
		const out: Buffer[] = [], err: Buffer[] = [];
		p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d)); p.on('error', rej);
		p.on('close', c => c === 0 ? res(Buffer.concat(out)) : rej(Object.assign(new Error(Buffer.concat(err).toString().trim() || `ssh exit ${c}`), { code: c })));
		if (input) { p.stdin.end(Buffer.from(input)); } else { p.stdin.end(); }
	});
}
const sx = (u: vscode.Uri, cmd: string, input?: Uint8Array) => ssh(u.authority, cmd, input, u.scheme);
class SshFs implements vscode.FileSystemProvider {
	private em = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	onDidChangeFile = this.em.event;
	watch() { return new vscode.Disposable(() => undefined); }
	private wrap<T>(uri: vscode.Uri, f: Promise<T>): Promise<T> { return f.catch(e => { const m = String(e.message); if (/No such file|cannot stat|not found/i.test(m)) { throw vscode.FileSystemError.FileNotFound(uri); } if (/Permission denied \(publickey|Host key/i.test(m)) { throw vscode.FileSystemError.Unavailable(m); } throw e; }); }
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const o = (await this.wrap(uri, sx(uri, `stat -L -c '%F|%s|%Y|%W' -- ${q(uri.path || '/')}`))).toString().trim().split('|');
		return { type: o[0].includes('directory') ? vscode.FileType.Directory : vscode.FileType.File, size: +o[1], mtime: +o[2] * 1000, ctime: (+o[3] || +o[2]) * 1000 };
	}
	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const o = (await this.wrap(uri, sx(uri, `cd -- ${q(uri.path || '/')} && find . -mindepth 1 -maxdepth 1 -printf '%y %P\\n'`))).toString();
		return o.split('\n').filter(Boolean).map(l => [l.slice(2), l[0] === 'd' ? vscode.FileType.Directory : l[0] === 'l' ? vscode.FileType.SymbolicLink | vscode.FileType.File : vscode.FileType.File]);
	}
	async readFile(uri: vscode.Uri) { return new Uint8Array(await this.wrap(uri, sx(uri, `cat -- ${q(uri.path)}`))); }
	async writeFile(uri: vscode.Uri, content: Uint8Array) { await sx(uri, `cat > ${q(uri.path)}`, content); this.em.fire([{ type: vscode.FileChangeType.Changed, uri }]); }
	async createDirectory(uri: vscode.Uri) { await sx(uri, `mkdir -p -- ${q(uri.path)}`); }
	async delete(uri: vscode.Uri, o: { recursive: boolean }) { await sx(uri, `rm ${o.recursive ? '-rf' : '-f'} -- ${q(uri.path)}`); this.em.fire([{ type: vscode.FileChangeType.Deleted, uri }]); }
	async rename(a: vscode.Uri, b: vscode.Uri) { await sx(a, `mv -- ${q(a.path)} ${q(b.path)}`); }
}
export function activate(ctx: vscode.ExtensionContext) {
	for (const sch of ['axiora-ssh', 'axiora-container', 'axiora-wsl']) { ctx.subscriptions.push(vscode.workspace.registerFileSystemProvider(sch, new SshFs(), { isCaseSensitive: true })); }
	const addFolder = (scheme: string, target: string, dir: string, name: string) => {
		const uri = vscode.Uri.from({ scheme, authority: target, path: dir.startsWith('/') ? dir : `/${dir}` });
		vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri, name });
	};
	register(ctx, 'axiora.container.attach', async () => {
		const out = (await new Promise<string>((res, rej) => cp.execFile('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'], (e, so) => e ? rej(new Error(/ENOENT/.test(e.message) ? 'docker not found. Install Docker to attach to containers.' : e.message)) : res(so))));
		const p = await vscode.window.showQuickPick(out.trim().split('\n').filter(Boolean).map(l => { const [, n, img, st] = l.split('\t'); return { label: `$(vm) ${n}`, description: img, detail: st, id: n }; }), { placeHolder: vscode.l10n.t("Attach to running container") });
		if (!p) { return; }
		const dir = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Folder inside the container"), value: '/workspace' }); if (!dir) { return; }
		addFolder('axiora-container', p.id, dir, `Container: ${p.id}:${dir}`);
	});
	register(ctx, 'axiora.container.openDevcontainer', async () => {
		const root = vscode.workspace.workspaceFolders?.find(w => w.uri.scheme === 'file'); if (!root) { return; }
		let cfg: { image?: string; workspaceFolder?: string; forwardPorts?: number[]; postCreateCommand?: string; name?: string } = {};
		for (const f of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
			try { cfg = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, f))).toString().replace(/^\s*\/\/.*$/gm, '')); break; } catch { /* next */ }
		}
		if (!cfg.image) { vscode.window.showWarningMessage(vscode.l10n.t("No devcontainer.json with an \"image\" found (Dockerfile-based configs: build the image first).")); return; }
		const wf = cfg.workspaceFolder ?? `/workspaces/${path.basename(root.uri.fsPath)}`;
		const name = `axiora-dev-${path.basename(root.uri.fsPath).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
		const t = vscode.window.createTerminal({ name: 'Dev Container', iconPath: new vscode.ThemeIcon('vm') }); t.show();
		const ports = (cfg.forwardPorts ?? []).map(p => `-p ${p}:${p}`).join(' ');
		t.sendText(`docker start ${name} 2>/dev/null || docker run -d --name ${name} ${ports} -v "${root.uri.fsPath}:${wf}" -w "${wf}" ${cfg.image} sleep infinity${cfg.postCreateCommand ? ` && docker exec ${name} sh -c ${q(cfg.postCreateCommand)}` : ''}`);
		addFolder('axiora-container', name, wf, `Dev Container: ${cfg.name ?? name}`);
	});
	register(ctx, 'axiora.wsl.open', async () => {
		const d = await vscode.window.showInputBox({ prompt: vscode.l10n.t("WSL distribution and folder"), placeHolder: vscode.l10n.t("Ubuntu:/home/me/project") }); if (!d) { return; }
		const m = /^([^:]+):?(.*)$/.exec(d)!; addFolder('axiora-wsl', m[1], m[2] || '/', `WSL: ${d}`);
	});
	const recent = () => ctx.globalState.get<string[]>('axiora.ssh.recent', []);
	register(ctx, 'axiora.ssh.openFolder', async () => {
		const hosts = recent();
		const v = await vscode.window.showQuickPick([...hosts.map(h => ({ label: h })), { label: '$(add) New SSH target...' }], { placeHolder: vscode.l10n.t("user@host:/path") });
		if (!v) { return; }
		const t = v.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: vscode.l10n.t("SSH target (uses your ssh config and keys)"), placeHolder: vscode.l10n.t("user@host:/home/user/project") }) : v.label;
		if (!t) { return; }
		const m = /^([^:]+):?(.*)$/.exec(t)!; const dir = m[2] || '/';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Connecting to {0}…", m[1]) }, () => ssh(m[1], 'true'));
		await ctx.globalState.update('axiora.ssh.recent', [t, ...hosts.filter(h => h !== t)].slice(0, 10));
		const uri = vscode.Uri.from({ scheme: 'axiora-ssh', authority: m[1], path: dir.startsWith('/') ? dir : `/${dir}` });
		vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri, name: `SSH: ${t}` });
	});
	register(ctx, 'axiora.ssh.terminal', async (u?: vscode.Uri) => {
		const remote = (x?: vscode.Uri) => !!x && x.scheme.startsWith('axiora-') && ['axiora-ssh', 'axiora-container', 'axiora-wsl'].includes(x.scheme);
		const f = (remote(u) ? u : vscode.workspace.workspaceFolders?.find(w => remote(w.uri))?.uri);
		if (!f) { vscode.window.showInformationMessage(vscode.l10n.t("Open an SSH folder first (SSH: Open Remote Folder).")); return; }
		const [bin, args] = transport(f.scheme, f.authority, `cd ${q(f.path)} && exec \${SHELL:-sh} -l`, true);
		const t = vscode.window.createTerminal({ name: `${f.scheme.slice(7)} ${f.authority}`, shellPath: bin, shellArgs: args, iconPath: new vscode.ThemeIcon('remote') });
		t.show();
	});
}
