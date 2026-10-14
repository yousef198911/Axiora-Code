/*---------------------------------------------------------------------------------------------
 *  Git extras: stash staged changes only, blame previous revision of the current line.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register, run } from './util';

function repoRoot(file?: string): string | undefined {
	const git = vscode.extensions.getExtension<any>('vscode.git')?.exports?.getAPI(1);
	const repos = git?.repositories ?? [];
	return (repos.find((r: any) => file?.startsWith(r.rootUri.fsPath)) ?? repos[0])?.rootUri.fsPath;
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.git.stashStaged', async () => {
		const cwd = repoRoot(); if (!cwd) { return; }
		const msg = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Stash message (staged changes only)") });
		if (msg === undefined) { return; }
		await run('git', ['stash', 'push', '--staged', ...(msg ? ['-m', msg] : [])], cwd);
		vscode.window.showInformationMessage(vscode.l10n.t("Staged changes stashed."));
	});
	register(ctx, 'axiora.git.blamePrevious', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const file = ed.document.uri.fsPath; const cwd = repoRoot(file); if (!cwd) { return; }
		const rel = path.relative(cwd, file).split(path.sep).join('/');
		const line = ed.selection.active.line + 1;
		const b = await run('git', ['blame', '-L', `${line},${line}`, '--porcelain', '--', rel], cwd);
		const sha = b.split(' ')[0];
		if (/^0+$/.test(sha)) { vscode.window.showInformationMessage(vscode.l10n.t("Line is not committed yet.")); return; }
		const prevFile = (/^previous \S+ (.+)$/m.exec(b)?.[1]) ?? rel;
		let content: string;
		try { content = await run('git', ['show', `${sha}^:${prevFile}`], cwd); } catch { vscode.window.showInformationMessage(vscode.l10n.t("This line was introduced in the first commit of the file.")); return; }
		const subject = (await run('git', ['log', '-1', '--format=%h %an: %s', sha], cwd)).trim();
		const doc = await vscode.workspace.openTextDocument({ content, language: ed.document.languageId });
		await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
		vscode.window.showInformationMessage(vscode.l10n.t("Showing {0} before {1}", prevFile, subject));
	});
}
