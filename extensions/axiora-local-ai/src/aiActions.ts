/*---------------------------------------------------------------------------------------------
 *  Fix with AI (quick fix on problems), Generate Tests, Add Docs, Explain - local models.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { ask, register, unfence, withProgress } from './util';

function around(doc: vscode.TextDocument, range: vscode.Range, pad = 15): vscode.Range {
	const s = Math.max(0, range.start.line - pad), e = Math.min(doc.lineCount - 1, range.end.line + pad);
	return new vscode.Range(s, 0, e, doc.lineAt(e).text.length);
}

export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
		provideCodeActions(doc, _range, context) {
			return context.diagnostics.slice(0, 3).map(d => {
				const a = new vscode.CodeAction(`Fix with Axiora AI: ${d.message.slice(0, 60)}`, vscode.CodeActionKind.QuickFix);
				a.command = { command: 'axiora.ai.fixProblem', title: 'Fix with Axiora AI', arguments: [doc.uri, d.range, d.message] };
				a.diagnostics = [d];
				return a;
			});
		}
	}, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));

	register(ctx, 'axiora.ai.fixProblem', async (uri?: vscode.Uri, range?: vscode.Range, message?: string) => {
		const ed = vscode.window.activeTextEditor;
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : ed?.document;
		if (!doc) { return; }
		if (!range || !message) {
			const diags = vscode.languages.getDiagnostics(doc.uri);
			const sel = ed?.selection.active;
			const d = diags.find(x => sel && x.range.contains(sel)) ?? diags[0];
			if (!d) { vscode.window.showInformationMessage('No problems in this file.'); return; }
			range = d.range; message = d.message;
		}
		const r = around(doc, range);
		const code = doc.getText(r);
		const fixed = await withProgress('fixing problem…', t => ask(`Language: ${doc.languageId}. Problem: "${message}" at line ${range!.start.line - r.start.line + 1} of this snippet.\nReturn ONLY the corrected snippet (same lines, full replacement) in one code block.\n\`\`\`\n${code}\n\`\`\``, undefined, t));
		const out = unfence(fixed);
		if (!out) { return; }
		const we = new vscode.WorkspaceEdit(); we.replace(doc.uri, r, out);
		await vscode.workspace.applyEdit(we);
		vscode.window.showInformationMessage('Axiora applied a fix (Ctrl+Z to undo).');
	});

	register(ctx, 'axiora.ai.generateTests', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const doc = ed.document;
		const src = ed.selection.isEmpty ? doc.getText() : doc.getText(ed.selection);
		const ext = path.extname(doc.fileName);
		const target = vscode.Uri.file(doc.fileName.replace(new RegExp(`${ext.replace('.', '\\.')}$`), `.test${ext}`));
		const t = await withProgress('generating tests…', tok => ask(`Write thorough unit tests for this ${doc.languageId} code from file ${path.basename(doc.fileName)}. Use the most common test framework for the language and import from "./${path.basename(doc.fileName, ext)}". Return only the test file in one code block.\n\`\`\`\n${src.slice(0, 20000)}\n\`\`\``, undefined, tok));
		let exists = true; try { await vscode.workspace.fs.stat(target); } catch { exists = false; }
		const u = exists ? target.with({ path: target.path.replace(/\.test(\.[^.]+)$/, '.axiora.test$1') }) : target;
		await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(unfence(t) + '\n'));
		await vscode.window.showTextDocument(u, { viewColumn: vscode.ViewColumn.Beside });
	});

	register(ctx, 'axiora.ai.addDocs', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const sel = ed.selection.isEmpty ? ed.document.lineAt(ed.selection.active.line).range : new vscode.Range(ed.selection.start.with({ character: 0 }), ed.selection.end);
		const code = ed.document.getText(sel);
		const t = await withProgress('writing docs…', tok => ask(`Add idiomatic documentation comments (${ed.document.languageId}) to this code without changing behavior. Return only the full code in one code block.\n\`\`\`\n${code}\n\`\`\``, undefined, tok));
		await ed.edit(e => e.replace(sel, unfence(t)));
	});

	register(ctx, 'axiora.ai.explain', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		const code = ed.selection.isEmpty ? ed.document.lineAt(ed.selection.active.line).text : ed.document.getText(ed.selection);
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@axiora Explain this ${ed.document.languageId} code:\n\`\`\`\n${code}\n\`\`\`` });
	});
}
