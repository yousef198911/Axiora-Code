/*---------------------------------------------------------------------------------------------
 *  Generate commit message from staged (or all) changes with a local model.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ask, register, run, unfence, withProgress } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.generateCommitMessage', async (arg?: { rootUri?: vscode.Uri }) => {
		const git = vscode.extensions.getExtension<any>('vscode.git')?.exports?.getAPI(1);
		const repo = git?.repositories.find((r: any) => !arg?.rootUri || r.rootUri.fsPath === arg.rootUri.fsPath) ?? git?.repositories[0];
		if (!repo) { vscode.window.showInformationMessage('No git repository open.'); return; }
		const cwd = repo.rootUri.fsPath;
		let diff = await run('git', ['diff', '--cached', '--no-color'], cwd);
		if (!diff.trim()) { diff = await run('git', ['diff', 'HEAD', '--no-color'], cwd).catch(() => ''); }
		if (!diff.trim()) { vscode.window.showInformationMessage('No changes to describe.'); return; }
		const msg = await withProgress('writing commit message…', t => ask(`Write a Conventional Commits message (subject <= 72 chars, blank line, short bullet body) for this diff. Return only the message.\n\`\`\`diff\n${diff.slice(0, 30000)}\n\`\`\``, undefined, t));
		repo.inputBox.value = unfence(msg);
	});
}
