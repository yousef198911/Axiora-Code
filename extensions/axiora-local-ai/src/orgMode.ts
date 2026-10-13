/*---------------------------------------------------------------------------------------------
 *  Org mode: syntax, outline + folding by headings, TODO cycling, priority, checkboxes,
 *  promote/demote subtrees, timestamps, links, and an agenda of TODOs across the workspace.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

const H = /^(\*+)\s+(.*)$/;
const STATES = ['', 'TODO', 'DONE'];
export function activate(ctx: vscode.ExtensionContext) {
	const sel: vscode.DocumentSelector = { language: 'org' };
	ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(sel, {
		provideDocumentSymbols(doc) {
			const root: vscode.DocumentSymbol[] = []; const stack: { lvl: number; s: vscode.DocumentSymbol }[] = [];
			for (let i = 0; i < doc.lineCount; i++) {
				const m = H.exec(doc.lineAt(i).text); if (!m) { continue; }
				let end = doc.lineCount - 1; for (let j = i + 1; j < doc.lineCount; j++) { const n = H.exec(doc.lineAt(j).text); if (n && n[1].length <= m[1].length) { end = j - 1; break; } }
				const s = new vscode.DocumentSymbol(m[2], '', /^(TODO|NEXT)\b/.test(m[2]) ? vscode.SymbolKind.Event : vscode.SymbolKind.String, new vscode.Range(i, 0, end, doc.lineAt(end).text.length), doc.lineAt(i).range);
				while (stack.length && stack[stack.length - 1].lvl >= m[1].length) { stack.pop(); }
				(stack.length ? stack[stack.length - 1].s.children : root).push(s); stack.push({ lvl: m[1].length, s });
			}
			return root;
		}
	}));
	ctx.subscriptions.push(vscode.languages.registerFoldingRangeProvider(sel, {
		provideFoldingRanges(doc) {
			const r: vscode.FoldingRange[] = [];
			for (let i = 0; i < doc.lineCount; i++) { const m = H.exec(doc.lineAt(i).text); if (!m) { continue; } let e = doc.lineCount - 1; for (let j = i + 1; j < doc.lineCount; j++) { const n = H.exec(doc.lineAt(j).text); if (n && n[1].length <= m[1].length) { e = j - 1; break; } } if (e > i) { r.push(new vscode.FoldingRange(i, e)); } }
			return r;
		}
	}));
	const onLine = async (f: (t: string, line: number, ed: vscode.TextEditor) => string | undefined) => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		await ed.edit(b => { for (const s of ed.selections) { const l = ed.document.lineAt(s.active.line); const n = f(l.text, l.lineNumber, ed); if (n !== undefined && n !== l.text) { b.replace(l.range, n); } } });
	};
	register(ctx, 'axiora.org.cycleTodo', () => onLine(t => {
		const m = /^(\*+\s+)(TODO\s+|DONE\s+)?(.*)$/.exec(t);
		if (!m) { const c = /^(\s*[-+]\s+)\[( |X)\](.*)$/.exec(t); return c ? `${c[1]}[${c[2] === 'X' ? ' ' : 'X'}]${c[3]}` : undefined; }
		const cur = (m[2] ?? '').trim(); const next = STATES[(STATES.indexOf(cur) + 1) % STATES.length];
		let line = `${m[1]}${next ? next + ' ' : ''}${m[3]}`;
		if (next === 'DONE') { line += ''; }
		return line;
	}));
	register(ctx, 'axiora.org.priority', () => onLine(t => { const m = /^(\*+\s+(?:TODO\s+|DONE\s+)?)(\[#([ABC])\]\s+)?(.*)$/.exec(t); if (!m) { return undefined; } const n = { '': 'A', A: 'B', B: 'C', C: '' }[m[3] ?? ''] ?? ''; return `${m[1]}${n ? `[#${n}] ` : ''}${m[4]}`; }));
	register(ctx, 'axiora.org.promote', () => onLine(t => /^\*\*/.test(t) ? t.slice(1) : undefined));
	register(ctx, 'axiora.org.demote', () => onLine(t => /^\*/.test(t) ? '*' + t : undefined));
	register(ctx, 'axiora.org.timestamp', async () => { const ed = vscode.window.activeTextEditor; if (!ed) { return; } const d = new Date(); const s = `<${d.toISOString().slice(0, 10)} ${d.toLocaleDateString('en', { weekday: 'short' })}>`; await ed.edit(b => b.insert(ed.selection.active, s)); });
	register(ctx, 'axiora.org.agenda', async () => {
		const files = await vscode.workspace.findFiles('**/*.org', '**/node_modules/**', 500);
		const items: (vscode.QuickPickItem & { u: vscode.Uri; l: number })[] = [];
		for (const u of files) { const doc = await vscode.workspace.openTextDocument(u); for (let i = 0; i < doc.lineCount; i++) { const m = /^\*+\s+(TODO|NEXT|WAITING)\s+(.*)$/.exec(doc.lineAt(i).text); if (m) { const dl = /(?:DEADLINE|SCHEDULED):\s*<([^>]+)>/.exec(doc.lineAt(Math.min(i + 1, doc.lineCount - 1)).text); items.push({ label: `$(circle-large-outline) ${m[2]}`, description: `${m[1]}${dl ? ' · ' + dl[1] : ''}`, detail: vscode.workspace.asRelativePath(u), u, l: i }); } } }
		items.sort((a, b) => (a.description ?? '').localeCompare(b.description ?? ''));
		const p = await vscode.window.showQuickPick(items, { placeHolder: `Agenda: ${items.length} open items` });
		if (p) { const ed = await vscode.window.showTextDocument(p.u); const pos = new vscode.Position(p.l, 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos)); }
	});
	// [[link]] navigation
	ctx.subscriptions.push(vscode.languages.registerDocumentLinkProvider(sel, {
		provideDocumentLinks(doc) {
			const out: vscode.DocumentLink[] = []; const re = /\[\[([^\]]+)\](?:\[[^\]]+\])?\]/g;
			for (let i = 0; i < doc.lineCount; i++) { const t = doc.lineAt(i).text; let m; while ((m = re.exec(t))) { const tgt = m[1].replace(/^file:/, ''); const u = /^https?:/.test(tgt) ? vscode.Uri.parse(tgt) : vscode.Uri.joinPath(doc.uri, '..', tgt); out.push(new vscode.DocumentLink(new vscode.Range(i, m.index, i, m.index + m[0].length), u)); } }
			return out;
		}
	}));
}
