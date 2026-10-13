/*---------------------------------------------------------------------------------------------
 *  Built-in EditorConfig support (indent_style, indent_size/tab_width, end_of_line,
 *  trim_trailing_whitespace, insert_final_newline).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function globRe(g: string): RegExp {
	let r = '';
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === '*') { if (g[i + 1] === '*') { r += '.*'; i++; } else { r += '[^/]*'; } }
		else if (c === '?') { r += '[^/]'; }
		else if (c === '{') { const j = g.indexOf('}', i); r += `(${g.slice(i + 1, j).split(',').map(s => s.replace(/[.+^$()|\\]/g, '\\$&')).join('|')})`; i = j; }
		else if (c === '[') { const j = g.indexOf(']', i); r += g.slice(i, j + 1); i = j; }
		else { r += c.replace(/[.+^$()|\\/]/g, '\\$&'); }
	}
	return new RegExp(g.includes('/') ? `^${r}$` : `(^|/)${r}$`);
}
export function resolve(file: string): Record<string, string> {
	const chain: string[] = []; let dir = path.dirname(file);
	for (; ;) { const f = path.join(dir, '.editorconfig'); if (fs.existsSync(f)) { chain.unshift(f); if (/^\s*root\s*=\s*true/mi.test(fs.readFileSync(f, 'utf8'))) { break; } } const up = path.dirname(dir); if (up === dir) { break; } dir = up; }
	const out: Record<string, string> = {};
	for (const f of chain) {
		const base = path.dirname(f); const rel = path.relative(base, file).split(path.sep).join('/');
		let on = false;
		for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
			const l = raw.trim(); if (!l || l[0] === '#' || l[0] === ';') { continue; }
			const sec = /^\[(.*)\]$/.exec(l); if (sec) { on = globRe(sec[1]).test(rel); continue; }
			const kv = /^([^=]+)=(.*)$/.exec(l); if (on && kv) { out[kv[1].trim().toLowerCase()] = kv[2].trim().toLowerCase(); }
		}
	}
	return out;
}
export function activate(ctx: vscode.ExtensionContext) {
	const enabled = () => vscode.workspace.getConfiguration('axiora.editorconfig').get('enabled', true);
	const apply = (ed?: vscode.TextEditor) => {
		if (!ed || !enabled() || ed.document.uri.scheme !== 'file') { return; }
		const c = resolve(ed.document.uri.fsPath);
		if (c.indent_style) { ed.options.insertSpaces = c.indent_style === 'space'; }
		const size = c.indent_size === 'tab' ? c.tab_width : (c.indent_size ?? c.tab_width);
		if (size && /^\d+$/.test(size)) { ed.options.tabSize = +size; }
		if (c.end_of_line === 'lf' || c.end_of_line === 'crlf') { ed.edit(e => e.setEndOfLine(c.end_of_line === 'lf' ? vscode.EndOfLine.LF : vscode.EndOfLine.CRLF)); }
	};
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(apply));
	apply(vscode.window.activeTextEditor);
	ctx.subscriptions.push(vscode.workspace.onWillSaveTextDocument(e => {
		if (!enabled() || e.document.uri.scheme !== 'file') { return; }
		const c = resolve(e.document.uri.fsPath); const doc = e.document; const edits: vscode.TextEdit[] = [];
		if (c.trim_trailing_whitespace === 'true') { for (let i = 0; i < doc.lineCount; i++) { const t = doc.lineAt(i).text; const m = /\s+$/.exec(t); if (m) { edits.push(vscode.TextEdit.delete(new vscode.Range(i, m.index, i, t.length))); } } }
		if (c.insert_final_newline === 'true' && doc.getText().length && !/\n$/.test(doc.getText())) { edits.push(vscode.TextEdit.insert(doc.lineAt(doc.lineCount - 1).range.end, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')); }
		e.waitUntil(Promise.resolve(edits));
	}));
}
