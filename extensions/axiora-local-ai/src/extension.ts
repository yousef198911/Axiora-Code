/*---------------------------------------------------------------------------------------------
 *  Axiora Local AI - local-first AI features that work without a Copilot account.
 *--------------------------------------------------------------------------------------------*/
import { toolLoop, setLastReply } from './tools';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { chat, ChatMessage, complete, initLlm, listModels } from './llm';
import { chatCommands, contextProviders } from './util';
import { awake } from './keepAwake';
import { setPrompt } from './liveContext';
import { systemPrompt, compact } from './promptOps';
import { activateFeatures } from './features';

const out = vscode.window.createOutputChannel('Axiora Local AI', { log: true });
const enc = new TextEncoder();
const dec = new TextDecoder();

function root(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }

function git(args: string[], cwd: string, input?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const p = cp.execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
		if (input !== undefined) { p.stdin?.end(input); }
	});
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try { return dec.decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
}
async function writeText(uri: vscode.Uri, s: string) {
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	await vscode.workspace.fs.writeFile(uri, enc.encode(s));
}

// ---------------------------------------------------------------- inline completion
class LocalInlineProvider implements vscode.InlineCompletionItemProvider {
	private ac: AbortController | undefined;
	async provideInlineCompletionItems(doc: vscode.TextDocument, pos: vscode.Position, _ctx: vscode.InlineCompletionContext, token: vscode.CancellationToken) {
		const c = vscode.workspace.getConfiguration('axiora.inlineCompletion');
		if (!c.get<boolean>('enabled', true)) { return; }
		await new Promise(r => setTimeout(r, c.get<number>('debounceMs', 300)));
		if ((globalThis as { axioraNextEdit?: boolean }).axioraNextEdit) { return; } // a pending Next Edit owns Tab
		if (token.isCancellationRequested) { return; }
		this.ac?.abort();
		const ac = this.ac = new AbortController();
		token.onCancellationRequested(() => ac.abort());
		const start = new vscode.Position(Math.max(0, pos.line - 100), 0);
		const end = new vscode.Position(Math.min(doc.lineCount - 1, pos.line + 50), 10000);
		const prefix = doc.getText(new vscode.Range(start, pos));
		const suffix = doc.getText(new vscode.Range(pos, end));
		try {
			let text = await complete(prefix, suffix, c.get<string>('model', 'qwen2.5-coder:0.5b'), c.get<number>('maxTokens', 64), ac.signal);
			text = text.replace(/\s+$/, '');
			if (!text || token.isCancellationRequested) { return; }
			out.debug(`inline completion (${text.length} chars) at ${doc.uri.fsPath}:${pos.line + 1}`);
			return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
		} catch (e) {
			if (!ac.signal.aborted) { out.warn(`inline completion failed: ${(e as Error).message}`); }
			return;
		}
	}
}

// ---------------------------------------------------------------- checkpoints
const CP_PREFIX = 'refs/axiora/checkpoints/';
async function createCheckpoint(label?: string): Promise<string | undefined> {
	const r = root(); if (!r) { return; }
	const cwd = r.fsPath;
	// Snapshot the full working tree (tracked + untracked, respecting .gitignore) without touching index/HEAD.
	const tmpIndex = path.join(cwd, '.git', 'axiora-checkpoint-index');
	const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
	const run = (args: string[]) => new Promise<string>((res, rej) => cp.execFile('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
	try { await run(['read-tree', 'HEAD']); } catch { await run(['read-tree', '--empty']); }
	await run(['add', '-A']);
	const tree = (await run(['write-tree'])).trim();
	let parent: string[] = [];
	try { parent = ['-p', (await git(['rev-parse', 'HEAD'], cwd)).trim()]; } catch { /* no HEAD */ }
	const msg = `Axiora checkpoint: ${label || new Date().toLocaleString()}`;
	const commit = (await git(['-c', 'user.name=Axiora Checkpoints', '-c', 'user.email=checkpoints@axiora.local', 'commit-tree', tree, ...parent, '-m', msg], cwd)).trim();
	const name = `${CP_PREFIX}${Date.now()}`;
	await git(['update-ref', name, commit], cwd);
	out.info(`checkpoint ${name} -> ${commit} (${msg})`);
	return commit;
}
async function listCheckpoints(cwd: string) {
	const s = await git(['for-each-ref', '--sort=-refname', '--format=%(refname)\t%(objectname)\t%(contents:subject)', CP_PREFIX], cwd);
	return s.split('\n').filter(Boolean).map(l => { const [ref, sha, subject] = l.split('\t'); return { ref, sha, subject }; });
}
async function restoreCheckpoint() {
	const r = root(); if (!r) { return; }
	const items = await listCheckpoints(r.fsPath);
	if (!items.length) { vscode.window.showInformationMessage('No Axiora checkpoints yet.'); return; }
	const pick = await vscode.window.showQuickPick(items.map(i => ({ label: i.subject.replace('Axiora checkpoint: ', ''), description: i.sha.slice(0, 8), i })), { placeHolder: 'Restore workspace files to checkpoint' });
	if (!pick) { return; }
	const ok = await vscode.window.showWarningMessage(`Restore files to "${pick.label}"? A safety checkpoint of the current state is created first.`, { modal: true }, 'Restore');
	if (ok !== 'Restore') { return; }
	await createCheckpoint('before restore');
	await git(['restore', `--source=${pick.i.sha}`, '--worktree', '--', '.'], r.fsPath);
	// remove files created after the checkpoint
	const created = await git(['diff', '--name-only', '--diff-filter=A', pick.i.sha, (await createCheckpoint('restore-scan'))!], r.fsPath);
	for (const f of created.split('\n').filter(Boolean)) { await vscode.workspace.fs.delete(vscode.Uri.joinPath(r, f)).then(undefined, () => undefined); }
	vscode.window.showInformationMessage(`Restored checkpoint "${pick.label}".`);
}

// ---------------------------------------------------------------- memory
function memoryUri() { const r = root(); return r && vscode.Uri.joinPath(r, '.axiora', 'memory.md'); }
async function addMemory(note: string) {
	const u = memoryUri(); if (!u) { return; }
	const cur = (await readText(u)) ?? '# Axiora project memory\n\nNotes the agent always keeps in mind for this project.\n\n';
	await writeText(u, `${cur.replace(/\s*$/, '\n')}- ${note.trim()} _(${new Date().toISOString().slice(0, 10)})_\n`);
}
async function memoryContext(): Promise<string> {
	if (!vscode.workspace.getConfiguration('axiora.memory').get('enabled', true)) { return ''; }
	const u = memoryUri(); const m = u && await readText(u);
	return m ? `\n\nProject memory (always respect):\n${m.slice(0, 6000)}` : '';
}
const SYSTEM = 'You are Axiora, a precise senior software engineer assistant inside the Axiora code editor. Answer concisely in the user\'s language. Use Markdown.';

// ---------------------------------------------------------------- review
async function diffForReview(): Promise<string> {
	const r = root(); if (!r) { throw new Error('Open a folder first.'); }
	let d = await git(['diff', 'HEAD', '--no-color', '-U3'], r.fsPath).catch(() => '');
	const untracked = (await git(['ls-files', '--others', '--exclude-standard'], r.fsPath).catch(() => '')).split('\n').filter(Boolean).slice(0, 20);
	for (const f of untracked) { const t = await readText(vscode.Uri.joinPath(r, f)); if (t && t.length < 20000) { d += `\n+++ new file ${f}\n${t}`; } }
	return d.slice(0, 60000);
}
function reviewPrompt(diff: string): ChatMessage[] {
	return [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Review these uncommitted changes like a strict code reviewer. List concrete issues (bugs, security, performance, readability) as "- [severity] file:line — problem → fix". End with a one-line verdict.\n\n\`\`\`diff\n${diff}\n\`\`\`` }];
}

// ---------------------------------------------------------------- specs
function slug(s: string) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'spec'; }
const SPEC_STEPS: { file: string; ask: string }[] = [
	{ file: 'requirements.md', ask: 'Write requirements.md: user stories with acceptance criteria in EARS format ("WHEN ... THE SYSTEM SHALL ...").' },
	{ file: 'design.md', ask: 'Write design.md: architecture, components, data models, interfaces, error handling and testing strategy, based on the requirements.' },
	{ file: 'tasks.md', ask: 'Write tasks.md: a checklist of small implementation tasks, formatted EXACTLY "- [ ] T1. title (REQ-1, REQ-2)" (ids T1, T2, …), each referencing requirement numbers.' },
];
async function generateSpec(feature: string, onProgress: (s: string) => void, token?: vscode.CancellationToken): Promise<vscode.Uri> {
	const r = root(); if (!r) { throw new Error('Open a folder first.'); }
	const dir = vscode.Uri.joinPath(r, '.axiora', 'specs', slug(feature));
	const history: ChatMessage[] = [{ role: 'system', content: SYSTEM + await memoryContext() }, { role: 'user', content: `Feature to plan: ${feature}` }];
	for (const step of SPEC_STEPS) {
		onProgress(`\n\n### ${step.file}\n\n`);
		history.push({ role: 'user', content: step.ask + ' Output only the Markdown document.' });
		const text = await chat(history, onProgress, token);
		history.push({ role: 'assistant', content: text });
		await writeText(vscode.Uri.joinPath(dir, step.file), text.replace(/^```(markdown|md)?\n|\n```\s*$/g, '') + '\n');
	}
	return dir;
}

// ---------------------------------------------------------------- settings sync
function userDir(ctx: vscode.ExtensionContext) { return vscode.Uri.joinPath(ctx.globalStorageUri, '..', '..'); }
async function syncPush(ctx: vscode.ExtensionContext, quiet = false) {
	const ep = vscode.workspace.getConfiguration('axiora.sync').get<string>('endpoint', '');
	if (!ep) { if (!quiet) { vscode.window.showWarningMessage('Set "axiora.sync.endpoint" to your sync server URL first.', 'Open Setting').then(a => a && vscode.commands.executeCommand('workbench.action.openSettings', 'axiora.sync')); } return; }
	const u = userDir(ctx);
	const payload = {
		version: 1, updatedAt: new Date().toISOString(),
		settings: await readText(vscode.Uri.joinPath(u, 'settings.json')) ?? '{}',
		keybindings: await readText(vscode.Uri.joinPath(u, 'keybindings.json')) ?? '[]',
		extensions: vscode.extensions.all.filter(e => !e.packageJSON.isBuiltin && !e.id.startsWith('vscode.')).map(e => e.id),
	};
	const token = await ctx.secrets.get('axiora.sync.token');
	const r = await fetch(ep, { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
	if (!r.ok) { throw new Error(`Sync upload failed: ${r.status}`); }
	out.info(`settings uploaded to ${ep}`);
	if (!quiet) { vscode.window.showInformationMessage('Settings uploaded to your server.'); }
}
async function syncPull(ctx: vscode.ExtensionContext) {
	const ep = vscode.workspace.getConfiguration('axiora.sync').get<string>('endpoint', '');
	if (!ep) { return syncPush(ctx); }
	const token = await ctx.secrets.get('axiora.sync.token');
	const r = await fetch(ep, { headers: token ? { authorization: `Bearer ${token}` } : {} });
	if (!r.ok) { throw new Error(`Sync download failed: ${r.status}`); }
	const p = await r.json() as { settings?: string; keybindings?: string; extensions?: string[] };
	const u = userDir(ctx);
	if (p.settings) { await writeText(vscode.Uri.joinPath(u, 'settings.json'), p.settings); }
	if (p.keybindings) { await writeText(vscode.Uri.joinPath(u, 'keybindings.json'), p.keybindings); }
	const missing = (p.extensions ?? []).filter(id => !vscode.extensions.getExtension(id));
	for (const id of missing) { await vscode.commands.executeCommand('workbench.extensions.installExtension', id).then(undefined, e => out.warn(`install ${id}: ${e}`)); }
	out.info(`settings downloaded from ${ep}; installed ${missing.length} extensions`);
	vscode.window.showInformationMessage(`Settings downloaded from your server${missing.length ? `, installing ${missing.length} extensions` : ''}.`);
}

// ---------------------------------------------------------------- activate
export function activate(ctx: vscode.ExtensionContext) {
	initLlm(ctx.secrets);
	const reg = (id: string, fn: (...a: any[]) => any) => ctx.subscriptions.push(vscode.commands.registerCommand(id, async (...a) => {
		try { return await fn(...a); } catch (e) { out.error(`${id}: ${(e as Error).message}`); vscode.window.showErrorMessage(`Axiora: ${(e as Error).message}`); }
	}));

	ctx.subscriptions.push(out, vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-remote' }], new LocalInlineProvider()));

	reg('axiora.ai.toggleInlineCompletion', async () => {
		const c = vscode.workspace.getConfiguration('axiora.inlineCompletion');
		const v = !c.get('enabled', true);
		await c.update('enabled', v, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Axiora local inline completion ${v ? 'enabled' : 'disabled'}.`);
	});
	reg('axiora.ai.setApiKey', async () => {
		const k = await vscode.window.showInputBox({ prompt: 'API key for the OpenAI-compatible provider (stored securely)', password: true, ignoreFocusOut: true });
		if (k !== undefined) { k ? await ctx.secrets.store('axiora.ai.apiKey', k) : await ctx.secrets.delete('axiora.ai.apiKey'); }
	});
	reg('axiora.ai.testConnection', async () => {
		const t = await chat([{ role: 'user', content: 'Reply with: OK' }], () => { });
		vscode.window.showInformationMessage(`Model replied: ${t.slice(0, 80)}`);
	});
	reg('axiora.checkpoint.create', async () => { const c = await createCheckpoint(); if (c) { vscode.window.showInformationMessage(`Checkpoint created (${c.slice(0, 8)}).`); } });
	reg('axiora.checkpoint.restore', restoreCheckpoint);
	reg('axiora.memory.add', async () => { const n = await vscode.window.showInputBox({ prompt: 'Note for the project memory (.axiora/memory.md)' }); if (n) { await addMemory(n); } });
	reg('axiora.memory.open', async () => { const u = memoryUri(); if (!u) { return; } if (!await readText(u)) { await addMemory('Memory created.'); } await vscode.window.showTextDocument(u); });
	reg('axiora.spec.new', async () => {
		const f = await vscode.window.showInputBox({ prompt: 'Describe the feature to plan (creates .axiora/specs/<name>/requirements.md, design.md, tasks.md)' });
		if (!f) { return; }
		const dir = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Axiora: writing spec…', cancellable: true }, (_p, tok) => generateSpec(f, () => { }, tok));
		await vscode.window.showTextDocument(vscode.Uri.joinPath(dir, 'requirements.md'));
	});
	reg('axiora.review.changes', async () => {
		const diff = await diffForReview();
		if (!diff.trim()) { vscode.window.showInformationMessage('No uncommitted changes to review.'); return; }
		const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Axiora review\n\n' });
		const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Axiora: reviewing changes…', cancellable: true }, async (_p, tok) => {
			let pending = '';
			const flush = async () => { if (pending) { const s = pending; pending = ''; await ed.edit(e => e.insert(doc.lineAt(doc.lineCount - 1).range.end, s)); } };
			const timer = setInterval(flush, 200);
			try { await chat(reviewPrompt(diff), s => pending += s, tok); } finally { clearInterval(timer); await flush(); }
		});
	});
	reg('axiora.sync.setToken', async () => { const t = await vscode.window.showInputBox({ prompt: 'Token for your settings-sync server', password: true }); if (t !== undefined) { await ctx.secrets.store('axiora.sync.token', t); } });
	reg('axiora.sync.push', () => syncPush(ctx));
	reg('axiora.sync.pull', () => syncPull(ctx));

	// auto checkpoint + auto sync
	let lastCp = 0;
	ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async d => {
		if (vscode.workspace.getConfiguration('axiora.checkpoints').get('autoOnSave', false) && Date.now() - lastCp > 5 * 60_000 && d.uri.scheme === 'file') {
			lastCp = Date.now(); await createCheckpoint('auto on save').catch(e => out.warn(`auto checkpoint: ${e.message}`));
		}
		const ud = userDir(ctx).fsPath;
		if (vscode.workspace.getConfiguration('axiora.sync').get('auto', false) && d.uri.fsPath.startsWith(ud)) { await syncPush(ctx, true).catch(e => out.warn(e.message)); }
	}));

	// language model provider: makes Ollama / OpenAI-compatible models selectable in the chat model picker (no Copilot account)
	const changed = new vscode.EventEmitter<void>();
	ctx.subscriptions.push(changed, vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('axiora.ai') && changed.fire()));
	ctx.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('axiora-local', {
		onDidChangeLanguageModelChatInformation: changed.event,
		async provideLanguageModelChatInformation() {
			return (await listModels()).map((id, i) => ({ id, name: id, family: 'axiora-local', version: '1', detail: 'Axiora Local', maxInputTokens: 32000, maxOutputTokens: 4096, capabilities: {}, isUserSelectable: true, isDefault: i === 0 } as vscode.LanguageModelChatInformation));
		},
		async provideLanguageModelChatResponse(model, messages, _opts, progress, token) {
			const msgs: ChatMessage[] = messages.map(m => ({
				role: m.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
				content: m.content.map(p => p instanceof vscode.LanguageModelTextPart ? p.value : '').join('')
			}));
			await chat(msgs, s => progress.report(new vscode.LanguageModelTextPart(s)), token, model.id);
		},
		async provideTokenCount(_m, text) { return Math.ceil((typeof text === 'string' ? text : JSON.stringify(text.content)).length / 4); }
	}));

	// @axiora chat participant
	const participant = vscode.chat.createChatParticipant('axiora.local', (req, _ctx, stream, token) => { setPrompt(req.prompt); (globalThis as any).axioraOnPrompt?.(req.command, req.prompt); vscode.commands.executeCommand('axiora.chats.save', _ctx.history, req.prompt).then(undefined, () => undefined); return awake(handleChat(req, _ctx, stream, token)); });
	async function handleChat(req: vscode.ChatRequest, _ctx: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
		try {
			switch (req.command) {
				case 'remember': await addMemory(req.prompt); stream.markdown(`Saved to \`.axiora/memory.md\`: ${req.prompt}`); return;
				case 'memory': { const u = memoryUri(); stream.markdown((u && await readText(u)) || '_Memory is empty. Use `/remember <note>`._'); return; }
				case 'checkpoint': { const c = await createCheckpoint(req.prompt || undefined); stream.markdown(c ? `Checkpoint \`${c.slice(0, 8)}\` created. Restore with **Axiora AI: Restore Checkpoint...**` : 'Open a git folder first.'); return; }
				case 'review': {
					const diff = await diffForReview();
					if (!diff.trim()) { stream.markdown('No uncommitted changes to review.'); return; }
					stream.progress('Reviewing uncommitted changes locally…');
					await chat(reviewPrompt(diff), s => stream.markdown(s), token); return;
				}
				case 'spec': {
					if (!req.prompt.trim()) { stream.markdown('Usage: `/spec <feature description>`'); return; }
					const dir = await generateSpec(req.prompt, s => stream.markdown(s), token);
					for (const s of SPEC_STEPS) { stream.reference(vscode.Uri.joinPath(dir, s.file)); }
					return;
				}
			}
			const extra = chatCommands.get(req.command ?? '');
			if (extra) { await extra(req, stream, token, _ctx); return; }
			let more = '';
			for (const p of contextProviders) { more += await p().catch(() => ''); }
			let msgs: ChatMessage[] = [{ role: 'system', content: await systemPrompt(SYSTEM) + await memoryContext() + more }];
			for (const h of _ctx.history) {
				if (h instanceof vscode.ChatRequestTurn) { msgs.push({ role: 'user', content: h.prompt }); }
				else if (h instanceof vscode.ChatResponseTurn) { msgs.push({ role: 'assistant', content: h.response.map(p => p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : '').join('') }); }
			}
			const ed = vscode.window.activeTextEditor;
			const sel = ed && !ed.selection.isEmpty ? `\n\nSelected code (${path.basename(ed.document.fileName)}):\n\`\`\`\n${ed.document.getText(ed.selection)}\n\`\`\`` : '';
			msgs.push({ role: 'user', content: req.prompt + sel });
			msgs = await compact(msgs, token, n => stream.progress(n));
			const reply = await toolLoop(msgs, stream, token);
			setLastReply(reply);
			if (reply.trim()) { stream.button({ command: 'axiora.voice.readAloud', arguments: [reply], title: '$(unmute) Read aloud' }); }
			if (vscode.workspace.getConfiguration('axiora.voice.tts').get('autoSpeak', false)) { void vscode.commands.executeCommand('axiora.voice.readAloud', reply); }
		} catch (e) {
			const msg = (e as Error).message;
			const friendly = /429/.test(msg) && /per-day|daily/i.test(msg) ? 'Your AI provider\'s **free daily limit is used up**. It resets in a few hours — or add credits, or switch to another key or Ollama.'
				: /429/.test(msg) ? 'The AI provider is **rate-limiting** right now. Wait a minute and try again.'
				: /401|403/.test(msg) ? 'The AI provider **rejected the key**. Paste a new one to continue.'
				: /ECONNREFUSED|fetch failed/i.test(msg) ? '**No AI model is reachable.** Paste one key (OpenRouter, Groq, Gemini, Anthropic or OpenAI) or start Ollama on your computer.'
				: `**Error:** ${msg.slice(0, 300)}`;
			const md = new vscode.MarkdownString(`${friendly}\n\n[Set Up AI](command:axiora.ai.setup) · [Connected Services](command:axiora.services.open)`); md.isTrusted = { enabledCommands: ['axiora.ai.setup', 'axiora.services.open'] };
			stream.markdown(md);
		}
	}
	ctx.subscriptions.push(participant);
	activateFeatures(ctx);
	out.info('Axiora Local AI activated');
}

export function deactivate() { }
