/*---------------------------------------------------------------------------------------------
 *  Built-in lightweight Vim mode (setting axiora.keymap = "vim").
 *  Normal / Insert / Visual modes, counts, motions h j k l w b e 0 ^ $ gg G, operators d c y
 *  with motions (dw, cw, d$, ...) and doubled (dd, yy, cc), x X p P u Ctrl+R(redo) i a I A o O v V,
 *  r<char>, J, ., / ? n N, :w :q :wq :<line>.
 *  Text objects (iw aw iW i" a' i( a{ i[ i< ip ...), f F t T ; , %, marks m/'/`, >> <<, ~, D C Y s S,
 *  * #, H M L { }, zz zt zb, gd gr gh gc gt gT, :s/// :%s///g :noh :sp :vs :e <file>.
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

	function findChar(e: vscode.TextEditor, kind: string, ch: string, n: number): vscode.Position | undefined {
		const pos = e.selection.active; const t = e.document.lineAt(pos.line).text; let c = pos.character;
		const fwd = kind === 'f' || kind === 't';
		for (let i = 0; i < n; i++) {
			const from = fwd ? c + (kind === 't' && i === 0 ? 2 : 1) : c - (kind === 'T' && i === 0 ? 2 : 1);
			const idx = fwd ? t.indexOf(ch, from) : t.lastIndexOf(ch, from);
			if (idx < 0) { return undefined; } c = idx;
		}
		if (kind === 't') { c -= 1; } else if (kind === 'T') { c += 1; }
		return new vscode.Position(pos.line, c);
	}
	function textObject(e: vscode.TextEditor, ia: string, o: string): vscode.Range | undefined {
		const d = e.document, pos = e.selection.active, line = d.lineAt(pos.line).text;
		if (o === 'w' || o === 'W') {
			const re = o === 'w' ? /\w/ : /\S/; let a = pos.character, b = pos.character;
			const isW = (ch: string) => re.test(ch);
			const cls = isW(line[a] ?? ' ');
			while (a > 0 && isW(line[a - 1]) === cls && (cls || line[a - 1] !== undefined && !isW(line[a - 1]))) { a--; }
			while (b < line.length && isW(line[b]) === cls) { b++; }
			if (ia === 'a') { while (b < line.length && /\s/.test(line[b])) { b++; } }
			return new vscode.Range(pos.line, a, pos.line, b);
		}
		if (o === 'p') {
			let a = pos.line, b = pos.line; const blank = (l: number) => !d.lineAt(l).text.trim();
			while (a > 0 && !blank(a - 1)) { a--; } while (b < d.lineCount - 1 && !blank(b + 1)) { b++; }
			if (ia === 'a') { while (b < d.lineCount - 1 && blank(b + 1)) { b++; } }
			return new vscode.Range(a, 0, b, d.lineAt(b).text.length);
		}
		if ('"\'`'.includes(o)) {
			const c = pos.character; let a = line.lastIndexOf(o, line[c] === o ? c - 1 : c); let b = line.indexOf(o, Math.max(c, a + 1) + (line[c] === o && a < 0 ? 1 : 0));
			if (a < 0 && line[c] === o) { a = c; b = line.indexOf(o, c + 1); }
			if (a < 0 || b < 0) { return undefined; }
			return ia === 'i' ? new vscode.Range(pos.line, a + 1, pos.line, b) : new vscode.Range(pos.line, a, pos.line, b + 1);
		}
		const pairs: Record<string, [string, string]> = { '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'], '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'], '[': ['[', ']'], ']': ['[', ']'], '<': ['<', '>'], '>': ['<', '>'] };
		const pr = pairs[o]; if (!pr) { return undefined; }
		const text = d.getText(); let off = d.offsetAt(pos);
		{ const lo = line.indexOf(pr[0], pos.character); const inside = (() => { let dep = 0; for (let i = off; i >= 0; i--) { if (text[i] === pr[1] && i !== off) { dep++; } else if (text[i] === pr[0]) { if (dep === 0) { return true; } dep--; } } return false; })(); if (!inside && lo >= 0) { off = d.offsetAt(new vscode.Position(pos.line, lo)); } }
		let depth = 0, a = -1;
		for (let i = off; i >= 0; i--) { const ch = text[i]; if (ch === pr[1] && i !== off) { depth++; } else if (ch === pr[0]) { if (depth === 0) { a = i; break; } depth--; } }
		if (a < 0) { return undefined; }
		depth = 0; let b = -1;
		for (let i = a + 1; i < text.length; i++) { const ch = text[i]; if (ch === pr[0]) { depth++; } else if (ch === pr[1]) { if (depth === 0) { b = i; break; } depth--; } }
		if (b < 0) { return undefined; }
		return ia === 'i' ? new vscode.Range(d.positionAt(a + 1), d.positionAt(b)) : new vscode.Range(d.positionAt(a), d.positionAt(b + 1));
	}
	async function applyOp(e: vscode.TextEditor, o: string, r: vscode.Range) {
		reg = e.document.getText(r); regLine = false; await vscode.env.clipboard.writeText(reg);
		if (o === 'y') { e.selection = new vscode.Selection(r.start, r.start); return; }
		await e.edit(b => b.delete(r)); e.selection = new vscode.Selection(r.start, r.start);
		if (o === 'c') { setMode('insert'); }
	}
	const marks = new Map<string, { uri: vscode.Uri; pos: vscode.Position }>();
	let lastFind = '';
	async function handle(key: string): Promise<boolean> {
		if (!enabled() || mode === 'insert') { return false; }
		const e = ed(); if (!e) { return false; }
		let k = pending + key;
		const cm = /^(\d*)(.*)$/.exec(k)!; const n = Math.max(1, +(cm[1] || '1')); const cmd = cm[2];
		if (k === '0') { await exec('cursorLineStart'); return true; }
		if (cmd === '') { pending = k; return true; }
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
			if (rest === 'i' || rest === 'a' || /^[fFtT]$/.test(rest)) { pending = k; return true; }
			if (/^[ia].$/.test(rest)) { const r = textObject(e, rest[0], rest[1]); if (r) { await applyOp(e, o, r); lastChange = k; } pending = ''; return true; }
			if (/^[fFtT].$/.test(rest)) {
				const t = findChar(e, rest[0], rest[1], n); pending = '';
				if (t) { const a = e.selection.active; const r = rest[0] === 'f' || rest[0] === 't' ? new vscode.Range(a, t.translate(0, 1)) : new vscode.Range(t, a); await applyOp(e, o, r); lastChange = k; }
				return true;
			}
			if (rest === '%') { await exec('editor.action.selectToBracket'); await applyOp(e, o, e.selection); pending = ''; return true; }
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
		if (/^[fFtTm'`]$/.test(cmd) || cmd === 'z' || cmd === '>' || cmd === '<') { pending = k; return true; }
		if (/^[fFtT].$/.test(cmd)) { const t = findChar(e, cmd[0], cmd[1], n); lastFind = cmd; if (t) { e.selection = new vscode.Selection(t, t); } pending = ''; return true; }
		if (cmd === ';' || cmd === ',') {
			if (lastFind) { const rev: Record<string, string> = { f: 'F', F: 'f', t: 'T', T: 't' }; const kind = cmd === ';' ? lastFind[0] : rev[lastFind[0]]; const t = findChar(e, kind, lastFind[1], n); if (t) { e.selection = new vscode.Selection(t, t); } }
			pending = ''; return true;
		}
		if (/^m[a-zA-Z]$/.test(cmd)) { marks.set(cmd[1], { uri: e.document.uri, pos: e.selection.active }); pending = ''; return true; }
		if (/^['`][a-zA-Z]$/.test(cmd)) {
			const m = marks.get(cmd[1]); pending = '';
			if (m) { const te = await vscode.window.showTextDocument(m.uri); const p = cmd[0] === "'" ? new vscode.Position(m.pos.line, 0) : m.pos; te.selection = new vscode.Selection(p, p); te.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport); }
			return true;
		}
		if (cmd === 'zz' || cmd === 'zt' || cmd === 'zb') { await exec('revealLine', { lineNumber: e.selection.active.line, at: { zz: 'center', zt: 'top', zb: 'bottom' }[cmd] }); pending = ''; return true; }
		if (cmd === '>>' || cmd === '<<') { for (let i = 0; i < n; i++) { await exec(cmd === '>>' ? 'editor.action.indentLines' : 'editor.action.outdentLines'); } lastChange = k; pending = ''; return true; }
		if (cmd.length === 2 && (cmd[0] === '>' || cmd[0] === '<' || cmd[0] === 'z')) { pending = ''; return true; }
		if (cmd === 'g' || cmd === 'r') { pending = k; return true; }
		if (cmd.startsWith('r') && cmd.length === 2) {
			await e.edit(b => e.selections.forEach(s => b.replace(new vscode.Range(s.active, s.active.translate(0, 1)), cmd[1]))); lastChange = k; pending = ''; return true;
		}
		if (motionCmd[cmd]) { for (let i = 0; i < (cmd === 'G' || cmd === 'gg' ? 1 : n); i++) { await exec(motionCmd[cmd]); } if (cm[1] && (cmd === 'G' || cmd === 'gg')) { await exec('revealLine', { lineNumber: n - 1, at: 'center' }); const p = new vscode.Position(n - 1, 0); e.selection = new vscode.Selection(p, p); } pending = ''; return true; }
		pending = '';
		switch (cmd) {
			case '%': await exec('editor.action.jumpToBracket'); break;
			case '~': { const r = new vscode.Range(e.selection.active, e.selection.active.translate(0, n)); const t = e.document.getText(r); await e.edit(b => b.replace(r, [...t].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''))); await exec('cursorMove', { to: 'right', value: n }); lastChange = k; break; }
			case 'D': await exec('cursorEndSelect'); await applyOp(e, 'd', e.selection); lastChange = k; break;
			case 'C': await exec('cursorEndSelect'); await applyOp(e, 'c', e.selection); break;
			case 'Y': await lineOp('y', n); break;
			case 's': await exec('cursorRightSelect'); await applyOp(e, 'c', e.selection); break;
			case 'S': await lineOp('c', 1); break;
			case '*': case '#': await exec('editor.action.addSelectionToNextFindMatch'); await exec(cmd === '*' ? 'editor.action.nextMatchFindAction' : 'editor.action.previousMatchFindAction'); { const a = e.selection.start; e.selection = new vscode.Selection(a, a); } break;
			case 'gt': await exec('workbench.action.nextEditor'); break;
			case 'gT': await exec('workbench.action.previousEditor'); break;
			case 'gd': await exec('editor.action.revealDefinition'); break;
			case 'gr': await exec('editor.action.goToReferences'); break;
			case 'gh': await exec('editor.action.showHover'); break;
			case 'gc': await exec('editor.action.commentLine'); break;
			case 'H': await exec('cursorMove', { to: 'viewPortTop' }); break;
			case 'M': await exec('cursorMove', { to: 'viewPortCenter' }); break;
			case 'L': await exec('cursorMove', { to: 'viewPortBottom' }); break;
			case '{': await exec('cursorMove', { to: 'prevBlankLine', by: 'wrappedLine', value: n }); break;
			case '}': await exec('cursorMove', { to: 'nextBlankLine', by: 'wrappedLine', value: n }); break;
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
				else if (c && /^%?s\//.test(c)) {
					const m = /^(%?)s\/((?:\\\/|[^/])*)\/((?:\\\/|[^/])*)\/?([gi]*)$/.exec(c);
					if (m) {
						const re = new RegExp(m[2], 'g'.repeat(1) + (m[4].includes('i') ? 'i' : ''));
						const lines = m[1] ? [0, e.document.lineCount - 1] : [e.selection.active.line, e.selection.active.line];
						await e.edit(b => { for (let l = lines[0]; l <= lines[1]; l++) { const t = e.document.lineAt(l).text; let i = 0; const nt = t.replace(re, x => (m[4].includes('g') || i++ === 0) ? m[3].replace(/\\\//g, '/') : x); if (nt !== t) { b.replace(e.document.lineAt(l).range, nt); } } });
					}
				}
				else if (c === 'noh') { await exec('closeFindWidget'); }
				else if (c === 'sp' || c === 'split') { await exec('workbench.action.splitEditorDown'); }
				else if (c === 'vs' || c === 'vsplit') { await exec('workbench.action.splitEditorRight'); }
				else if (c?.startsWith('e ')) { const f = await vscode.workspace.findFiles(`**/${c.slice(2).trim()}`, '**/node_modules/**', 1); if (f[0]) { await vscode.window.showTextDocument(f[0]); } }
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
