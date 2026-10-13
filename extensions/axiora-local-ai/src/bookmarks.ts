/*---------------------------------------------------------------------------------------------
 *  Named bookmarks with gutter icons, persisted per workspace.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register } from './util';

interface Bm { uri: string; line: number; name?: string }
export function activate(ctx: vscode.ExtensionContext) {
	const deco = vscode.window.createTextEditorDecorationType({ gutterIconPath: vscode.Uri.joinPath(ctx.extensionUri, 'media', 'bookmark.svg'), gutterIconSize: 'contain', overviewRulerColor: '#3794ff', overviewRulerLane: vscode.OverviewRulerLane.Left });
	const get = () => ctx.workspaceState.get<Bm[]>('axiora.bookmarks', []);
	const set = async (b: Bm[]) => { await ctx.workspaceState.update('axiora.bookmarks', b); paint(); };
	const paint = () => { for (const ed of vscode.window.visibleTextEditors) { ed.setDecorations(deco, get().filter(b => b.uri === ed.document.uri.toString()).map(b => ({ range: new vscode.Range(b.line, 0, b.line, 0), hoverMessage: `Bookmark${b.name ? `: ${b.name}` : ''}` }))); } };
	ctx.subscriptions.push(deco, vscode.window.onDidChangeVisibleTextEditors(paint));
	paint();
	const toggle = async (named: boolean) => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const uri = ed.document.uri.toString(), line = ed.selection.active.line;
		const all = get(); const i = all.findIndex(b => b.uri === uri && b.line === line);
		if (i >= 0 && !named) { all.splice(i, 1); return set(all); }
		const name = named ? await vscode.window.showInputBox({ prompt: 'Bookmark name' }) : undefined;
		if (named && name === undefined) { return; }
		if (i >= 0) { all[i].name = name; } else { all.push({ uri, line, name }); }
		await set(all);
	};
	register(ctx, 'axiora.bookmarks.toggle', () => toggle(false));
	register(ctx, 'axiora.bookmarks.toggleNamed', () => toggle(true));
	register(ctx, 'axiora.bookmarks.list', async () => {
		const items = get().map(b => ({ label: `$(bookmark) ${b.name || `${path.basename(vscode.Uri.parse(b.uri).fsPath)}:${b.line + 1}`}`, description: `${vscode.workspace.asRelativePath(vscode.Uri.parse(b.uri))}:${b.line + 1}`, b }));
		const p = await vscode.window.showQuickPick(items, { placeHolder: 'Go to bookmark' });
		if (p) { const ed = await vscode.window.showTextDocument(vscode.Uri.parse(p.b.uri)); const pos = new vscode.Position(p.b.line, 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter); }
	});
	register(ctx, 'axiora.bookmarks.clear', () => set([]));
	// keep line numbers in sync with edits
	ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		const all = get(); let changed = false;
		for (const c of e.contentChanges) {
			const delta = c.text.split('\n').length - 1 - (c.range.end.line - c.range.start.line);
			if (!delta) { continue; }
			for (const b of all) { if (b.uri === e.document.uri.toString() && b.line > c.range.start.line) { b.line = Math.max(c.range.start.line, b.line + delta); changed = true; } }
		}
		if (changed) { set(all); }
	}));
}
