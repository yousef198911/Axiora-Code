/*---------------------------------------------------------------------------------------------
 *  Crash / log analysis: select a stack trace or log (or use the clipboard / terminal
 *  selection), get stack frames linked to workspace files and an AI root-cause analysis.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { register, wsRoot, SYS } from './util';
import { chat } from './llm';

const FRAME = [
	/at (?:.+? \()?((?:[A-Za-z]:)?[^():\s]+):(\d+):(\d+)\)?/,              // node / js
	/File "([^"]+)", line (\d+)/,                                             // python
	/\b([\w./\\-]+\.(?:go|rs|java|kt|c|cc|cpp|h|ts|js|py|rb|php|cs|swift)):(\d+)(?::(\d+))?/, // generic file:line
];
export function frames(text: string, root?: string) {
	const out: { file: string; line: number; col: number; raw: string }[] = [];
	for (const l of text.split('\n')) {
		for (const re of FRAME) {
			const m = re.exec(l); if (!m) { continue; }
			let f = m[1]; if (root && !path.isAbsolute(f)) { f = path.join(root, f); }
			if (!f.includes('node_modules') && !f.startsWith('node:') && fs.existsSync(f)) { out.push({ file: f, line: +m[2], col: +(m[3] ?? 1), raw: l.trim() }); }
			break;
		}
	}
	return out;
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.analyzeCrash', async () => {
		const ed = vscode.window.activeTextEditor;
		let text = ed && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : '';
		if (!text) { await vscode.commands.executeCommand('workbench.action.terminal.copySelection'); text = await vscode.env.clipboard.readText(); }
		if (!text.trim()) { vscode.window.showInformationMessage(vscode.l10n.t("Select a stack trace or log (in an editor or terminal), or copy it, then run Analyze Crash.")); return; }
		const root = wsRoot()?.fsPath; const fr = frames(text, root);
		let code = '';
		for (const f of fr.slice(0, 4)) { const lines = fs.readFileSync(f.file, 'utf8').split('\n'); const a = Math.max(0, f.line - 6), b = Math.min(lines.length, f.line + 4); code += `\n--- ${path.relative(root ?? '', f.file)}:${f.line}\n${lines.slice(a, b).map((x, i) => `${a + i + 1}${a + i + 1 === f.line ? '>' : ' '} ${x}`).join('\n')}\n`; }
		const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: `# Crash analysis\n\n## Frames in your code\n${fr.map(f => `- [${path.relative(root ?? '', f.file)}:${f.line}](${vscode.Uri.file(f.file).with({ fragment: `L${f.line}` })})`).join('\n') || '_none found_'}\n\n## Analysis\n\n` });
		const view = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
		let acc = '';
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t("Analyzing crash…") }, () => chat([{ role: 'system', content: SYS }, { role: 'user', content: `Analyze this crash/log. Give: 1) root cause, 2) the exact fix, 3) how to verify. Be concise.\n\nLOG:\n${text.slice(0, 12000)}\n\nCODE AT FRAMES:${code}` }], s => { acc += s; }));
		await view.edit(b => b.insert(new vscode.Position(view.document.lineCount, 0), acc));
		if (fr[0]) { const te = await vscode.window.showTextDocument(vscode.Uri.file(fr[0].file), { viewColumn: vscode.ViewColumn.One, preserveFocus: true }); const p = new vscode.Position(fr[0].line - 1, Math.max(0, fr[0].col - 1)); te.selection = new vscode.Selection(p, p); te.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter); }
	});
}
