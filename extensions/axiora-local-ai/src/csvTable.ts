/*---------------------------------------------------------------------------------------------
 *  CSV/TSV table preview (live, sortable) opened beside the text editor.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

export function parseCsv(text: string, sep: string): string[][] {
	const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; } } else { cell += c; } }
		else if (c === '"') { q = true; }
		else if (c === sep) { row.push(cell); cell = ''; }
		else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') { i++; } row.push(cell); rows.push(row); row = []; cell = ''; }
		else { cell += c; }
	}
	if (cell || row.length) { row.push(cell); rows.push(row); }
	return rows;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function html(doc: vscode.TextDocument): string {
	const sep = doc.fileName.endsWith('.tsv') ? '\t' : (doc.getText().split('\n')[0].split(';').length > doc.getText().split('\n')[0].split(',').length ? ';' : ',');
	const rows = parseCsv(doc.getText(), sep).slice(0, 5000);
	const [head, ...body] = rows;
	return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:0}table{border-collapse:collapse;font-size:12px}
th,td{border:1px solid var(--vscode-panel-border);padding:3px 8px;white-space:nowrap}th{position:sticky;top:0;background:var(--vscode-editorGroupHeader-tabsBackground);cursor:pointer}
tr:nth-child(even) td{background:var(--vscode-list-hoverBackground)}td.n{text-align:right}</style></head><body><table id=t><thead><tr><th>#</th>${(head ?? []).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
${body.map((r, i) => `<tr><td class=n>${i + 1}</td>${r.map(c => `<td${/^-?[\d.,]+$/.test(c) ? ' class=n' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<script>document.querySelectorAll('th').forEach((th,ci)=>th.onclick=()=>{const tb=document.querySelector('tbody');const rs=[...tb.rows];const d=th.dataset.d=th.dataset.d==='1'?'-1':'1';
rs.sort((a,b)=>{const x=a.cells[ci].innerText,y=b.cells[ci].innerText;const nx=parseFloat(x),ny=parseFloat(y);return (isNaN(nx)||isNaN(ny)?x.localeCompare(y):nx-ny)*d});rs.forEach(r=>tb.appendChild(r))})</script></body></html>`;
}
export function activate(ctx: vscode.ExtensionContext) {
	register(ctx, 'axiora.csv.preview', async (uri?: vscode.Uri) => {
		const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
		if (!doc) { return; }
		const panel = vscode.window.createWebviewPanel('axiora.csv', `Table: ${doc.fileName.split(/[\\/]/).pop()}`, vscode.ViewColumn.Beside, { enableScripts: true });
		panel.webview.html = html(doc);
		const sub = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === doc) { panel.webview.html = html(doc); } });
		panel.onDidDispose(() => sub.dispose());
	});
}
