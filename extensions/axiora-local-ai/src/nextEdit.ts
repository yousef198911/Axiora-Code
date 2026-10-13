/*---------------------------------------------------------------------------------------------
 *  Next Edit / Tab-to-jump: when you rename an identifier by hand (e.g. change `total` to
 *  `sum` in one place), Axiora highlights the next remaining occurrence; Tab applies the same
 *  change there and jumps on, Esc dismisses. Works for any repeated word replacement.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

const deco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'), border: '1px dashed', borderColor: new vscode.ThemeColor('editorInfo.foreground'), after: { contentText: ' ⇥ Tab', color: new vscode.ThemeColor('editorCodeLens.foreground') } });
export function activate(ctx: vscode.ExtensionContext) {
	let pending: { uri: string; from: string; to: string; range: vscode.Range } | undefined;
	let wordBefore: { uri: string; line: number; word: string; range: vscode.Range } | undefined;
	const clear = () => { pending = undefined; vscode.window.activeTextEditor?.setDecorations(deco, []); vscode.commands.executeCommand('setContext', 'axiora.nextEditPending', false); };
	const findNext = (ed: vscode.TextEditor, from: string, after: vscode.Position): vscode.Range | undefined => {
		const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'); const text = ed.document.getText(); const off = ed.document.offsetAt(after);
		const all = [...text.matchAll(re)].map(m => m.index!); const i = all.find(x => x >= off) ?? all[0];
		return i === undefined ? undefined : new vscode.Range(ed.document.positionAt(i), ed.document.positionAt(i + from.length));
	};
	const show = (ed: vscode.TextEditor, from: string, to: string, after: vscode.Position) => {
		const r = findNext(ed, from, after); if (!r) { clear(); return; }
		pending = { uri: ed.document.uri.toString(), from, to, range: r }; ed.setDecorations(deco, [r]);
		vscode.commands.executeCommand('setContext', 'axiora.nextEditPending', true);
		ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	};
	// remember the word under the cursor before an edit starts
	ctx.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
		if (!vscode.workspace.getConfiguration('axiora.nextEdit').get('enabled', true)) { return; }
		const d = e.textEditor.document; const p = e.selections[0].active; const r = d.getWordRangeAtPosition(p);
		if (r && (!wordBefore || wordBefore.line !== p.line || !wordBefore.range.contains(p))) { wordBefore = { uri: d.uri.toString(), line: p.line, word: d.getText(r), range: r }; }
	}));
	let timer: NodeJS.Timeout | undefined;
	ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		const ed = vscode.window.activeTextEditor; if (!ed || ed.document !== e.document || !wordBefore || wordBefore.uri !== e.document.uri.toString()) { return; }
		if (timer) { clearTimeout(timer); }
		const wb = wordBefore;
		timer = setTimeout(() => {
			const p = ed.selection.active; if (p.line !== wb.line) { return; }
			const r = ed.document.getWordRangeAtPosition(p) ?? ed.document.getWordRangeAtPosition(p.translate(0, -1 < -p.character ? -1 : 0));
			const now = r ? ed.document.getText(r) : '';
			if (now && now !== wb.word && /^\w+$/.test(wb.word) && wb.word.length > 1 && findNext(ed, wb.word, r!.end)) { show(ed, wb.word, now, r!.end); wordBefore = { ...wb, word: now, range: r! }; }
		}, 600);
	}));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.nextEdit.accept', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed || !pending || pending.uri !== ed.document.uri.toString()) { clear(); return; }
		const { range, from, to } = pending;
		await ed.edit(b => b.replace(range, to));
		const end = range.start.translate(0, to.length); ed.selection = new vscode.Selection(end, end);
		show(ed, from, to, end);
	}), vscode.commands.registerCommand('axiora.nextEdit.dismiss', clear), vscode.window.onDidChangeActiveTextEditor(clear));
}
