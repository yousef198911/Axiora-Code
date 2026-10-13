/*---------------------------------------------------------------------------------------------
 *  Built-in lightweight Vim mode (setting axiora.keymap = "vim").
 *  Normal / Insert / Visual modes, counts, motions h j k l w b e 0 ^ $ gg G, operators d c y
 *  with motions (dw, cw, d$, ...) and doubled (dd, yy, cc), x X p P u Ctrl+R(redo) i a I A o O v V,
 *  r<char>, J, ., / ? n N, :w :q :wq :<line>.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { addTypeHandler } from './typeRouter';

type Mode = 'normal' | 'insert' | 'visual' | 'vline';
const exec = (c: string, a?: unknown) => vscode.commands.executeCommand(c, a);

export function activate(ctx: vscode.ExtensionContext) {
	let mode: Mode = 'normal'; let pending = ''; let lastChange = ''; let reg = ''; let regLine = false; let sub: vscode.Disposable | undefined;
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
	ctx.subscriptions.push(status);
	const enabled = () => vscode.workspace.getConfiguration('axiora').get('keymap') === 'vim';
	const setMode = (m: Mode) => {
		mode = m; pending = '';
		status.text = { normal: '-- NORMAL --', insert: '-- INSERT --', visual: '-- VISUAL --', vline: '-- VISUAL LINE --' }[m];
		vscode.commands.executeCommand('setContext', 'axiora.vimMode', m);
		const ed = vscode.window.activeTextEditor;
		if (ed) { ed.options.cursorStyle = m === 'insert' ? vscode.TextEditorCursorStyle.Line : vscode.TextEditorCursorStyle.Block; }
	};
	const ed = () => vscode.window.activeTextEditor;
	const motionCmd: Record<string, string> = { h: 'cursorLeft', l: 'cursorRight', j: 'cursorDown', k: 'cursorUp', w: 'cursorWordStartRight', b: 'cursorWordStartLeft', e: 'cursorWordEndRight', '0': 'cursorLineStart', '^': 'cursorHome', $: 'cursorEnd', G: 'cursorBottom', gg: 'cursorTop' };
	const select = (c: string) => c === 'cursorDown' ? 'cursorDownSelect' : c === 'cursorUp' ? 'cursorUpSelect' : c + 'Select';
	async function lineOp(op: string, n: number) {
		const e = ed()!; const l = e.selection.active.line; const last = Math.min(e.document.lineCount - 1, l + n - 1);
		const range = new vscode.Range(l, 0, last, e.document.lineAt(last).text.length);
		reg = e.document.getText(range) + '\n'; regLine = true; await vscode.env.clipboard.writeText(reg);
		if (op === 'y') { return; }
		if (op === 'd') { await e.edit(b => b.delete(last + 1 < e.document.lineCount ? new vscode.Range(l, 0, last + 1, 0) : new vscode.Range(Math.max(0, l - 1), l > 0 ? e.document.lineAt(l - 1).text.length : 0, last, e.document.lineAt(last).text.length))); }
		if (op === 'c') { await e.edit(b => b.replace(range, '')); setMode('insert'); }
	}
	async function handle(key: string): Promise<boolean> {
		if (!enabled() || mode === 'insert') { return false; }
		const e = ed(); if (!e) { return false; }
		let k = pending + key;
		const cm = /^(\d*)(.*)$/.exec(k)!; const n = Math.max(1, +(cm[1] || '1')); const cmd = cm[2];
		if (cmd === '' || (cm[1] && cmd === '')) { pending = k; return true; }
		if (k === '0' && !pending) { await exec('cursorLineStart'); return true; }
		// visual mode
		if (mode === 'visual' || mode === 'vline') {
			if (motionCmd[cmd]) { for (let i = 0; i < n; i++) { await exec(mode === 'vline' && (cmd === 'j' || cmd === 'k') ? select(motionCmd[cmd]) : select(motionCmd[cmd])); } pending = ''; return true; }
			if (cmd === 'g') { pending = k; return true; }
			if (['d', 'x', 'y', 'c'].includes(cmd)) {
				if (mode === 'vline') { await exec('expandLineSelection'); }
				reg = e.document.getText(e.selection); regLine = mode === 'vline'; await vscode.env.clipboard.writeText(reg);
				if (cmd !== 'y') { await e.edit(b => b.delete(e.selection)); }
				const sel = e.selection.start; e.selection = new vscode.Selection(sel, sel);
				setMode(cmd === 'c' ? 'insert' : 'normal'); return true;
			}
			if (cmd === 'v' || cmd === 'V') { e.selection = new vscode.Selection(e.selection.active, e.selection.active); setMode('normal'); return true; }
			pending = ''; return true;
		}
		// operators waiting for motion
		const op = /^([dcy])(.*)$/.exec(cmd);
		if (op) {
			const [, o, rest] = op;
			if (!rest || rest === 'g') { pending = k; return true; }
			if (rest === o) { lastChange = k; await lineOp(o, n); pending = ''; return true; }
			const mc = motionCmd[rest === 'w' && o === 'c' ? 'e' : rest];
			if (mc) {
				for (let i = 0; i < n; i++) { await exec(select(mc)); }
				reg = e.document.getText(e.selection); regLine = false; await vscode.env.clipboard.writeText(reg);
				if (o === 'y') { const s = e.selection.start; e.selection = new vscode.Selection(s, s); }
				else { await e.edit(b => b.delete(e.selection)); if (o === 'c') { setMode('insert'); } }
				lastChange = k; pending = ''; return true;
			}
			pending = ''; return true;
		}
		if (cmd === 'g' || cmd === 'r') { pending = k; return true; }
		if (cmd.startsWith('r') && cmd.length === 2) {
			await e.edit(b => e.selections.forEach(s => b.replace(new vscode.Range(s.active, s.active.translate(0, 1)), cmd[1]))); lastChange = k; pending = ''; return true;
		}
		if (motionCmd[cmd]) { for (let i = 0; i < (cmd === 'G' || cmd === 'gg' ? 1 : n); i++) { await exec(motionCmd[cmd]); } if (cm[1] && (cmd === 'G' || cmd === 'gg')) { await exec('revealLine', { lineNumber: n - 1, at: 'center' }); const p = new vscode.Position(n - 1, 0); e.selection = new vscode.Selection(p, p); } pending = ''; return true; }
		pending = '';
		switch (cmd) {
			case 'i': setMode('insert'); break;
			case 'a': await exec('cursorRight'); setMode('insert'); break;
			case 'I': await exec('cursorHome'); setMode('insert'); break;
			case 'A': await exec('cursorEnd'); setMode('insert'); break;
			case 'o': await exec('editor.action.insertLineAfter'); setMode('insert'); break;
			case 'O': await exec('editor.action.insertLineBefore'); setMode('insert'); break;
			case 'x': for (let i = 0; i < n; i++) { await exec('deleteRight'); } lastChange = k; break;
			case 'X': for (let i = 0; i < n; i++) { await exec('deleteLeft'); } lastChange = k; break;
			case 'u': for (let i = 0; i < n; i++) { await exec('undo'); } break;
			case 'J': await exec('editor.action.joinLines'); lastChange = k; break;
			case 'p': case 'P': {
				const t = reg || await vscode.env.clipboard.readText();
				if (regLine) { await exec(cmd === 'p' ? 'editor.action.insertLineAfter' : 'editor.action.insertLineBefore'); await exec('cursorLineStart'); await e.edit(b => b.insert(e.selection.active, t.replace(/\n$/, ''))); }
				else { if (cmd === 'p') { await exec('cursorRight'); } await e.edit(b => b.insert(e.selection.active, t)); }
				break;
			}
			case 'v': setMode('visual'); await exec('cursorRightSelect'); break;
			case 'V': setMode('vline'); await exec('expandLineSelection'); break;
			case '.': if (lastChange) { for (const c of lastChange) { await handle(c); } } break;
			case '/': await exec('actions.find'); break;
			case '?': await exec('actions.find'); break;
			case 'n': await exec('editor.action.nextMatchFindAction'); break;
			case 'N': await exec('editor.action.previousMatchFindAction'); break;
			case ':': {
				const c = await vscode.window.showInputBox({ prompt: ':' });
				if (c === 'w') { await exec('workbench.action.files.save'); }
				else if (c === 'q' || c === 'q!') { await exec('workbench.action.closeActiveEditor'); }
				else if (c === 'wq' || c === 'x') { await exec('workbench.action.files.save'); await exec('workbench.action.closeActiveEditor'); }
				else if (c && /^\d+$/.test(c)) { const p = new vscode.Position(+c - 1, 0); e.selection = new vscode.Selection(p, p); e.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter); }
				break;
			}
		}
		return true;
	}
	const apply = () => {
		if (enabled() && !sub) { sub = addTypeHandler(handle); setMode('normal'); status.show(); }
		else if (!enabled() && sub) { sub.dispose(); sub = undefined; status.hide(); vscode.commands.executeCommand('setContext', 'axiora.vimMode', undefined); const e = ed(); if (e) { e.options.cursorStyle = vscode.TextEditorCursorStyle.Line; } }
	};
	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('axiora.keymap') && apply()), { dispose: () => sub?.dispose() });
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => enabled() && setMode(mode)));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.vim.escape', () => {
		const e = ed(); if (e && mode !== 'normal') { if (mode === 'insert') { exec('cursorLeft'); } e.selection = new vscode.Selection(e.selection.active, e.selection.active); }
		setMode('normal');
	}));
	ctx.subscriptions.push(vscode.commands.registerCommand('axiora.keymap.choose', async () => {
		const p = await vscode.window.showQuickPick([{ label: 'Default', v: 'default' }, { label: 'Vim', v: 'vim' }, { label: 'Emacs', v: 'emacs' }], { placeHolder: 'Keymap' });
		if (p) { await vscode.workspace.getConfiguration('axiora').update('keymap', p.v, vscode.ConfigurationTarget.Global); }
	}));
	apply();
}
