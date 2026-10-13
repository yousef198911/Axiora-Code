/*---------------------------------------------------------------------------------------------
 *  One-key onboarding + Connected Services + team file.
 *  - Paste ONE AI key anywhere (Settings › AI Models › AI Key, Welcome card, "Axiora: Set Up AI...",
 *    status bar): the provider is detected from the prefix, base URL + chat/inline models are set,
 *    the connection is tested and `axiora.aiReady` is published for the Welcome card.
 *  - Connected Services: one card per service; Connect asks only what that service needs.
 *  - .axiora/team.json (no secrets): service URLs, approved models, approval/policy — applied on open.
 *  Keys live in SecretStorage only; nothing secret is ever written to settings.json.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { register } from './util';

interface Provider { id: string; label: string; baseUrl: string; chat: string; completion: string; free?: boolean; models?: string[] }
const OPENROUTER_FREE = ['cohere/north-mini-code:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'qwen/qwen3-coder:free', 'meta-llama/llama-3.3-70b-instruct:free'];
export function detectProvider(key: string): Provider | undefined {
	const k = key.trim();
	if (k.startsWith('sk-or-')) { return { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', chat: OPENROUTER_FREE[0], completion: OPENROUTER_FREE[0], free: true, models: OPENROUTER_FREE }; }
	if (k.startsWith('gsk_')) { return { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', chat: 'llama-3.3-70b-versatile', completion: 'llama-3.1-8b-instant', free: true }; }
	if (k.startsWith('AIza')) { return { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', chat: 'gemini-2.5-flash', completion: 'gemini-2.5-flash-lite', free: true }; }
	if (k.startsWith('sk-ant-')) { return { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', chat: 'claude-sonnet-4-5', completion: 'claude-haiku-4-5' }; }
	if (k.startsWith('sk-')) { return { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', chat: 'gpt-4o-mini', completion: 'gpt-4o-mini' }; }
	return undefined;
}
const providerFromUrl = (u: string) => /openrouter/.test(u) ? 'OpenRouter' : /groq/.test(u) ? 'Groq' : /googleapis/.test(u) ? 'Google Gemini' : /anthropic/.test(u) ? 'Anthropic' : /openai\.com/.test(u) ? 'OpenAI' : 'OpenAI-compatible';

let ctx: vscode.ExtensionContext; let bar: vscode.StatusBarItem;
const conf = () => vscode.workspace.getConfiguration('axiora');
const G = vscode.ConfigurationTarget.Global;
let state: { ready: boolean; label: string; detail: string } = { ready: false, label: '', detail: '' };
const changed = new vscode.EventEmitter<void>();

async function setReady(ready: boolean, label: string, detail = '') {
	state = { ready, label, detail };
	await vscode.commands.executeCommand('setContext', 'axiora.aiReady', ready);
	await vscode.commands.executeCommand('setContext', 'axiora.aiProviderLabel', label);
	bar.text = '$(sparkle) Set Up AI'; bar.tooltip = 'No AI model is configured yet — paste one key to enable the assistant.';
	ready ? bar.hide() : bar.show();
	changed.fire();
}

async function ping(baseUrl: string, key: string | undefined, model: string): Promise<string> {
	const h: Record<string, string> = { 'content-type': 'application/json' }; if (key) { h.authorization = `Bearer ${key}`; }
	if (baseUrl.includes('openrouter.ai')) { h['x-title'] = 'Axiora Code'; h['http-referer'] = 'https://github.com/yousef198911/Axiora-Code'; }
	const r = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: h, signal: AbortSignal.timeout(45000), body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] }) });
	const t = await r.text();
	if (!r.ok) {
		if (r.status === 401 || r.status === 403) { throw new Error('the key was rejected — check it was copied completely.'); }
		if (r.status === 429) { throw new Error(/per-day|daily/i.test(t) ? 'the provider\'s free daily limit is used up — it resets in a few hours (or add credits).' : 'the provider is rate-limiting — try again in a minute.'); }
		throw new Error(`${r.status}: ${t.slice(0, 160)}`);
	}
	return t;
}

/** Validate the key against /models and choose the best available free model (OpenRouter). */
async function pickModel(p: Provider, key: string): Promise<Provider> {
	if (!p.models) { return p; }
	try {
		const r = await fetch(`${p.baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
		const ids = new Set(((await r.json()) as { data?: { id: string }[] }).data?.map(m => m.id) ?? []);
		const m = p.models.find(x => ids.has(x)) ?? [...ids].find(x => x.endsWith(':free'));
		if (m) { return { ...p, chat: m, completion: m }; }
	} catch { /* keep defaults */ }
	return p;
}

/** Store + configure + test. Returns a one-line status. */
export async function setUpWithKey(raw: string): Promise<{ ok: boolean; status: string }> {
	const key = raw.trim(); if (!key) { return { ok: false, status: 'Paste a key first.' }; }
	let p = detectProvider(key);
	if (!p) { return { ok: false, status: 'Unknown key format. Expected sk-or-… (OpenRouter), gsk_… (Groq), AIza… (Gemini), sk-ant-… (Anthropic) or sk-… (OpenAI).' }; }
	p = await pickModel(p, key);
	await ctx.secrets.store('axiora.ai.apiKey', key);
	const c = conf();
	await c.update('ai.provider', 'openai', G); await c.update('ai.baseUrl', p.baseUrl, G);
	await c.update('ai.chatModel', p.chat, G); await c.update('inlineCompletion.model', p.completion, G);
	try {
		await ping(p.baseUrl, key, p.chat);
		await setReady(true, `${p.label} · ${p.chat}`);
		return { ok: true, status: `✅ Assistant ready — ${p.label} · ${p.chat}${p.free ? ' (free)' : ''}` };
	} catch (e) {
		const rl = /rate-limiting|daily limit/.test((e as Error).message);
		await setReady(rl, `${p.label} · ${p.chat}`);
		return { ok: rl, status: `${rl ? '⚠️' : '❌'} ${p.label} detected, but ${(e as Error).message}` };
	}
}

export async function useOllama(): Promise<{ ok: boolean; status: string }> {
	const base = 'http://127.0.0.1:11434';
	try {
		const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
		const models = ((await r.json()) as { models?: { name: string }[] }).models?.map(m => m.name) ?? [];
		const c = conf(); await c.update('ai.provider', 'ollama', G); await c.update('ai.baseUrl', base, G);
		if (!models.length) { await setReady(false, 'Ollama'); return { ok: false, status: '⚠️ Ollama is running but has no models. Run: ollama pull qwen2.5-coder:1.5b' }; }
		const pick = (re: RegExp) => models.find(m => re.test(m)) ?? models[0];
		const chatM = pick(/coder|qwen|llama|mistral|gemma/i); const compM = pick(/coder/i);
		await c.update('ai.chatModel', chatM, G); await c.update('inlineCompletion.model', compM, G);
		await setReady(true, `Ollama · ${chatM}`);
		return { ok: true, status: `✅ Assistant ready — Ollama on this computer · ${chatM}` };
	} catch {
		return { ok: false, status: '❌ Ollama is not running on this computer. Install it from ollama.com, start it, then try again.' };
	}
}

async function refreshState() {
	const c = conf(); const key = await ctx.secrets.get('axiora.ai.apiKey');
	if (c.get('ai.provider', 'ollama') === 'ollama') {
		try { const r = await fetch(`${c.get('ai.baseUrl', 'http://127.0.0.1:11434')}/api/tags`, { signal: AbortSignal.timeout(2500) }); const n = ((await r.json()) as { models?: unknown[] }).models?.length ?? 0; return setReady(n > 0, `Ollama · ${c.get('ai.chatModel')}`); }
		catch { return setReady(false, ''); }
	}
	const base = c.get<string>('ai.baseUrl', ''); const local = /127\.0\.0\.1|localhost/.test(base);
	return setReady(!!key || local, `${providerFromUrl(base)} · ${c.get('ai.chatModel')}`);
}

// ---------------------------------------------------------------- services
type Field = { id: string; label: string; placeholder: string; secret?: boolean; setting?: string };
interface Service { id: string; name: string; blurb: string; secret: string; fields: Field[]; signIn?: string; test: (v: Record<string, string>) => Promise<string> }
async function j(url: string, init: RequestInit) { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); const t = await r.text(); if (!r.ok) { throw new Error(r.status === 401 || r.status === 403 ? 'token rejected' : `${r.status} ${t.slice(0, 120)}`); } return JSON.parse(t); }
const SERVICES: Service[] = [
	{ id: 'jira', name: 'Jira', blurb: 'Issues in chat with /jira', secret: 'axiora.connector.jira', fields: [{ id: 'site', label: 'Site', placeholder: 'https://acme.atlassian.net', setting: 'connectors.jira.site' }, { id: 'email', label: 'Email', placeholder: 'you@company.com', setting: 'connectors.jira.email' }, { id: 'token', label: 'API token', placeholder: 'Atlassian API token', secret: true }],
		test: async v => { const me = await j(`${v.site.replace(/\/$/, '')}/rest/api/3/myself`, { headers: { accept: 'application/json', authorization: 'Basic ' + Buffer.from(`${v.email}:${v.token}`).toString('base64') } }); return `Signed in as ${me.displayName}`; } },
	{ id: 'figma', name: 'Figma', blurb: 'Designs in chat with /figma', secret: 'axiora.connector.figma', fields: [{ id: 'token', label: 'Personal access token', placeholder: 'figd_…', secret: true }],
		test: async v => { const me = await j('https://api.figma.com/v1/me', { headers: { 'X-Figma-Token': v.token } }); return `Signed in as ${me.handle}`; } },
	{ id: 'slack', name: 'Slack', blurb: 'Workspace token for Slack-aware agent tools', secret: 'axiora.connector.slack', fields: [{ id: 'token', label: 'Bot or user token', placeholder: 'xoxb-… or xoxp-…', secret: true }],
		test: async v => { const r = await j('https://slack.com/api/auth.test', { method: 'POST', headers: { authorization: `Bearer ${v.token}` } }); if (!r.ok) { throw new Error(r.error); } return `Connected to ${r.team} as ${r.user}`; } },
	{ id: 'linear', name: 'Linear', blurb: 'Issues in chat with /linear', secret: 'axiora.connector.linear', fields: [{ id: 'token', label: 'Personal API key', placeholder: 'lin_api_…', secret: true }],
		test: async v => { const r = await j('https://api.linear.app/graphql', { method: 'POST', headers: { authorization: v.token, 'content-type': 'application/json' }, body: JSON.stringify({ query: '{viewer{name email}}' }) }); if (!r.data?.viewer) { throw new Error(r.errors?.[0]?.message ?? 'no viewer'); } return `Signed in as ${r.data.viewer.name}`; } },
	{ id: 'stripe', name: 'Stripe', blurb: 'Customers and payments with /stripe', secret: 'axiora.connector.stripe', fields: [{ id: 'token', label: 'Restricted key', placeholder: 'rk_live_… or rk_test_…', secret: true }],
		test: async v => { const b = await j('https://api.stripe.com/v1/balance', { headers: { authorization: `Bearer ${v.token}` } }); return `Connected (${b.livemode ? 'live' : 'test'} mode)`; } },
	{ id: 'google', name: 'Google', blurb: 'Gmail, Drive and Calendar', secret: 'axiora.google.refreshToken', fields: [], signIn: 'axiora.google.signIn',
		test: async () => 'Signed in' },
	{ id: 'github', name: 'GitHub', blurb: 'PRs, issues and reviews', secret: 'axiora.github.token', fields: [{ id: 'token', label: 'Token (optional — or sign in)', placeholder: 'github_pat_…', secret: true }], signIn: 'github',
		test: async v => { const u = await j('https://api.github.com/user', { headers: { authorization: `Bearer ${v.token}`, 'user-agent': 'Axiora-Code' } }); return `Signed in as ${u.login}`; } },
];
const svc = (id: string) => SERVICES.find(s => s.id === id)!;
async function values(s: Service): Promise<Record<string, string>> {
	const v: Record<string, string> = {};
	for (const f of s.fields) { v[f.id] = f.secret ? (await ctx.secrets.get(s.secret)) ?? '' : f.setting ? conf().get<string>(f.setting, '') : ''; }
	return v;
}
async function connected(s: Service) { return !!(await ctx.secrets.get(s.secret)); }
async function connect(id: string, input: Record<string, string>): Promise<{ ok: boolean; status: string }> {
	const s = svc(id);
	if (s.id === 'github' && !input.token) { const sess = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true }); await ctx.secrets.store(s.secret, sess.accessToken); return test(id); }
	if (s.signIn && !s.fields.length) { await vscode.commands.executeCommand(s.signIn); return { ok: await connected(s), status: await connected(s) ? '✅ Signed in' : 'Not signed in' }; }
	for (const f of s.fields) { if (!input[f.id]?.trim() && !(f.setting && conf().get(f.setting))) { return { ok: false, status: `${f.label} is required.` }; } }
	for (const f of s.fields) { const v = input[f.id]?.trim(); if (!v) { continue; } if (f.secret) { await ctx.secrets.store(s.secret, v); } else if (f.setting) { await conf().update(f.setting, v, G); } }
	return test(id);
}
async function test(id: string): Promise<{ ok: boolean; status: string }> {
	const s = svc(id); if (!await connected(s)) { return { ok: false, status: 'Not connected' }; }
	try { return { ok: true, status: `✅ ${await s.test(await values(s))}` }; } catch (e) { return { ok: false, status: `❌ ${(e as Error).message}` }; }
}
async function disconnect(id: string) { await ctx.secrets.delete(svc(id).secret); return { ok: false, status: 'Disconnected' }; }

// ---------------------------------------------------------------- team file
interface Team { services?: Record<string, Record<string, string>>; ai?: { provider?: string; baseUrl?: string; chatModel?: string; completionModel?: string; approvedModels?: string[] }; approval?: { mode?: string }; policy?: { url?: string }; required?: string[] }
let team: Team | undefined;
const teamUri = () => vscode.workspace.workspaceFolders?.[0] && vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.axiora', 'team.json');
const W = vscode.ConfigurationTarget.Workspace;
async function applyTeam(show = false): Promise<string[]> {
	const u = teamUri(); if (!u) { return []; }
	try { team = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(u))); } catch { team = undefined; if (show) { vscode.window.showInformationMessage('No .axiora/team.json in this workspace. Run "Axiora: Create Team File" to start one.'); } return []; }
	const t = team!; const c = conf(); const done: string[] = [];
	const set = async (k: string, v: unknown) => { if (v !== undefined && JSON.stringify(c.inspect(k)?.workspaceValue) !== JSON.stringify(v)) { await c.update(k, v, W); done.push(k); } };
	const MAP: Record<string, Record<string, string>> = { jira: { site: 'connectors.jira.site' }, github: { repo: 'github.repo', apiUrl: 'github.apiUrl' }, google: { clientId: 'google.clientId' }, mcp: { port: 'mcpServer.port' } };
	for (const [sid, fields] of Object.entries(t.services ?? {})) { for (const [f, v] of Object.entries(fields)) { const k = MAP[sid]?.[f]; if (k) { await set(k, v); } } }
	if (t.ai) {
		await set('ai.provider', t.ai.provider); await set('ai.baseUrl', t.ai.baseUrl);
		const ok = t.ai.approvedModels; const cur = c.get<string>('ai.chatModel', '');
		await set('ai.chatModel', t.ai.chatModel ?? (ok?.length && !ok.includes(cur) ? ok[0] : undefined));
		await set('inlineCompletion.model', t.ai.completionModel);
	}
	await set('approval.mode', t.approval?.mode); await set('policy.url', t.policy?.url);
	const missing = await missingServices();
	if (show || done.length) { vscode.window.showInformationMessage(`Team settings applied (${done.length} changed).${missing.length ? ` Your personal keys still missing: ${missing.join(', ')}.` : ''}`, ...(missing.length ? ['Connect...'] : [])).then(a => a && vscode.commands.executeCommand('axiora.services.open')); }
	changed.fire(); return done;
}
async function missingServices() { const r: string[] = []; for (const id of team?.required ?? []) { const s = SERVICES.find(x => x.id === id); if (s && !await connected(s)) { r.push(s.name); } } return r; }

// ---------------------------------------------------------------- settings rows (core renderer calls these)
type Desc = { status: string; ok?: boolean; input?: boolean; placeholder?: string; buttons: { label: string; action: string; secondary?: boolean }[] };
const ROW: Record<string, string> = { 'axiora.connectors.jira.token': 'jira', 'axiora.connectors.figma.token': 'figma', 'axiora.connectors.slack.token': 'slack', 'axiora.connectors.linear.token': 'linear', 'axiora.connectors.stripe.token': 'stripe', 'axiora.github.token': 'github', 'axiora.google.account': 'google' };
async function describe(key: string, status?: { ok: boolean; status: string }): Promise<Desc> {
	if (key === 'axiora.ai.apiKey') {
		const has = !!await ctx.secrets.get('axiora.ai.apiKey');
		const s = status ?? (state.ready ? { ok: true, status: `✅ Assistant ready — ${state.label}` } : { ok: false, status: has ? `Key saved — ${state.label}` : 'No AI configured yet. Paste one key below.' });
		return { ...s, input: true, placeholder: has ? 'Paste a new key to replace the saved one' : 'sk-or-…, gsk_…, AIza…, sk-ant-… or sk-…', buttons: [{ label: 'Save & Test', action: 'save' }, ...(has ? [{ label: 'Test', action: 'test', secondary: true }, { label: 'Remove', action: 'remove', secondary: true }] : []), { label: 'Use Ollama on My Computer', action: 'ollama', secondary: true }, { label: 'Get a Free Key', action: 'free', secondary: true }] };
	}
	const s = svc(ROW[key]); const on = await connected(s);
	const st = status ?? { ok: on, status: on ? '✅ Connected' : (team?.required?.includes(s.id) ? '⚠️ Required by your team — not connected yet' : 'Not connected') };
	if (s.id === 'google') { return { ...st, input: false, buttons: on ? [{ label: 'Disconnect', action: 'remove', secondary: true }] : [{ label: 'Sign In with Google', action: 'signin' }] }; }
	const extra = s.fields.length > 1 ? [{ label: 'Connect...', action: 'form', secondary: true }] : [];
	return { ...st, input: true, placeholder: on ? 'Paste a new token to replace the saved one' : s.fields.find(f => f.secret)!.placeholder, buttons: [{ label: 'Save', action: 'save' }, ...(s.id === 'github' ? [{ label: 'Sign In with GitHub', action: 'signin', secondary: true }] : []), ...extra, ...(on ? [{ label: 'Test', action: 'test', secondary: true }, { label: 'Disconnect', action: 'remove', secondary: true }] : [])] };
}
async function rowAction(key: string, action: string, value: string): Promise<Desc> {
	if (key === 'axiora.ai.apiKey') {
		let r: { ok: boolean; status: string } | undefined;
		if (action === 'save') { r = await setUpWithKey(value); }
		if (action === 'ollama') { r = await useOllama(); }
		if (action === 'free') { await vscode.commands.executeCommand('axiora.ai.getFreeKey'); }
		if (action === 'remove') { await ctx.secrets.delete('axiora.ai.apiKey'); await refreshState(); r = { ok: false, status: 'Key removed.' }; }
		if (action === 'test') { const c = conf(); try { await ping(c.get('ai.baseUrl', ''), await ctx.secrets.get('axiora.ai.apiKey'), c.get('ai.chatModel', '')); await setReady(true, state.label); r = { ok: true, status: `✅ Connection OK — ${state.label}` }; } catch (e) { const m = (e as Error).message; r = { ok: false, status: `${/rate-limiting|daily limit/.test(m) ? '⚠️ The key is valid, but' : '❌'} ${m}` }; } }
		return describe(key, r);
	}
	const id = ROW[key]; let r: { ok: boolean; status: string } | undefined;
	if (action === 'save') { r = await connect(id, value ? { token: value } : {}); }
	if (action === 'signin') { r = await connect(id, {}); }
	if (action === 'form') { r = await connectForm(id); }
	if (action === 'test') { r = await test(id); }
	if (action === 'remove') { r = await disconnect(id); }
	changed.fire();
	return describe(key, r);
}
async function connectForm(id: string) {
	const s = svc(id); const v: Record<string, string> = {};
	for (const f of s.fields) { const x = await vscode.window.showInputBox({ title: `Connect ${s.name}`, prompt: f.label, placeHolder: f.placeholder, password: !!f.secret, ignoreFocusOut: true, value: f.setting ? conf().get<string>(f.setting, '') : '' }); if (x === undefined) { return { ok: false, status: 'Cancelled' }; } v[f.id] = x; }
	return connect(id, v);
}

// ---------------------------------------------------------------- Connected Services page
let panel: vscode.WebviewPanel | undefined;
async function servicesModel() {
	const missing = await missingServices();
	return { ai: { ready: state.ready, label: state.label }, team: !!team, missing, services: await Promise.all(SERVICES.map(async s => ({ id: s.id, name: s.name, blurb: s.blurb, connected: await connected(s), required: !!team?.required?.includes(s.id), signIn: !!s.signIn, fields: s.fields.map(f => ({ id: f.id, label: f.label, placeholder: f.placeholder, secret: !!f.secret, value: f.setting ? conf().get<string>(f.setting, '') : '' })) }))) };
}
function openServices() {
	if (panel) { panel.reveal(); return; }
	panel = vscode.window.createWebviewPanel('axiora.services', 'Connected Services', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.onDidDispose(() => panel = undefined);
	const post = async (extra?: object) => panel?.webview.postMessage({ type: 'model', model: await servicesModel(), ...extra });
	const sub = changed.event(() => post()); panel.onDidDispose(() => sub.dispose());
	panel.webview.onDidReceiveMessage(async m => {
		let r: { ok: boolean; status: string } | undefined;
		if (m.type === 'ready') { await post(); return; }
		if (m.type === 'connect') { r = await connect(m.id, m.values ?? {}).catch(e => ({ ok: false, status: `❌ ${(e as Error).message}` })); }
		if (m.type === 'signin') { r = await connect(m.id, {}).catch(e => ({ ok: false, status: `❌ ${(e as Error).message}` })); }
		if (m.type === 'test') { r = await test(m.id); }
		if (m.type === 'disconnect') { r = await disconnect(m.id); }
		if (m.type === 'ai') { r = m.action === 'ollama' ? await useOllama() : await setUpWithKey(m.key ?? ''); }
		if (m.type === 'cmd') { await vscode.commands.executeCommand(m.command); return; }
		post({ result: { id: m.id ?? 'ai', ...r } });
	});
	const nonce = Math.random().toString(36).slice(2);
	panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:28px 40px;max-width:1040px;margin:0 auto}
h1{font-size:22px;font-weight:600;margin:0 0 4px}.sub{color:var(--vscode-descriptionForeground);margin:0 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:6px;padding:14px 16px;background:var(--vscode-editorWidget-background);display:flex;flex-direction:column;gap:8px}
.card.ai{margin-bottom:18px}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.name{font-weight:600;font-size:14px}.blurb,.hint{color:var(--vscode-descriptionForeground);font-size:12px}
.pill{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--vscode-widget-border,#555);color:var(--vscode-descriptionForeground)}
.pill.on{color:var(--vscode-testing-iconPassed,#73c991);border-color:currentColor}.pill.req{color:var(--vscode-editorWarning-foreground);border-color:currentColor}
label{font-size:12px;color:var(--vscode-descriptionForeground)}input{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:4px 6px;border-radius:2px;font-family:inherit}
input:focus{outline:1px solid var(--vscode-focusBorder)}.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit}button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}
.status{font-size:12px;min-height:16px}.status.ok{color:var(--vscode-testing-iconPassed,#73c991)}.status.err{color:var(--vscode-errorForeground)}
.banner{border-left:3px solid var(--vscode-editorWarning-foreground);padding:6px 10px;margin-bottom:16px;background:var(--vscode-textBlockQuote-background)}
</style></head><body><h1>Connected Services</h1><p class="sub">Only an AI key is needed — everything else is optional. Keys stay in your OS keychain.</p><div id="root"></div>
<script nonce="${nonce}">
const vs=acquireVsCodeApi();let M,R={};const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function st(id){const r=R[id];return r?'<div class="status '+(r.ok?'ok':'err')+'">'+esc(r.status)+'</div>':'<div class="status"></div>'}
function render(){const a=M.ai;let h='';
if(M.missing.length)h+='<div class="banner">Your team uses '+esc(M.missing.join(', '))+' — connect your personal key'+(M.missing.length>1?'s':'')+' below.</div>';
h+='<div class="card ai"><div class="row"><span class="name">AI Assistant</span><span class="pill '+(a.ready?'on':'')+'">'+(a.ready?'Ready':'Not set up')+'</span></div><div class="blurb">'+(a.ready?esc(a.label):'Paste one key — the provider is detected automatically (OpenRouter, Groq, Gemini, Anthropic, OpenAI).')+'</div>'
+'<input id="aikey" type="password" autocomplete="off" placeholder="'+(a.ready?'Paste a new key to switch provider':'sk-or-…, gsk_…, AIza…, sk-ant-… or sk-…')+'"><div class="btns"><button data-ai="key">Save &amp; Test</button><button class="sec" data-ai="ollama">Use Ollama on My Computer</button><button class="sec" data-cmd="axiora.ai.getFreeKey">Get a Free Key</button></div>'+st('ai')+'</div><div class="grid">';
for(const s of M.services){h+='<div class="card"><div class="row"><span class="name">'+esc(s.name)+'</span><span class="pill '+(s.connected?'on':s.required?'req':'')+'">'+(s.connected?'Connected':s.required?'Team: needed':'Not connected')+'</span></div><div class="blurb">'+esc(s.blurb)+'</div>';
if(s.connected){h+='<div class="btns"><button class="sec" data-test="'+s.id+'">Test</button><button class="sec" data-dis="'+s.id+'">Disconnect</button></div>'}
else if(s.open){for(const f of s.fields)h+='<label>'+esc(f.label)+'</label><input data-f="'+s.id+'.'+f.id+'" type="'+(f.secret?'password':'text')+'" autocomplete="off" placeholder="'+esc(f.placeholder)+'" value="'+(f.secret?'':esc(f.value))+'">';
h+='<div class="btns">'+(s.fields.length?'<button data-save="'+s.id+'">Connect</button>':'')+(s.signIn?'<button class="'+(s.fields.length?'sec':'')+'" data-sign="'+s.id+'">Sign In with '+esc(s.name)+'</button>':'')+'<button class="sec" data-close="'+s.id+'">Cancel</button></div>'}
else h+='<div class="btns"><button data-open="'+s.id+'">Connect</button></div>';
h+=st(s.id)+'</div>'}
$('#root').innerHTML=h+'</div>'}
const open=new Set();
window.addEventListener('message',e=>{const m=e.data;if(m.type!=='model')return;if(m.result){R[m.result.id]=m.result;if(m.result.ok)open.delete(m.result.id)}M=m.model;M.services.forEach(s=>s.open=open.has(s.id));render()});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
if(d.open){open.add(d.open);M.services.find(s=>s.id===d.open).open=true;render();const i=document.querySelector('[data-f^="'+d.open+'."]');i&&i.focus();return}
if(d.close){open.delete(d.close);M.services.find(s=>s.id===d.close).open=false;render();return}
if(d.cmd)return vs.postMessage({type:'cmd',command:d.cmd});
const busy=id=>{R[id]={ok:true,status:'Working…'};render()};
if(d.ai){const k=$('#aikey').value;busy('ai');vs.postMessage({type:'ai',action:d.ai,key:k})}
if(d.save){const v={};document.querySelectorAll('[data-f^="'+d.save+'."]').forEach(i=>v[i.dataset.f.split('.')[1]]=i.value);busy(d.save);vs.postMessage({type:'connect',id:d.save,values:v})}
if(d.sign){busy(d.sign);vs.postMessage({type:'signin',id:d.sign})}
if(d.test){busy(d.test);vs.postMessage({type:'test',id:d.test})}
if(d.dis){vs.postMessage({type:'disconnect',id:d.dis})}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){const c=e.target.closest('.card');c&&c.querySelector('button').click()}});
vs.postMessage({type:'ready'});
</script></body></html>`;
}

// ---------------------------------------------------------------- palette flow
async function setupFlow() {
	const p = await vscode.window.showQuickPick([
		{ label: '$(key) Paste an API key...', description: 'OpenRouter, Groq, Gemini, Anthropic or OpenAI — detected automatically', id: 'key' },
		{ label: '$(device-desktop) Use Ollama on my computer', description: 'Private and free; needs Ollama running', id: 'ollama' },
		{ label: '$(link-external) Get a free key', description: 'Opens OpenRouter — free models, no card needed', id: 'free' },
		{ label: '$(plug) Connected Services...', description: 'Jira, Figma, Slack, Linear, Stripe, Google, GitHub (optional)', id: 'svc' },
	], { title: 'Set Up AI', placeHolder: state.ready ? `Assistant ready — ${state.label}` : 'One key is all you need' });
	if (!p) { return; }
	if (p.id === 'free') { await vscode.commands.executeCommand('axiora.ai.getFreeKey'); return; }
	if (p.id === 'svc') { openServices(); return; }
	const r = p.id === 'ollama' ? await useOllama() : await (async () => {
		const k = await vscode.window.showInputBox({ title: 'Set Up AI', prompt: 'Paste your API key — stored in the OS keychain', password: true, ignoreFocusOut: true, placeHolder: 'sk-or-…, gsk_…, AIza…, sk-ant-… or sk-…',
			validateInput: v => !v.trim() ? undefined : detectProvider(v) ? { message: `Detected: ${detectProvider(v)!.label}`, severity: vscode.InputBoxValidationSeverity.Info } : 'Unknown key format' });
		return k ? vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Axiora: testing your key…' }, () => setUpWithKey(k)) : undefined;
	})();
	if (r) { (r.ok ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(r.status, ...(r.ok ? ['Open Chat'] : ['Try Again'])).then(a => a === 'Open Chat' ? vscode.commands.executeCommand('workbench.action.chat.open') : a && setupFlow()); }
}

export function activate(c: vscode.ExtensionContext) {
	ctx = c;
	bar = vscode.window.createStatusBarItem('axiora.aiSetup', vscode.StatusBarAlignment.Right, 1000); bar.name = 'Axiora AI Setup'; bar.command = 'axiora.ai.setup';
	bar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	c.subscriptions.push(bar, changed);
	register(c, 'axiora.ai.setup', setupFlow);
	register(c, 'axiora.ai.getFreeKey', () => vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/settings/keys')));
	register(c, 'axiora.ai.useOllama', async () => { const r = await useOllama(); vscode.window.showInformationMessage(r.status); });
	register(c, 'axiora.services.open', openServices);
	register(c, 'axiora.team.apply', () => applyTeam(true));
	register(c, 'axiora.team.create', async () => {
		const u = teamUri(); if (!u) { vscode.window.showWarningMessage('Open a folder first.'); return; }
		try { await vscode.workspace.fs.stat(u); } catch {
			const cur = conf();
			await vscode.workspace.fs.writeFile(u, new TextEncoder().encode(JSON.stringify({ $comment: 'Shared team settings — no secrets here. Everyone adds their own keys in Connected Services.', services: { jira: { site: cur.get('connectors.jira.site') || 'https://acme.atlassian.net' }, github: { repo: cur.get('github.repo') || 'org/repo' } }, ai: { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', approvedModels: OPENROUTER_FREE.slice(0, 2) }, approval: { mode: cur.get('approval.mode') }, policy: { url: cur.get('policy.url') || '' }, required: ['jira', 'github'] }, null, 2) + '\n'));
		}
		await vscode.window.showTextDocument(u);
	});
	// Settings › AI Models › AI Key and Settings › Integrations › <service> › Connection rows
	c.subscriptions.push(vscode.commands.registerCommand('axiora.secret.describe', (key: string) => describe(key)));
	c.subscriptions.push(vscode.commands.registerCommand('axiora.secret.action', (key: string, action: string, value: string) => rowAction(key, action, value ?? '')));
	c.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('axiora.ai')) { refreshState(); } }));
	c.subscriptions.push(c.secrets.onDidChange(e => { if (e.key === 'axiora.ai.apiKey') { refreshState(); } changed.fire(); }));
	const w = vscode.workspace.createFileSystemWatcher('**/.axiora/team.json'); c.subscriptions.push(w, w.onDidChange(() => applyTeam()), w.onDidCreate(() => applyTeam()));
	refreshState().then(() => applyTeam());
}
