/*---------------------------------------------------------------------------------------------
 *  Natural-language to shell command in the terminal (command is inserted, never auto-run).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as os from 'os';
import { ask, register, unfence, withProgress } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.terminalCommand', async () => {
		const q = await vscode.window.showInputBox({ prompt: 'Describe what you want to do in the terminal', placeHolder: 'e.g. find all files larger than 10MB' });
		if (!q) { return; }
		const shell = vscode.env.shell || 'bash';
		const r = await withProgress('writing command…', t => ask(`OS: ${os.platform()}, shell: ${shell}. Give ONE shell command that does: ${q}. Return only the command in one code block, no explanation.`, undefined, t));
		const cmd = unfence(r).split('\n').filter(Boolean).join(' && ');
		const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('Axiora');
		term.show();
		term.sendText(cmd, false); // inserted, user presses Enter to run
	});
}
