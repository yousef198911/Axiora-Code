/*---------------------------------------------------------------------------------------------
 *  Structural search & replace (comby-style holes :[name] that match balanced code).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

/** Compile a template like "foo(:[a], :[b])" into a regex with named groups matching balanced text. */
export function compile(tpl: string): RegExp {
	const bal = '(?:[^()\\[\\]{}"\'`]|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|\\((?:[^()]|\\([^()]*\\))*\\)|\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*?';
	let out = ''; const seen = new Set<string>(); let i = 0;
	const re = /:\[(\w+)\]/g; let m: RegExpExecArray | null;
	while ((m = re.exec(tpl))) {
		out += tpl.slice(i, m.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
		out += seen.has(m[1]) ? `\\k<${m[1]}>` : `(?<${m[1]}>${bal})`; seen.add(m[1]); i = m.index + m[0].length;
	}
	out += tpl.slice(i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
	return new RegExp(out, 'g');
}
export function substitute(tpl: string, groups: Record<string, string>) { return tpl.replace(/:\[(\w+)\]/g, (_, k) => groups[k] ?? ''); }

export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.structural.searchReplace', async () => {
		const find = await vscode.window.showInputBox({ prompt: 'Structural pattern (use :[name] holes)', placeHolder: 'console.log(:[x])' }); if (!find) { return; }
		const repl = await vscode.window.showInputBox({ prompt: 'Replacement (leave empty to only search)', placeHolder: 'logger.debug(:[x])' });
		const glob = await vscode.window.showInputBox({ prompt: 'Files to include', value: '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,c,cpp,php,rb}' }); if (!glob) { return; }
		const re = compile(find);
		const files = await vscode.workspace.findFiles(glob, '**/{node_modules,.git,out,dist}/**', 2000);
		const hits: { uri: vscode.Uri; range: vscode.Range; text: string; groups: Record<string, string> }[] = [];
		for (const f of files) {
			const doc = await vscode.workspace.openTextDocument(f); const t = doc.getText(); re.lastIndex = 0; let m: RegExpExecArray | null;
			while ((m = re.exec(t)) && hits.length < 5000) { if (!m[0]) { re.lastIndex++; continue; } hits.push({ uri: f, range: new vscode.Range(doc.positionAt(m.index), doc.positionAt(m.index + m[0].length)), text: m[0], groups: { ...m.groups } }); }
		}
		if (!hits.length) { vscode.window.showInformationMessage('No structural matches.'); return; }
		const picks = await vscode.window.showQuickPick(hits.map(h => ({ label: h.text.replace(/\s+/g, ' ').slice(0, 120), description: `${vscode.workspace.asRelativePath(h.uri)}:${h.range.start.line + 1}`, detail: repl ? `→ ${substitute(repl, h.groups).replace(/\s+/g, ' ').slice(0, 120)}` : undefined, picked: true, h })), { canPickMany: !!repl, placeHolder: repl ? `${hits.length} matches — choose which to replace` : `${hits.length} matches` });
		if (!picks) { return; }
		const arr = Array.isArray(picks) ? picks : [picks];
		if (!repl) { const h = arr[0].h; const ed = await vscode.window.showTextDocument(h.uri); ed.selection = new vscode.Selection(h.range.start, h.range.end); ed.revealRange(h.range); return; }
		const we = new vscode.WorkspaceEdit();
		for (const p of arr) { we.replace(p.h.uri, p.h.range, substitute(repl, p.h.groups)); }
		await vscode.workspace.applyEdit(we);
		vscode.window.showInformationMessage(`Replaced ${arr.length} structural matches (Undo available per file).`);
	});
}
