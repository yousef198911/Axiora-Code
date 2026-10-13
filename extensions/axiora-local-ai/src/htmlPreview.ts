/*---------------------------------------------------------------------------------------------
 *  Live HTML preview beside the editor (updates while typing; local CSS/JS/images resolved).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.html.preview', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document; if (!doc) { return; }
		const dir = vscode.Uri.file(path.dirname(doc.uri.fsPath));
		const roots = [dir, ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [])];
		const panel = vscode.window.createWebviewPanel('axiora.htmlPreview', `Preview: ${path.basename(doc.fileName)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: roots });
		const render = () => {
			const base = panel.webview.asWebviewUri(dir).toString() + '/';
			let html = doc.getText();
			html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`) : `<base href="${base}">${html}`;
			panel.webview.html = html;
		};
		render();
		let t: ReturnType<typeof setTimeout> | undefined;
		const subs = [
			vscode.workspace.onDidChangeTextDocument(e => { if (e.document === doc) { clearTimeout(t); t = setTimeout(render, 300); } }),
			vscode.workspace.onDidSaveTextDocument(d => { if (d.uri.fsPath.startsWith(dir.fsPath)) { render(); } }), // css/js saved
		];
		panel.onDidDispose(() => subs.forEach(s => s.dispose()));
	});
}
