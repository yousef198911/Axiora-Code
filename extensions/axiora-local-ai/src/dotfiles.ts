/*---------------------------------------------------------------------------------------------
 *  Dotfiles: clone your dotfiles repository (axiora.dotfiles.repository: URL, owner/repo or a
 *  local path) into axiora.dotfiles.targetPath and run its install script (install.sh /
 *  bootstrap.sh / setup.sh, or axiora.dotfiles.installCommand). Without a script, top-level
 *  dotfiles are symlinked into $HOME; existing files are backed up to <name>.axiora-backup.
 *  "Dotfiles: Remove Links" undoes the links and restores backups. Optional install on startup.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register, run } from './util';

const out = vscode.window.createOutputChannel('Dotfiles');
/** Symlink top-level dotfiles of `src` into `home`, backing up real files. Returns linked names. */
export function linkDotfiles(src: string, home: string, ignore: string[] = []): string[] {
	const done: string[] = [];
	for (const n of fs.readdirSync(src)) {
		if (!n.startsWith('.') || ['.git', '.github', '.gitignore', '.gitmodules', '.DS_Store', ...ignore].includes(n)) { continue; }
		const from = path.join(src, n), to = path.join(home, n);
		let st: fs.Stats | undefined; try { st = fs.lstatSync(to); } catch { /* none */ }
		if (st?.isSymbolicLink()) { if (fs.readlinkSync(to) === from) { done.push(n); continue; } fs.unlinkSync(to); }
		else if (st) { const b = `${to}.axiora-backup`; if (!fs.existsSync(b)) { fs.renameSync(to, b); } else { fs.rmSync(to, { recursive: true, force: true }); } }
		fs.symlinkSync(from, to, process.platform === 'win32' && fs.statSync(from).isDirectory() ? 'junction' : undefined); done.push(n);
	}
	return done;
}
export function unlinkDotfiles(src: string, home: string): string[] {
	const done: string[] = [];
	for (const n of fs.readdirSync(home)) {
		const to = path.join(home, n); let st: fs.Stats; try { st = fs.lstatSync(to); } catch { continue; }
		if (st.isSymbolicLink() && path.dirname(path.resolve(home, fs.readlinkSync(to))) === path.resolve(src)) { fs.unlinkSync(to); if (fs.existsSync(`${to}.axiora-backup`)) { fs.renameSync(`${to}.axiora-backup`, to); } done.push(n); }
	}
	return done;
}
export function activate(ctx: vscode.ExtensionContext) {
	const c = () => vscode.workspace.getConfiguration('axiora.dotfiles');
	const target = () => c().get<string>('targetPath', '~/dotfiles').replace(/^~/, os.homedir());
	const install = async (silent = false) => {
		let repo = c().get<string>('repository', '');
		if (!repo) { if (silent) { return; } repo = await vscode.window.showInputBox({ prompt: 'Dotfiles repository (URL, owner/repo, or local path)' }) ?? ''; if (!repo) { return; } await c().update('repository', repo, vscode.ConfigurationTarget.Global); }
		if (/^[\w-]+\/[\w.-]+$/.test(repo) && !fs.existsSync(repo)) { repo = `https://github.com/${repo}.git`; }
		const t = target(); out.appendLine(`[${new Date().toLocaleString()}] dotfiles ${repo} → ${t}`);
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Dotfiles…' }, async p => {
			if (fs.existsSync(path.join(t, '.git'))) { p.report({ message: 'pulling' }); out.append(await run('git', ['-C', t, 'pull', '--ff-only'], os.homedir()).catch(e => `pull failed: ${e.message}\n`)); }
			else { p.report({ message: 'cloning' }); out.append(await run('git', ['clone', '--depth', '1', repo, t], os.homedir())); }
			const cmd = c().get<string>('installCommand', '');
			const script = ['install.sh', 'install', 'bootstrap.sh', 'bootstrap', 'setup.sh', 'setup', ...(process.platform === 'win32' ? ['install.ps1', 'setup.ps1'] : [])].find(s => fs.existsSync(path.join(t, s)));
			if (cmd || script) {
				p.report({ message: `running ${cmd || script}` });
				const r = cmd ? await run(process.platform === 'win32' ? 'cmd' : 'bash', process.platform === 'win32' ? ['/c', cmd] : ['-lc', cmd], t) : script!.endsWith('.ps1') ? await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script!], t) : (fs.chmodSync(path.join(t, script!), 0o755), await run(path.join(t, script!), [], t));
				out.append(r); vscode.window.showInformationMessage(`Dotfiles installed (${cmd || script}).`, 'Show Log').then(a => a && out.show());
			} else {
				const l = linkDotfiles(t, os.homedir(), c().get<string[]>('ignore', [])); out.appendLine(`linked: ${l.join(', ')}`);
				vscode.window.showInformationMessage(`Dotfiles linked into ${os.homedir()}: ${l.join(', ') || 'nothing to link'}.`, 'Show Log').then(a => a && out.show());
			}
		});
	};
	register(ctx, 'axiora.dotfiles.install', () => install(false));
	register(ctx, 'axiora.dotfiles.unlink', async () => { const l = unlinkDotfiles(target(), os.homedir()); vscode.window.showInformationMessage(l.length ? `Removed dotfile links (backups restored): ${l.join(', ')}` : 'No dotfile links found.'); });
	register(ctx, 'axiora.dotfiles.open', async () => { if (fs.existsSync(target())) { await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target()), { forceNewWindow: true }); } else { vscode.window.showInformationMessage('Dotfiles are not installed yet.'); } });
	if (c().get('installOnStartup', false)) { setTimeout(() => void install(true).catch(e => out.appendLine(`startup install failed: ${e.message}`)), 4000); }
}
