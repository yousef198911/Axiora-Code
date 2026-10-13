/*---------------------------------------------------------------------------------------------
 *  Database tools: connections (SQLite built in via node:sqlite; PostgreSQL / MySQL via their
 *  CLIs), browse tables, run SQL from the editor (selection or whole file), results as a table.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { register } from './util';

interface Conn { name: string; kind: 'sqlite' | 'postgres' | 'mysql'; target: string }
type Result = { columns: string[]; rows: unknown[][]; info?: string };

async function query(c: Conn, sql: string): Promise<Result> {
	if (c.kind === 'sqlite') {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { prepare(s: string): { all(): Record<string, unknown>[]; run(): { changes: number } }; close(): void } };
		const db = new DatabaseSync(c.target);
		try {
			const st = db.prepare(sql);
			if (/^\s*(select|pragma|with|explain)/i.test(sql)) { const rows = st.all(); const columns = rows.length ? Object.keys(rows[0]) : []; return { columns, rows: rows.map(r => columns.map(k => r[k])) }; }
			const r = st.run(); return { columns: [], rows: [], info: `${r.changes} row(s) affected` };
		} finally { db.close(); }
	}
	const [cmd, args] = c.kind === 'postgres' ? ['psql', [c.target, '-A', '-F', '\t', '-P', 'footer=off', '-c', sql]] : ['mysql', [...c.target.split(' '), '-B', '-e', sql]];
	const out = await new Promise<string>((res, rej) => cp.execFile(cmd, args as string[], { maxBuffer: 64 << 20 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
	const lines = out.trim().split('\n'); const columns = (lines.shift() ?? '').split('\t');
	return { columns, rows: lines.map(l => l.split('\t')) };
}
const esc = (v: unknown) => String(v ?? 'NULL').replace(/&/g, '&amp;').replace(/</g, '&lt;');
function show(title: string, r: Result) {
	const p = vscode.window.createWebviewPanel('axiora.dbResult', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {});
	p.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px}table{border-collapse:collapse}th,td{border:1px solid var(--vscode-panel-border);padding:3px 8px;white-space:nowrap}th{position:sticky;top:0;background:var(--vscode-editorGroupHeader-tabsBackground)}</style></head><body>
<p>${r.info ?? `${r.rows.length} row(s)`}</p><table><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${r.rows.slice(0, 5000).map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}
export function activate(ctx: vscode.ExtensionContext) {
	const conns = () => ctx.globalState.get<Conn[]>('axiora.db.connections', []);
	const active = () => conns().find(c => c.name === ctx.workspaceState.get('axiora.db.active')) ?? conns()[0];
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
	status.command = 'axiora.db.select'; ctx.subscriptions.push(status);
	const refresh = () => { const a = active(); const sql = vscode.window.activeTextEditor?.document.languageId === 'sql'; if (a && sql) { status.text = `$(database) ${a.name}`; status.show(); } else { status.hide(); } };
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refresh)); refresh();

	register(ctx, 'axiora.db.add', async () => {
		const kind = (await vscode.window.showQuickPick(['sqlite', 'postgres', 'mysql'], { placeHolder: 'Database type' })) as Conn['kind'] | undefined; if (!kind) { return; }
		let target: string | undefined;
		if (kind === 'sqlite') { const f = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { SQLite: ['db', 'sqlite', 'sqlite3'], All: ['*'] }, openLabel: 'Use database' }); target = f?.[0].fsPath; }
		else { target = await vscode.window.showInputBox({ prompt: kind === 'postgres' ? 'Connection string (postgres://user:pass@host:5432/db) — requires psql' : 'mysql CLI args (-h host -u user -pPASS db) — requires mysql client' }); }
		if (!target) { return; }
		const name = await vscode.window.showInputBox({ prompt: 'Connection name', value: kind === 'sqlite' ? target.split(/[\\/]/).pop() : kind }); if (!name) { return; }
		await ctx.globalState.update('axiora.db.connections', [...conns().filter(c => c.name !== name), { name, kind, target }]);
		await ctx.workspaceState.update('axiora.db.active', name); refresh();
	});
	register(ctx, 'axiora.db.select', async () => {
		const p = await vscode.window.showQuickPick([...conns().map(c => ({ label: `$(database) ${c.name}`, description: c.kind, c })), { label: '$(add) Add Connection...', c: undefined }], { placeHolder: 'Database connection' });
		if (!p) { return; } if (!p.c) { await vscode.commands.executeCommand('axiora.db.add'); return; }
		await ctx.workspaceState.update('axiora.db.active', p.c.name); refresh();
	});
	register(ctx, 'axiora.db.runQuery', async () => {
		const ed = vscode.window.activeTextEditor; if (!ed) { return; }
		let c = active(); if (!c) { await vscode.commands.executeCommand('axiora.db.add'); c = active(); if (!c) { return; } }
		const sql = (ed.selection.isEmpty ? ed.document.getText() : ed.document.getText(ed.selection)).trim(); if (!sql) { return; }
		show(`${c.name}: result`, await query(c, sql));
	});
	register(ctx, 'axiora.db.browse', async () => {
		const c = active(); if (!c) { await vscode.commands.executeCommand('axiora.db.add'); return; }
		const listSql = c.kind === 'sqlite' ? `SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name` : c.kind === 'postgres' ? `SELECT table_schema||'.'||table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1` : 'SHOW TABLES';
		const r = await query(c, listSql);
		const t = await vscode.window.showQuickPick(r.rows.map(x => String(x[0])), { placeHolder: `Tables in ${c.name}` }); if (!t) { return; }
		show(`${c.name}: ${t}`, await query(c, `SELECT * FROM ${t} LIMIT 500`));
	});
}
