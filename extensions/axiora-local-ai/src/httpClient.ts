/*---------------------------------------------------------------------------------------------
 *  Built-in HTTP client for .http/.rest files ("Send Request" CodeLens, ### separated requests).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

const REQ = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i;
function block(doc: vscode.TextDocument, line: number): string[] {
	const out: string[] = [];
	for (let i = line; i < doc.lineCount; i++) { const t = doc.lineAt(i).text; if (i > line && t.startsWith('###')) { break; } out.push(t); }
	return out;
}
function vars(doc: vscode.TextDocument): Record<string, string> {
	const v: Record<string, string> = {};
	for (let i = 0; i < doc.lineCount; i++) { const m = /^@(\w+)\s*=\s*(.*)$/.exec(doc.lineAt(i).text); if (m) { v[m[1]] = m[2].trim(); } }
	return v;
}
export function activate(ctx: vscode.ExtensionContext) {
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'http' }, {
		provideCodeLenses(doc) {
			const lenses: vscode.CodeLens[] = [];
			for (let i = 0; i < doc.lineCount; i++) { if (REQ.test(doc.lineAt(i).text)) { lenses.push(new vscode.CodeLens(new vscode.Range(i, 0, i, 0), { title: '▶ Send Request', command: 'axiora.http.send', arguments: [doc.uri, i] })); } }
			return lenses;
		}
	}));
	register(ctx, 'axiora.http.send', async (uri?: vscode.Uri, line?: number) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
		if (!doc) { return; }
		if (line === undefined) { line = vscode.window.activeTextEditor!.selection.active.line; while (line > 0 && !REQ.test(doc.lineAt(line).text)) { line--; } }
		const v = vars(doc); const sub = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? process.env[k] ?? '');
		const lines = block(doc, line).map(sub);
		const m = REQ.exec(lines[0]); if (!m) { return; }
		const headers: Record<string, string> = {}; let i = 1;
		for (; i < lines.length && lines[i].trim(); i++) { const h = /^([\w-]+):\s*(.*)$/.exec(lines[i]); if (h) { headers[h[1]] = h[2]; } }
		const body = lines.slice(i + 1).join('\n').trim();
		const t0 = Date.now();
		const r = await fetch(m[2], { method: m[1].toUpperCase(), headers, body: body && !/GET|HEAD/i.test(m[1]) ? body : undefined });
		let text = await r.text();
		const ct = r.headers.get('content-type') ?? '';
		if (ct.includes('json')) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* raw */ } }
		const hdrs = [...r.headers].map(([k, val]) => `${k}: ${val}`).join('\n');
		const out = await vscode.workspace.openTextDocument({ language: ct.includes('json') ? 'json' : ct.includes('html') ? 'html' : 'plaintext', content: `${ct.includes('json') ? '// ' : ''}HTTP ${r.status} ${r.statusText} — ${Date.now() - t0} ms\n${ct.includes('json') ? hdrs.split('\n').map(h => '// ' + h).join('\n') : hdrs}\n\n${text}` });
		await vscode.window.showTextDocument(out, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
	});
}
