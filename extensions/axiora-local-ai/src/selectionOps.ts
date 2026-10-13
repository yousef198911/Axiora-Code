/*---------------------------------------------------------------------------------------------
 *  Selection-first editing (Kakoune/Helix style): select, then act on every selection.
 *  Selection menu → "Select Regex in Selections" (s), "Split Selections on Regex" (S),
 *  "Keep Selections Matching", "Remove Selections Matching", "Split Selections into Lines",
 *  "Trim Selections", "Merge Selections". Multi-cursor edits then apply to all.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

export function regexIn(text: string, re: RegExp): [number, number][] { const out: [number, number][] = []; for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) { if (m[0].length) { out.push([m.index!, m.index! + m[0].length]); } } return out; }
export function splitOn(text: string, re: RegExp): [number, number][] { const out: [number, number][] = []; let last = 0; for (const [a, b] of regexIn(text, re)) { if (a > last) { out.push([last, a]); } last = b; } if (last < text.length) { out.push([last, text.length]); } return out; }
export function activate(ctx: vscode.ExtensionContext) {
	const ranges = (ed: vscode.TextEditor) => ed.selections.some(s => !s.isEmpty) ? ed.selections.filter(s => !s.isEmpty) : [new vscode.Selection(0, 0, ed.document.lineCount, 0)];
	const askRe = async (key: string, prompt: string) => {
		const v = await vscode.window.showInputBox({ prompt, value: ctx.globalState.get(key, ''), placeHolder: 'regex, e.g. \\w+  or  ,\\s*' }); if (!v) { return undefined; }
		await ctx.globalState.update(key, v); try { return new RegExp(v, 'gm'); } catch (e) { vscode.window.showErrorMessage((e as Error).message); return undefined; }
	};
	const apply = (ed: vscode.TextEditor, f: (text: string) => [number, number][]) => {
		const sels: vscode.Selection[] = [];
		for (const r of ranges(ed)) { const base = ed.document.offsetAt(r.start); for (const [a, b] of f(ed.document.getText(r))) { sels.push(new vscode.Selection(ed.document.positionAt(base + a), ed.document.positionAt(base + b))); } }
		if (!sels.length) { vscode.window.setStatusBarMessage('No matches', 2000); return; }
		ed.selections = sels; vscode.window.setStatusBarMessage(`${sels.length} selection${sels.length > 1 ? 's' : ''}`, 2500);
	};
	register(ctx, 'axiora.sel.select', async () => { const ed = vscode.window.activeTextEditor; const re = ed && await askRe('axiora.sel.s', 'Select regex matches inside the selections'); if (ed && re) { apply(ed, t => regexIn(t, re)); } });
	register(ctx, 'axiora.sel.split', async () => { const ed = vscode.window.activeTextEditor; const re = ed && await askRe('axiora.sel.S', 'Split selections on regex (separators are dropped)'); if (ed && re) { apply(ed, t => splitOn(t, re)); } });
	register(ctx, 'axiora.sel.lines', () => { const ed = vscode.window.activeTextEditor; if (ed) { apply(ed, t => splitOn(t, /\r?\n/g)); } });
	const filter = async (keep: boolean) => {
		const ed = vscode.window.activeTextEditor; const re = ed && await askRe('axiora.sel.k', `${keep ? 'Keep' : 'Remove'} selections whose text matches`); if (!ed || !re) { return; }
		const sels = ed.selections.filter(s => { re.lastIndex = 0; return re.test(ed.document.getText(s)) === keep; });
		if (sels.length) { ed.selections = sels; } vscode.window.setStatusBarMessage(`${sels.length} selection(s) left`, 2500);
	};
	register(ctx, 'axiora.sel.keep', () => filter(true));
	register(ctx, 'axiora.sel.remove', () => filter(false));
	register(ctx, 'axiora.sel.trim', () => { const ed = vscode.window.activeTextEditor; if (!ed) { return; } ed.selections = ed.selections.map(s => { const t = ed.document.getText(s); const a = t.length - t.trimStart().length; const b = t.length - t.trimEnd().length; const o = ed.document.offsetAt(s.start); return t.trim() ? new vscode.Selection(ed.document.positionAt(o + a), ed.document.positionAt(o + t.length - b)) : s; }); });
	register(ctx, 'axiora.sel.merge', () => { const ed = vscode.window.activeTextEditor; if (!ed || ed.selections.length < 2) { return; } const s = ed.selections.reduce<vscode.Range>((a, b) => a.union(b), ed.selections[0]); ed.selections = [new vscode.Selection(s.start, s.end)]; });
}
