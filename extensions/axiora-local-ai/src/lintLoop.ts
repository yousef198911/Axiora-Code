/*---------------------------------------------------------------------------------------------
 *  Auto lint-fix loop: ask the local model to fix all errors in a file, re-check diagnostics,
 *  repeat until clean or max iterations. Optional: run automatically on save.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ask, log, register, unfence, withProgress } from './util';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
function errors(uri: vscode.Uri) {
	return vscode.languages.getDiagnostics(uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
}
export async function fixLoop(doc: vscode.TextDocument, max: number, token?: vscode.CancellationToken): Promise<number> {
	let i = 0;
	for (; i < max; i++) {
		const errs = errors(doc.uri);
		if (!errs.length || token?.isCancellationRequested) { break; }
		const list = errs.slice(0, 30).map(d => `line ${d.range.start.line + 1}: ${d.message}`).join('\n');
		const text = doc.getText();
		if (text.length > 60000) { throw new Error('File too large for the AI fix loop.'); }
		const fixed = unfence(await ask(`Fix ALL of these ${doc.languageId} errors without changing behavior otherwise. Return the COMPLETE corrected file in one code block.\nErrors:\n${list}\n\n\`\`\`\n${text}\n\`\`\``, undefined, token));
		if (!fixed || fixed === text.trim()) { break; }
		const we = new vscode.WorkspaceEdit();
		we.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), fixed + (text.endsWith('\n') ? '\n' : ''));
		await vscode.workspace.applyEdit(we);
		await wait(1500); // let language servers re-validate
		log.info(`lint loop pass ${i + 1}: ${errs.length} -> ${errors(doc.uri).length} errors`);
	}
	return errors(doc.uri).length;
}
export function activate(ctx: vscode.ExtensionContext) {
	const max = () => vscode.workspace.getConfiguration('axiora.lintFix').get<number>('maxIterations', 3);
	register(ctx, 'axiora.ai.fixAllProblems', async () => {
		const doc = vscode.window.activeTextEditor?.document; if (!doc) { return; }
		if (!errors(doc.uri).length) { vscode.window.showInformationMessage(vscode.l10n.t("No errors in this file.")); return; }
		const left = await withProgress('fixing all errors…', t => fixLoop(doc, max(), t));
		vscode.window.showInformationMessage(left ? `Axiora: ${left} error(s) remain after ${max()} passes.` : 'Axiora: all errors fixed (Ctrl+Z to undo).');
	});
	let busy = false;
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async doc => {
		if (busy || !vscode.workspace.getConfiguration('axiora.lintFix').get('onSave', false)) { return; }
		await wait(1500);
		if (!errors(doc.uri).length) { return; }
		busy = true;
		try { await fixLoop(doc, max()); } catch (e) { log.warn(`lint loop: ${(e as Error).message}`); } finally { busy = false; }
	}));
}
