/*---------------------------------------------------------------------------------------------
 *  Editing extras: rotate selections, typewriter mode, clipboard history.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

export function activate(ctx: vscode.ExtensionContext) {
	const rotate = async (dir: 1 | -1) => {
		const ed = vscode.window.activeTextEditor; if (!ed || ed.selections.length < 2) { return; }
		const sels = [...ed.selections].sort((a, b) => a.start.compareTo(b.start));
		const texts = sels.map(s => ed.document.getText(s));
		await ed.edit(e => sels.forEach((s, i) => e.replace(s, texts[(i - dir + texts.length) % texts.length])));
	};
	register(ctx, 'axiora.edit.rotateSelectionsForward', () => rotate(1));
	register(ctx, 'axiora.edit.rotateSelectionsBackward', () => rotate(-1));

	// typewriter: keep the cursor line vertically centered while typing
	ctx.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
		if (!vscode.workspace.getConfiguration('axiora.editor').get('typewriterMode', false) || e.kind === vscode.TextEditorSelectionChangeKind.Mouse) { return; }
		e.textEditor.revealRange(e.selections[0], vscode.TextEditorRevealType.InCenter);
	}));
	register(ctx, 'axiora.editor.toggleTypewriter', async () => {
		const c = vscode.workspace.getConfiguration('axiora.editor');
		await c.update('typewriterMode', !c.get('typewriterMode', false), vscode.ConfigurationTarget.Global);
	});

	// clipboard history (polls the clipboard while the window is focused)
	const hist: string[] = ctx.globalState.get('axiora.clipHistory', []);
	let last = hist[0] ?? '';
	const timer = setInterval(async () => {
		if (!vscode.window.state.focused) { return; }
		const t = await vscode.env.clipboard.readText();
		if (t && t !== last && t.length < 100_000) {
			last = t; const i = hist.indexOf(t); if (i >= 0) { hist.splice(i, 1); }
			hist.unshift(t); hist.length = Math.min(hist.length, 30); ctx.globalState.update('axiora.clipHistory', hist);
		}
	}, 1000);
	ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
	register(ctx, 'axiora.edit.pasteFromHistory', async () => {
		const p = await vscode.window.showQuickPick(hist.map(h => ({ label: h.replace(/\s+/g, ' ').slice(0, 100), h })), { placeHolder: 'Paste from clipboard history' });
		const ed = vscode.window.activeTextEditor;
		if (p && ed) { await ed.edit(e => ed.selections.forEach(s => e.replace(s, p.h))); }
	});
}
