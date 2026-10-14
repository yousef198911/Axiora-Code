/*---------------------------------------------------------------------------------------------
 *  Implement from comment: write a comment / docstring / signature, press Ctrl+Alt+Enter and
 *  the local model writes the whole function below it (with surrounding file context).
 *  Also exposed as a Quick Fix on comment lines ("Implement this with AI").
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register, ask, unfence, withProgress, SYS } from './util';

function commentBlock(doc: vscode.TextDocument, line: number): vscode.Range | undefined {
	const isC = (l: number) => /^\s*(\/\/|#|\*|\/\*|"""|'''|--|;)/.test(doc.lineAt(l).text) || /^\s*(def|function|fn|func|public|private|async|export)\b.*[:{]?\s*$/.test(doc.lineAt(l).text);
	if (!isC(line)) { return undefined; }
	let a = line, b = line; while (a > 0 && isC(a - 1)) { a--; } while (b < doc.lineCount - 1 && isC(b + 1)) { b++; }
	return new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.ai.implementComment', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const doc = ed.document; const r = commentBlock(doc, ed.selection.active.line);
		if (!r) { vscode.window.showInformationMessage(vscode.l10n.t("Put the cursor on a comment or signature that describes the function.")); return; }
		const spec = doc.getText(r); const before = doc.getText(new vscode.Range(Math.max(0, r.start.line - 60), 0, r.start.line, 0)); const after = doc.getText(new vscode.Range(r.end.line + 1, 0, Math.min(doc.lineCount - 1, r.end.line + 30), 0));
		const indent = /^\s*/.exec(doc.lineAt(r.start.line).text)![0];
		const out = await withProgress('Implementing from comment…', t => ask(`Language: ${doc.languageId}. Implement exactly what this comment/signature describes. Output ONLY the code that goes right after it (if it is a signature, output the body and closing). Match the file's style.\n\nCODE BEFORE:\n${before}\n\nSPEC:\n${spec}\n\nCODE AFTER:\n${after}`, SYS, t));
		const code = unfence(out).split('\n').map(l => l ? indent + l.replace(/^\s{0,0}/, '') : l).join('\n');
		await ed.edit(b => b.insert(new vscode.Position(r.end.line + 1, 0), code.replace(/\n?$/, '\n')));
	});
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider('*', {
		provideCodeActions(doc, range) {
			if (!commentBlock(doc, range.start.line)) { return; }
			const a = new vscode.CodeAction('Implement this with AI', vscode.CodeActionKind.RefactorRewrite); a.command = { command: 'axiora.ai.implementComment', title: 'Implement' }; return [a];
		}
	}, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }));
}
