/*---------------------------------------------------------------------------------------------
 *  External agents inside the editor:
 *  - ACP client (Agent Client Protocol, JSON-RPC over stdio): agents from axiora.acp.agents
 *    [{name, command, args}] (e.g. Gemini CLI --experimental-acp, claude-code-acp, Goose…)
 *    stream into chat via "/acp [name] <prompt>"; their file reads/writes go through the editor
 *    and writes ask for permission.
 *  - Run External Agent CLI: detects claude / codex / gemini / aider / opencode / goose on
 *    PATH and starts it in an editor terminal for the current folder.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { chatCommands, register, wsRoot } from './util';

type Agent = { name: string; command: string; args?: string[] };
const onPath = (c: string) => (process.env.PATH ?? '').split(path.delimiter).concat(path.join(process.env.HOME ?? '', '.local', 'bin')).some(d => { try { return fs.statSync(path.join(d, c)).isFile(); } catch { return false; } });
export class AcpConnection {
	private p: cp.ChildProcess; private id = 0; private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>(); private buf = '';
	onUpdate: (u: any) => void = () => undefined; onRequest: (method: string, params: any) => Promise<any> = async () => ({}); stderr = '';
	constructor(a: Agent, cwd: string) {
		this.p = cp.spawn(a.command, a.args ?? [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: `${process.env.PATH}${path.delimiter}${path.join(process.env.HOME ?? '', '.local', 'bin')}` } });
		this.p.stderr!.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
		this.p.on('exit', c => { for (const v of this.pending.values()) { v.rej(new Error(`agent exited (${c}) ${this.stderr.slice(-300)}`)); } this.pending.clear(); });
		this.p.on('error', e => { for (const v of this.pending.values()) { v.rej(e); } this.pending.clear(); });
		this.p.stdout!.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (l) { try { void this.handle(JSON.parse(l)); } catch { /* not json */ } } } });
	}
	private send(o: any) { this.p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n'); }
	private async handle(m: any) {
		if (m.id !== undefined && (m.result !== undefined || m.error) && this.pending.has(m.id)) { const p = this.pending.get(m.id)!; this.pending.delete(m.id); return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
		if (m.method === 'session/update') { return this.onUpdate(m.params?.update); }
		if (m.method && m.id !== undefined) { try { this.send({ id: m.id, result: await this.onRequest(m.method, m.params) }); } catch (e) { this.send({ id: m.id, error: { code: -32603, message: (e as Error).message } }); } }
	}
	request(method: string, params: any): Promise<any> { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.send({ id, method, params }); }); }
	notify(method: string, params: any) { this.send({ method, params }); }
	kill() { this.p.kill(); }
}
export function activate(ctx: vscode.ExtensionContext) {
	const agents = () => vscode.workspace.getConfiguration('axiora.acp').get<Agent[]>('agents', []);
	const sessions = new Map<string, { c: AcpConnection; sid: string }>();
	ctx.subscriptions.push({ dispose: () => sessions.forEach(s => s.c.kill()) });
	chatCommands.set('acp', async (req, stream, token) => {
		const all = agents(); if (!all.length) { stream.markdown('No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ "name": "gemini", "command": "gemini", "args": ["--experimental-acp"] }`.'); return; }
		const first = req.prompt.trim().split(/\s+/)[0]; const a = all.find(x => x.name === first) ?? all[0]; const prompt = a.name === first ? req.prompt.trim().slice(first.length).trim() : req.prompt.trim();
		const root = wsRoot()?.fsPath ?? process.cwd();
		let s = sessions.get(a.name);
		if (!s) {
			stream.progress(`Starting ${a.name} (ACP)…`); const c = new AcpConnection(a, root);
			c.onRequest = async (method, p) => {
				if (method === 'fs/read_text_file') { const d = await vscode.workspace.openTextDocument(vscode.Uri.file(p.path)); const L = d.getText().split('\n'); return { content: p.line ? L.slice(p.line - 1, p.limit ? p.line - 1 + p.limit : undefined).join('\n') : d.getText() }; }
				if (method === 'fs/write_text_file') { const ok = await vscode.window.showWarningMessage(`${a.name} wants to write ${vscode.workspace.asRelativePath(p.path)}`, { modal: true }, 'Allow'); if (ok !== 'Allow') { throw new Error('denied by user'); } fs.mkdirSync(path.dirname(p.path), { recursive: true }); fs.writeFileSync(p.path, p.content); return null; }
				if (method === 'session/request_permission') { const opts = (p.options ?? []) as { optionId: string; name: string; kind: string }[]; const pick = await vscode.window.showQuickPick(opts.map(o => ({ label: o.name, description: o.kind, o })), { placeHolder: `${a.name}: ${p.toolCall?.title ?? 'permission requested'}` }); return { outcome: pick ? { outcome: 'selected', optionId: pick.o.optionId } : { outcome: 'cancelled' } }; }
				throw new Error(`unsupported: ${method}`);
			};
			await c.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
			const r = await c.request('session/new', { cwd: root, mcpServers: [] }); s = { c, sid: r.sessionId }; sessions.set(a.name, s);
		}
		const cur = s;
		cur.c.onUpdate = u => {
			if (!u) { return; }
			if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') { stream.markdown(u.content.text); }
			else if (u.sessionUpdate === 'agent_thought_chunk' && u.content?.text) { stream.progress(u.content.text.slice(0, 80)); }
			else if (u.sessionUpdate === 'tool_call') { stream.markdown(`\n\n> 🔧 ${u.title ?? u.kind ?? 'tool'}${u.status ? ` · ${u.status}` : ''}\n\n`); }
			else if (u.sessionUpdate === 'plan' && u.entries) { stream.markdown(`\n\n**Plan:**\n${u.entries.map((e: any) => `- [${e.status === 'completed' ? 'x' : ' '}] ${e.content}`).join('\n')}\n\n`); }
		};
		token.onCancellationRequested(() => cur.c.notify('session/cancel', { sessionId: cur.sid }));
		const res = await cur.c.request('session/prompt', { sessionId: cur.sid, prompt: [{ type: 'text', text: prompt }] });
		stream.markdown(`\n\n_${a.name} · ${res?.stopReason ?? 'done'}_`);
	});
	register(ctx, 'axiora.agents.externalCli', async () => {
		const known = [['claude', 'Claude Code'], ['codex', 'OpenAI Codex CLI'], ['gemini', 'Gemini CLI'], ['aider', 'Aider'], ['opencode', 'opencode'], ['goose', 'Goose'], ['axiora-agent', 'Axiora headless agent']];
		const found = known.filter(([c]) => onPath(c));
		const items = [...found.map(([c, n]) => ({ label: `$(terminal) ${n}`, description: c, c })), ...known.filter(k => !found.includes(k)).map(([c, n]) => ({ label: `$(circle-slash) ${n}`, description: `${c} — not installed`, c: '' }))];
		const p = await vscode.window.showQuickPick(items, { placeHolder: 'Run an external agent CLI in the editor' }); if (!p?.c) { return; }
		const t = vscode.window.createTerminal({ name: p.description!, cwd: wsRoot()?.fsPath, location: vscode.TerminalLocation.Editor }); t.show(); t.sendText(p.c === 'axiora-agent' ? 'axiora-agent --help' : p.c);
	});
}
