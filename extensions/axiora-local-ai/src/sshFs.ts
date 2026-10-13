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
function ssh(host: string, cmd: string, input?: Uint8Array): Promise<Buffer> {
	const ctl = path.join(os.tmpdir(), 'axiora-ssh-%r@%h-%p');
	return new Promise((res, rej) => {
		const p = cp.spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${ctl}`, '-o', 'ControlPersist=600', host, cmd]);
		const out: Buffer[] = [], err: Buffer[] = [];
		p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d)); p.on('error', rej);
		p.on('close', c => c === 0 ? res(Buffer.concat(out)) : rej(Object.assign(new Error(Buffer.concat(err).toString().trim() || `ssh exit ${c}`), { code: c })));
		if (input) { p.stdin.end(Buffer.from(input)); } else { p.stdin.end(); }
	});
}
class SshFs implements vscode.FileSystemProvider {
	private em = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	onDidChangeFile = this.em.event;
	watch() { return new vscode.Disposable(() => undefined); }
	private wrap<T>(uri: vscode.Uri, f: Promise<T>): Promise<T> { return f.catch(e => { const m = String(e.message); if (/No such file|cannot stat|not found/i.test(m)) { throw vscode.FileSystemError.FileNotFound(uri); } if (/Permission denied \(publickey|Host key/i.test(m)) { throw vscode.FileSystemError.Unavailable(m); } throw e; }); }
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const o = (await this.wrap(uri, ssh(uri.authority, `stat -L -c '%F|%s|%Y|%W' -- ${q(uri.path || '/')}`))).toString().trim().split('|');
		return { type: o[0].includes('directory') ? vscode.FileType.Directory : vscode.FileType.File, size: +o[1], mtime: +o[2] * 1000, ctime: (+o[3] || +o[2]) * 1000 };
	}
	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const o = (await this.wrap(uri, ssh(uri.authority, `cd -- ${q(uri.path || '/')} && find . -mindepth 1 -maxdepth 1 -printf '%y %P\\n'`))).toString();
		return o.split('\n').filter(Boolean).map(l => [l.slice(2), l[0] === 'd' ? vscode.FileType.Directory : l[0] === 'l' ? vscode.FileType.SymbolicLink | vscode.FileType.File : vscode.FileType.File]);
	}
	async readFile(uri: vscode.Uri) { return new Uint8Array(await this.wrap(uri, ssh(uri.authority, `cat -- ${q(uri.path)}`))); }
	async writeFile(uri: vscode.Uri, content: Uint8Array) { await ssh(uri.authority, `cat > ${q(uri.path)}`, content); this.em.fire([{ type: vscode.FileChangeType.Changed, uri }]); }
	async createDirectory(uri: vscode.Uri) { await ssh(uri.authority, `mkdir -p -- ${q(uri.path)}`); }
	async delete(uri: vscode.Uri, o: { recursive: boolean }) { await ssh(uri.authority, `rm ${o.recursive ? '-rf' : '-f'} -- ${q(uri.path)}`); this.em.fire([{ type: vscode.FileChangeType.Deleted, uri }]); }
	async rename(a: vscode.Uri, b: vscode.Uri) { await ssh(a.authority, `mv -- ${q(a.path)} ${q(b.path)}`); }
}
export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push(vscode.workspace.registerFileSystemProvider('axiora-ssh', new SshFs(), { isCaseSensitive: true }));
	const recent = () => ctx.globalState.get<string[]>('axiora.ssh.recent', []);
	register(ctx, 'axiora.ssh.openFolder', async () => {
		const hosts = recent();
		const v = await vscode.window.showQuickPick([...hosts.map(h => ({ label: h })), { label: '$(add) New SSH target...' }], { placeHolder: 'user@host:/path' });
		if (!v) { return; }
		const t = v.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: 'SSH target (uses your ssh config and keys)', placeHolder: 'user@host:/home/user/project' }) : v.label;
		if (!t) { return; }
		const m = /^([^:]+):?(.*)$/.exec(t)!; const dir = m[2] || '/';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${m[1]}…` }, () => ssh(m[1], 'true'));
		await ctx.globalState.update('axiora.ssh.recent', [t, ...hosts.filter(h => h !== t)].slice(0, 10));
		const uri = vscode.Uri.from({ scheme: 'axiora-ssh', authority: m[1], path: dir.startsWith('/') ? dir : `/${dir}` });
		vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri, name: `SSH: ${t}` });
	});
	register(ctx, 'axiora.ssh.terminal', async (u?: vscode.Uri) => {
		const f = (u?.scheme === 'axiora-ssh' ? u : vscode.workspace.workspaceFolders?.find(w => w.uri.scheme === 'axiora-ssh')?.uri);
		if (!f) { vscode.window.showInformationMessage('Open an SSH folder first (SSH: Open Remote Folder).'); return; }
		const t = vscode.window.createTerminal({ name: `SSH ${f.authority}`, shellPath: 'ssh', shellArgs: ['-t', f.authority, `cd ${q(f.path)} && exec $SHELL -l`], iconPath: new vscode.ThemeIcon('remote') });
		t.show();
	});
}
