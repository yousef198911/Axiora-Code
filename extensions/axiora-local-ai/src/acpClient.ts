/*---------------------------------------------------------------------------------------------
 *  External agents inside the editor:
 *  - ACP client (Agent Client Protocol, JSON-RPC over stdio): agents from axiora.acp.agents
 *    [{name, command, args, authMethod?}] (e.g. Gemini CLI --experimental-acp, claude-code-acp, Goose…)
 *    stream into chat via "/acp [name] <prompt>"; their file reads/writes go through the editor
 *    and writes ask for permission.
 *  - Cursor is registered automatically from the CLI downloaded into app data
 *    (`agent acp`), unless Settings already lists an agent named "cursor".
 *    After initialize, Cursor is sent authenticate { methodId: "cursor_login" }.
 *    Other agents are authenticated only when they advertise authMethods.
 *  - Run External Agent CLI: detects claude / codex / gemini / aider / opencode / goose / agent on
 *    PATH and starts it in an editor terminal for the current folder.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loginUrlFromAuthResult, selectAcpAuthMethod } from './acpAuth';
import { cursorExecutableNow, ensureCursorCli, openCursorLoginUrl } from './cursorCli';
import { chatCommands, register, wsRoot } from './util';

type Agent = { name: string; command: string; args?: string[]; authMethod?: string };
const onPath = (c: string) => (process.env.PATH ?? '').split(path.delimiter).concat(path.join(process.env.HOME ?? '', '.local', 'bin')).some(d => { try { return fs.statSync(path.join(d, c)).isFile(); } catch { return false; } });
export class AcpConnection {
	private p: cp.ChildProcess; private id = 0; private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>(); private buf = '';
	onUpdate: (u: any) => void = () => undefined; onRequest: (method: string, params: any) => Promise<any> = async () => ({}); onNotify: (method: string, params: any) => void = () => undefined; stderr = '';
	/** While true, an https URL on stderr is treated as the Cursor login page. */
	watchLoginUrls = false;
	constructor(a: Agent, cwd: string) {
		this.p = cp.spawn(a.command, a.args ?? [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_OPEN_BROWSER: '1', PATH: `${process.env.PATH}${path.delimiter}${path.join(process.env.HOME ?? '', '.local', 'bin')}` } });
		this.p.stderr!.on('data', d => {
			this.stderr = (this.stderr + d).slice(-4000);
			if (!this.watchLoginUrls) { return; }
			const match = /https:\/\/[^\s'")]+/.exec(this.stderr);
			if (match) { openCursorLoginUrl(match[0].replace(/[.,)]$/, '')); }
		});
		this.p.on('exit', c => { for (const v of this.pending.values()) { v.rej(new Error(`agent exited (${c}) ${this.stderr.slice(-300)}`)); } this.pending.clear(); });
		this.p.on('error', e => { for (const v of this.pending.values()) { v.rej(e); } this.pending.clear(); });
		this.p.stdout!.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (l) { try { void this.handle(JSON.parse(l)); } catch { /* not json */ } } } });
	}
	private send(o: any) { this.p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n'); }
	private async handle(m: any) {
		if (m.id !== undefined && (m.result !== undefined || m.error) && this.pending.has(m.id)) { const p = this.pending.get(m.id)!; this.pending.delete(m.id); return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
		if (m.method === 'session/update') { return this.onUpdate(m.params?.update); }
		if (m.method && m.id === undefined) { return this.onNotify(m.method, m.params); }
		if (m.method && m.id !== undefined) { try { this.send({ id: m.id, result: await this.onRequest(m.method, m.params) }); } catch (e) { this.send({ id: m.id, error: { code: -32603, message: (e as Error).message } }); } }
	}
	request(method: string, params: any): Promise<any> { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.send({ id, method, params }); }); }
	notify(method: string, params: any) { this.send({ method, params }); }
	kill() { this.p.kill(); }
}

async function cursorAgent(): Promise<Agent | undefined> {
	if (!vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true)) { return undefined; }
	const command = cursorExecutableNow() ?? await ensureCursorCli();
	return { name: 'cursor', command, args: ['acp'], authMethod: 'cursor_login' };
}

export function activate(ctx: vscode.ExtensionContext) {
	const agents = () => vscode.workspace.getConfiguration('axiora.acp').get<Agent[]>('agents', []);
	const sessions = new Map<string, { c: AcpConnection; sid: string }>();
	ctx.subscriptions.push({ dispose: () => sessions.forEach(s => s.c.kill()) });
	chatCommands.set('acp', async (req, stream, token) => {
		const configured = agents();
		const first = req.prompt.trim().split(/\s+/)[0];
		const cursorOn = vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true);
		if (first === 'cursor' && !cursorOn && !configured.some(a => a.name === 'cursor')) { stream.markdown(vscode.l10n.t("Cursor Agent is turned off in Settings (axiora.cursor.enabled).")); return; }
		const needCursor = cursorOn && !configured.some(a => a.name === 'cursor') && (first === 'cursor' || !configured.length || !!cursorExecutableNow());
		let builtin: Agent | undefined;
		if (needCursor) {
			try { builtin = await cursorAgent(); } catch (e) {
				if (first === 'cursor' || !configured.length) { stream.markdown(vscode.l10n.t("Cursor CLI is not ready: {0}", (e as Error).message)); return; }
			}
		}
		const all = builtin ? [builtin, ...configured] : configured;
		if (!all.length) { stream.markdown(vscode.l10n.t("No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. Cursor is added automatically once its CLI has downloaded.")); return; }
		const named = all.find(x => x.name === first);
		const a = named ?? configured[0] ?? all[0];
		const prompt = named ? req.prompt.trim().slice(first.length).trim() : req.prompt.trim();
		const root = wsRoot()?.fsPath ?? process.cwd();
		let s = sessions.get(a.name);
		if (!s) {
			stream.progress(vscode.l10n.t("Starting {0} (ACP)…", a.name)); const c = new AcpConnection(a, root);
			c.onRequest = async (method, p) => {
				if (method === 'fs/read_text_file') { const d = await vscode.workspace.openTextDocument(vscode.Uri.file(p.path)); const L = d.getText().split('\n'); return { content: p.line ? L.slice(p.line - 1, p.limit ? p.line - 1 + p.limit : undefined).join('\n') : d.getText() }; }
				if (method === 'fs/write_text_file') { const ok = await vscode.window.showWarningMessage(vscode.l10n.t("{0} wants to write {1}", a.name, vscode.workspace.asRelativePath(p.path)), { modal: true }, vscode.l10n.t("Allow")); if (ok !== vscode.l10n.t("Allow")) { throw new Error('denied by user'); } fs.mkdirSync(path.dirname(p.path), { recursive: true }); fs.writeFileSync(p.path, p.content); return null; }
				if (method === 'session/request_permission') { const opts = (p.options ?? []) as { optionId: string; name: string; kind: string }[]; const pick = await vscode.window.showQuickPick(opts.map(o => ({ label: o.name, description: o.kind, o })), { placeHolder: `${a.name}: ${p.toolCall?.title ?? 'permission requested'}` }); return { outcome: pick ? { outcome: 'selected', optionId: pick.o.optionId } : { outcome: 'cancelled' } }; }
				if (method === 'cursor/ask_question') {
					const questions = (p.questions ?? []) as { id: string; prompt: string; options: { id: string; label: string }[]; allowMultiple?: boolean }[];
					const answers: { questionId: string; selectedOptionIds: string[] }[] = [];
					for (const q of questions) {
						const picks = await vscode.window.showQuickPick(q.options.map(o => ({ label: o.label, id: o.id })), { title: p.title, placeHolder: q.prompt, canPickMany: !!q.allowMultiple });
						const selected = Array.isArray(picks) ? picks : picks ? [picks] : [];
						if (!selected.length) { return { outcome: { outcome: 'cancelled' } }; }
						answers.push({ questionId: q.id, selectedOptionIds: selected.map(o => o.id) });
					}
					return { outcome: { outcome: 'answered', answers } };
				}
				if (method === 'cursor/create_plan') {
					const ok = await vscode.window.showInformationMessage(p.name || vscode.l10n.t("Cursor plan"), { modal: true, detail: String(p.overview ?? p.plan ?? '').slice(0, 1500) }, vscode.l10n.t("Accept"));
					return { outcome: ok === vscode.l10n.t("Accept") ? { outcome: 'accepted' } : { outcome: 'rejected' } };
				}
				throw new Error(`unsupported: ${method}`);
			};
			const init = await c.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }, clientInfo: { name: 'axiora-code', version: '1.0.0' } });
			const methodId = selectAcpAuthMethod(a, init);
			if (methodId) {
				stream.progress(vscode.l10n.t("Signing in to {0}…", a.name));
				c.watchLoginUrls = true;
				try {
					const auth = await c.request('authenticate', { methodId });
					const url = loginUrlFromAuthResult(auth);
					if (url) { openCursorLoginUrl(url); }
				} finally { c.watchLoginUrls = false; }
			}
			const r = await c.request('session/new', { cwd: root, mcpServers: [] }); s = { c, sid: r.sessionId }; sessions.set(a.name, s);
		}
		const cur = s;
		cur.c.onUpdate = u => {
			if (!u) { return; }
			if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') { stream.markdown(u.content.text); }
			else if (u.sessionUpdate === 'agent_thought_chunk' && u.content?.text) { stream.progress(u.content.text.slice(0, 80)); }
			else if (u.sessionUpdate === 'tool_call') { stream.markdown(`\n\n> 🔧 ${u.title ?? u.kind ?? 'tool'}${u.status ? ` · ${u.status}` : ''}\n\n`); }
			else if (u.sessionUpdate === 'plan' && u.entries) { stream.markdown(vscode.l10n.t("\n\n**Plan:**\n{0}\n\n", u.entries.map((e: any) => `- [${e.status === 'completed' ? 'x' : ' '}] ${e.content}`).join('\n'))); }
		};
		cur.c.onNotify = (method, p) => {
			if (method === 'cursor/update_todos' && Array.isArray(p?.todos)) { stream.progress(p.todos.map((t: { content?: string; status?: string }) => `${t.status ?? ''} ${t.content ?? ''}`).join(' · ').slice(0, 120)); }
			else if (method === 'cursor/task') { stream.markdown(`\n\n> ${p?.description ?? 'task'}\n\n`); }
			else if (method === 'cursor/generate_image') { stream.markdown(`\n\n> ${p?.description ?? 'image'}${p?.filePath ? ` · ${p.filePath}` : ''}\n\n`); }
		};
		token.onCancellationRequested(() => cur.c.notify('session/cancel', { sessionId: cur.sid }));
		const res = await cur.c.request('session/prompt', { sessionId: cur.sid, prompt: [{ type: 'text', text: prompt }] });
		stream.markdown(`\n\n_${a.name} · ${res?.stopReason ?? 'done'}_`);
	});
	register(ctx, 'axiora.agents.externalCli', async () => {
		const known = [['claude', 'Claude Code'], ['codex', 'OpenAI Codex CLI'], ['gemini', 'Gemini CLI'], ['aider', 'Aider'], ['opencode', 'opencode'], ['goose', 'Goose'], ['agent', 'Cursor Agent'], ['axiora-agent', 'Axiora headless agent']];
		const cursorExe = vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true) ? cursorExecutableNow() : undefined;
		const found = known.filter(([c]) => c === 'agent' ? !!cursorExe || onPath(c) : onPath(c));
		const items = [...found.map(([c, n]) => ({ label: `$(terminal) ${n}`, description: c, c })), ...known.filter(k => !found.includes(k)).map(([c, n]) => ({ label: `$(circle-slash) ${n}`, description: `${c} — not installed`, c: '' }))];
		const p = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t("Run an external agent CLI in the editor") }); if (!p?.c) { return; }
		let cmd = p.c === 'axiora-agent' ? 'axiora-agent --help' : p.c;
		if (p.c === 'agent') { const exe = cursorExe ?? await ensureCursorCli(); cmd = exe.includes(' ') ? `"${exe}"` : exe; }
		const t = vscode.window.createTerminal({ name: p.description!, cwd: wsRoot()?.fsPath, location: vscode.TerminalLocation.Editor }); t.show(); t.sendText(cmd);
	});
}
