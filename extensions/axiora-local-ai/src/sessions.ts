/*---------------------------------------------------------------------------------------------
 *  Named editor sessions: save / restore the set of open files.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	const all = () => ctx.workspaceState.get<Record<string, string[]>>('axiora.sessions', {});
	register(ctx, 'axiora.sessions.save', async () => {
		const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Session name") }); if (!name) { return; }
		const uris = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as { uri?: vscode.Uri })?.uri?.toString()).filter((u): u is string => !!u);
		await ctx.workspaceState.update('axiora.sessions', { ...all(), [name]: uris });
		vscode.window.showInformationMessage(vscode.l10n.t("Session \"{0}\" saved ({1} files).", name, uris.length));
	});
	register(ctx, 'axiora.sessions.open', async () => {
		const s = all(); const p = await vscode.window.showQuickPick(Object.keys(s).map(k => ({ label: k, description: `${s[k].length} files` })), { placeHolder: vscode.l10n.t("Open session") });
		if (!p) { return; }
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const u of s[p.label]) { await vscode.window.showTextDocument(vscode.Uri.parse(u), { preview: false, preserveFocus: true }).then(undefined, () => undefined); }
	});
	register(ctx, 'axiora.sessions.delete', async () => {
		const s = all(); const p = await vscode.window.showQuickPick(Object.keys(s), { placeHolder: vscode.l10n.t("Delete session") });
		if (p) { delete s[p]; await ctx.workspaceState.update('axiora.sessions', s); }
	});
}
