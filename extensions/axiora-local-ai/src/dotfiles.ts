/*---------------------------------------------------------------------------------------------
 *  Dotfiles: clone your dotfiles repository (setting axiora.dotfiles.repository) into
 *  ~/dotfiles and run its install script (install.sh / bootstrap.sh / setup.sh), or symlink
 *  top-level dotfiles into $HOME. Also applied inside Dev Containers on demand.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.dotfiles.install', async () => {
		const c = vscode.workspace.getConfiguration('axiora.dotfiles');
		let repo = c.get<string>('repository', '');
		if (!repo) { repo = await vscode.window.showInputBox({ prompt: 'Dotfiles repository (URL, owner/repo, or local path)' }) ?? ''; if (!repo) { return; } await c.update('repository', repo, vscode.ConfigurationTarget.Global); }
		if (/^[\w-]+\/[\w.-]+$/.test(repo)) { repo = `https://github.com/${repo}.git`; }
		const target = c.get<string>('targetPath', '~/dotfiles').replace(/^~/, os.homedir());
		const cmd = c.get<string>('installCommand', '');
		const scripts = ['install.sh', 'install', 'bootstrap.sh', 'bootstrap', 'setup.sh', 'setup'];
		const t = vscode.window.createTerminal({ name: 'Dotfiles', iconPath: new vscode.ThemeIcon('home') }); t.show();
		const link = `for f in "${target}"/.[!.]*; do b=$(basename "$f"); [ "$b" = .git ] && continue; ln -sfn "$f" "$HOME/$b" && echo "linked $b"; done`;
		const run = cmd ? `(cd "${target}" && ${cmd})` : `(cd "${target}" && for s in ${scripts.join(' ')}; do [ -f "$s" ] && { chmod +x "$s"; ./"$s"; exit; }; done; ${link})`;
		t.sendText(fs.existsSync(target) ? `git -C "${target}" pull --ff-only; ${run}` : `git clone --depth 1 "${repo}" "${target}" && ${run}`);
		void path;
	});
}
