/*---------------------------------------------------------------------------------------------
 *  Headless CLI agent: installs `axiora-agent` (bin/axiora-agent.mjs) into ~/.local/bin (or
 *  prints the path on Windows) so the same local-model agent works in any terminal / CI / ssh.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.cli.install', async () => {
		const src = path.join(ctx.extensionPath, 'bin', 'axiora-agent.mjs');
		if (process.platform === 'win32') { await vscode.env.clipboard.writeText(`node "${src}"`); vscode.window.showInformationMessage('Copied the CLI command (node …axiora-agent.mjs) to the clipboard.'); return; }
		const dir = path.join(os.homedir(), '.local', 'bin'); fs.mkdirSync(dir, { recursive: true });
		const dst = path.join(dir, 'axiora-agent'); try { fs.unlinkSync(dst); } catch { /* none */ }
		fs.writeFileSync(dst, `#!/bin/sh\nAXIORA_USER_DATA="\${AXIORA_USER_DATA:-${path.dirname(path.dirname(path.dirname(ctx.globalStorageUri.fsPath)))}}" exec node "${src}" "$@"\n`, { mode: 0o755 });
		const t = vscode.window.createTerminal({ name: 'axiora-agent', iconPath: new vscode.ThemeIcon('terminal') }); t.show();
		t.sendText(`export PATH="$HOME/.local/bin:$PATH"; axiora-agent --help`);
	});
}
