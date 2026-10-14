/*---------------------------------------------------------------------------------------------
 *  Expose the editor as an MCP server (Streamable HTTP, JSON responses) on 127.0.0.1 so
 *  external agents (Claude Code, Codex CLI, Cursor, ...) can use editor context.
 *  Off by default; bearer-token protected; writes need axiora.mcpServer.allowWrites.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { log, register, wsRoot } from './util';

type Json = Record<string, any>;
const tools = [
	{ name: 'get_open_editors', description: 'List files open in the editor and the active file.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'get_selection', description: 'Get the active file path, cursor position and selected text.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'read_file', description: 'Read a workspace file (path relative to the workspace root). Includes unsaved editor changes.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
	{ name: 'get_diagnostics', description: 'Errors/warnings from language servers, for one file or the whole workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
	{ name: 'find_files', description: 'Find workspace files by glob, e.g. **/*.ts', inputSchema: { type: 'object', properties: { glob: { type: 'string' } }, required: ['glob'] } },
	{ name: 'open_file', description: 'Open a file in the editor at an optional 1-based line.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' } }, required: ['path'] } },
	{ name: 'write_file', description: 'Replace a file\'s content through the editor (undoable). Requires axiora.mcpServer.allowWrites.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
];
function resolvePath(p: string): vscode.Uri {
	const r = wsRoot(); if (!r) { throw new Error('No workspace open'); }
	const u = vscode.Uri.joinPath(r, p.replace(/^\/+/, ''));
	if (!u.fsPath.startsWith(r.fsPath)) { throw new Error('Path outside workspace'); }
	return u;
}
async function callTool(name: string, a: Json): Promise<string> {
	switch (name) {
		case 'get_open_editors': return JSON.stringify({ active: vscode.window.activeTextEditor && vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri), open: vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as { uri?: vscode.Uri })?.uri).filter(Boolean).map(u => vscode.workspace.asRelativePath(u!)) }, null, 2);
		case 'get_selection': { const e = vscode.window.activeTextEditor; if (!e) { return 'No active editor'; } return JSON.stringify({ path: vscode.workspace.asRelativePath(e.document.uri), line: e.selection.active.line + 1, column: e.selection.active.character + 1, selectedText: e.document.getText(e.selection) }, null, 2); }
		case 'read_file': return (await vscode.workspace.openTextDocument(resolvePath(a.path))).getText();
		case 'get_diagnostics': {
			const list = a.path ? [[resolvePath(a.path), vscode.languages.getDiagnostics(resolvePath(a.path))] as const] : vscode.languages.getDiagnostics();
			return list.flatMap(([u, ds]) => ds.map(d => `${vscode.workspace.asRelativePath(u)}:${d.range.start.line + 1}: [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}`)).join('\n') || 'No problems';
		}
		case 'find_files': return (await vscode.workspace.findFiles(a.glob, '**/{node_modules,.git}/**', 500)).map(u => vscode.workspace.asRelativePath(u)).join('\n');
		case 'open_file': { const ed = await vscode.window.showTextDocument(resolvePath(a.path)); if (a.line) { const p = new vscode.Position(a.line - 1, 0); ed.selection = new vscode.Selection(p, p); ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter); } return 'opened'; }
		case 'write_file': {
			if (!vscode.workspace.getConfiguration('axiora.mcpServer').get('allowWrites', false)) { throw new Error('Writes are disabled (axiora.mcpServer.allowWrites = false)'); }
			const u = resolvePath(a.path); const we = new vscode.WorkspaceEdit();
			try { const d = await vscode.workspace.openTextDocument(u); we.replace(u, new vscode.Range(0, 0, d.lineCount, 0), a.content); } catch { we.createFile(u, { contents: new TextEncoder().encode(a.content) }); }
			await vscode.workspace.applyEdit(we); return 'written';
		}
	}
	throw new Error(`Unknown tool ${name}`);
}
async function rpc(m: Json): Promise<Json | undefined> {
	if (m.id === undefined) { return undefined; } // notification
	try {
		switch (m.method) {
			case 'initialize': return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'axiora-editor', version: '1.0.0' } } };
			case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} };
			case 'tools/list': return { jsonrpc: '2.0', id: m.id, result: { tools } };
			case 'tools/call': try { return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: await callTool(m.params.name, m.params.arguments ?? {}) }] } }; } catch (e) { return { jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: (e as Error).message }] } }; }
			default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
		}
	} catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: (e as Error).message } }; }
}
export function activate(ctx: vscode.ExtensionContext) {
	let server: http.Server | undefined;
	let token = ctx.globalState.get<string>('axiora.mcp.token') ?? crypto.randomBytes(24).toString('hex');
	ctx.globalState.update('axiora.mcp.token', token);
	const cfg = () => vscode.workspace.getConfiguration('axiora.mcpServer');
	const stop = () => { server?.close(); server = undefined; };
	const start = () => {
		stop(); if (!cfg().get('enabled', false)) { return; }
		const port = cfg().get<number>('port', 3917);
		server = http.createServer((req, res) => {
			if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
			if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
			let body = ''; req.on('data', c => body += c); req.on('end', async () => {
				try {
					const msg = JSON.parse(body); const replies = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map(rpc))).filter(Boolean);
					if (!replies.length) { res.writeHead(202).end(); return; }
					res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(msg) ? replies : replies[0]));
				} catch (e) { res.writeHead(400).end(String(e)); }
			});
		});
		server.on('error', e => log.error(`MCP server: ${e.message}`));
		server.listen(port, '127.0.0.1', () => log.info(`MCP server listening on http://127.0.0.1:${port}/mcp`));
	};
	ctx.subscriptions.push({ dispose: stop }, vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('axiora.mcpServer') && start()));
	start();
	register(ctx, 'axiora.mcp.copyConfig', async () => {
		if (!cfg().get('enabled', false)) { await cfg().update('enabled', true, vscode.ConfigurationTarget.Global); }
		const url = `http://127.0.0.1:${cfg().get('port', 3917)}/mcp`;
		const conf = JSON.stringify({ mcpServers: { axiora: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
		await vscode.env.clipboard.writeText(conf);
		vscode.window.showInformationMessage(vscode.l10n.t("Axiora MCP server running at {0}. Client config copied to clipboard.", url));
	});
	register(ctx, 'axiora.mcp.regenerateToken', async () => { token = crypto.randomBytes(24).toString('hex'); await ctx.globalState.update('axiora.mcp.token', token); vscode.window.showInformationMessage(vscode.l10n.t("New MCP token generated; run \"Copy Client Config\" again.")); });
}
