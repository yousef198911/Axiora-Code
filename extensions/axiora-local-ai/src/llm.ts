/*---------------------------------------------------------------------------------------------
 *  Axiora Local AI - minimal model client (Ollama native API or OpenAI-compatible).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; /** base64 PNG/JPEG for vision models */ images?: string[] }
/** Provider-specific message shape (images: Ollama native field / OpenAI content parts). */
export function wireMessages(messages: ChatMessage[], provider: string) {
	return messages.map(m => !m.images?.length ? { role: m.role, content: m.content } : provider === 'ollama' ? { role: m.role, content: m.content, images: m.images } : { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map(b => ({ type: 'image_url', image_url: { url: `data:image/${b.startsWith('/9j') ? 'jpeg' : 'png'};base64,${b}` } }))] });
}

let secrets: vscode.SecretStorage | undefined;
/** Approximate token usage per model (chars/4), for the usage report. */
export const usage = new Map<string, { input: number; output: number; requests: number }>();
function track(model: string, input: string, output: string) {
	const u = usage.get(model) ?? { input: 0, output: 0, requests: 0 };
	u.input += Math.ceil(input.length / 4); u.output += Math.ceil(output.length / 4); u.requests++;
	usage.set(model, u);
}
export function initLlm(s: vscode.SecretStorage) { secrets = s; }

function cfg() {
	const c = vscode.workspace.getConfiguration('axiora');
	return {
		provider: c.get<string>('ai.provider', 'ollama'),
		baseUrl: c.get<string>('ai.baseUrl', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
		chatModel: c.get<string>('ai.chatModel', 'qwen2.5-coder:0.5b'),
	};
}

async function headers(): Promise<Record<string, string>> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	const key = await secrets?.get('axiora.ai.apiKey');
	if (key) { h['authorization'] = `Bearer ${key}`; }
	if (cfg().baseUrl.includes('openrouter.ai')) { h['x-title'] = 'Axiora Code'; h['http-referer'] = 'https://github.com/yousef198911/Axiora-Code'; }
	return h;
}

/** Outbound filters (e.g. context policy) applied to every request before it leaves the editor. */
export const outboundFilters: ((m: ChatMessage[]) => ChatMessage[])[] = [];
const filtered = (m: ChatMessage[]) => outboundFilters.reduce((a, f) => f(a), m);
/** Fill-in-the-middle completion. */
export async function complete(prefix: string, suffix: string, model: string, maxTokens: number, signal: AbortSignal): Promise<string> {
	if (outboundFilters.length) { const f = filtered([{ role: 'user', content: prefix }, { role: 'user', content: suffix }]); prefix = f[0].content; suffix = f[1].content; }
	const { provider, baseUrl } = cfg();
	if (provider === 'ollama') {
		const r = await fetch(`${baseUrl}/api/generate`, {
			method: 'POST', headers: await headers(), signal,
			body: JSON.stringify({ model, prompt: prefix, suffix, stream: false, raw: false, options: { num_predict: maxTokens, temperature: 0.1, stop: ['\n\n\n'] } })
		});
		if (!r.ok) { throw new Error(`Ollama ${r.status}: ${await r.text()}`); }
		const res = ((await r.json()) as { response?: string }).response ?? '';
		track(model, prefix + suffix, res);
		return res;
	}
	let res = '';
	const r = await fetch(`${baseUrl}/completions`, {
		method: 'POST', headers: await headers(), signal,
		body: JSON.stringify({ model, prompt: prefix, suffix, max_tokens: maxTokens, temperature: 0.1 })
	});
	if (r.ok) { res = ((await r.json()) as { choices?: { text?: string }[] }).choices?.[0]?.text ?? ''; }
	else if (r.status !== 404 && r.status !== 400) { throw new Error(`Provider ${r.status}: ${await r.text()}`); }
	if (!res.trim()) {
		// Chat-only / reasoning models (common on OpenRouter) return no text from /completions: fall back to a chat FIM prompt.
		const c = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST', headers: await headers(), signal,
			body: JSON.stringify({ model, temperature: 0.1, max_tokens: Math.max(maxTokens * 8, 512), reasoning: { enabled: false }, messages: [
				{ role: 'system', content: 'You are a code completion engine. Output ONLY the code that belongs at <CURSOR> (no explanations, no markdown fences, do not repeat the code before or after the cursor).' },
				{ role: 'user', content: `${prefix.slice(-6000)}<CURSOR>${suffix.slice(0, 2000)}` }] })
		});
		if (!c.ok) { throw new Error(`Provider ${c.status}: ${await c.text()}`); }
		res = (((await c.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '').replace(/^```\w*\n?|\n?```\s*$/g, '');
		// chat models often echo the current line; drop the overlap with the text before the cursor
		const cur = prefix.slice(prefix.lastIndexOf('\n') + 1).trim(); const t = res.trimStart();
		let k = 0; while (k < cur.length && k < t.length && cur[k] === t[k]) { k++; }
		if (cur && k >= Math.ceil(cur.length * 0.6)) { res = (prefix.endsWith(' ') && t[k] === ' ' ? t.slice(k + 1) : t.slice(k)); }
		const lines = res.split('\n'); if (lines.length > 12) { res = lines.slice(0, 12).join('\n'); }
	}
	track(model, prefix + suffix, res);
	return res;
}

/** Adaptive model router: small model for short/simple requests, large model for complex ones. */
export function route(messages: ChatMessage[]): string | undefined {
	const r = vscode.workspace.getConfiguration('axiora.ai.router');
	if (!r.get('enabled', false)) { return undefined; }
	const small = r.get<string>('smallModel', ''), large = r.get<string>('largeModel', '');
	if (!small || !large) { return undefined; }
	const last = messages[messages.length - 1]?.content ?? '';
	const total = messages.filter(m => m.role !== 'system').reduce((n, m) => n + m.content.length, 0); // conversation size, not injected context
	const hard = /\b(refactor|architect|design|debug|why|prove|optimi[sz]e|security|migrat|plan|spec|review|complex)\w*/i.test(last) || /```/.test(last);
	const pick = total > r.get<number>('threshold', 4000) || hard ? large : small;
	routed = pick; return pick;
}
export let routed = '';
/** Streaming chat. Calls onChunk for every text delta, returns full text. */
export async function chat(messages: ChatMessage[], onChunk: (s: string) => void, token?: vscode.CancellationToken, model?: string): Promise<string> {
	messages = filtered(messages);
	const { provider, baseUrl } = cfg();
	const chatModel = model || route(messages) || cfg().chatModel;
	const ac = new AbortController();
	token?.onCancellationRequested(() => ac.abort());
	const url = provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
	const r = await fetch(url, { method: 'POST', headers: await headers(), signal: ac.signal, body: JSON.stringify({ model: chatModel, messages: wireMessages(messages, provider), stream: true }) });
	if (!r.ok || !r.body) { throw new Error(`${provider} ${r.status}: ${await r.text()}`); }
	const dec = new TextDecoder();
	let buf = '', full = '';
	for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
		buf += dec.decode(part, { stream: true });
		let i: number;
		while ((i = buf.indexOf('\n')) >= 0) {
			let line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
			if (!line) { continue; }
			if (line.startsWith('data:')) { line = line.slice(5).trim(); }
			if (line === '[DONE]') { continue; }
			try {
				const j = JSON.parse(line);
				if (j.error) { throw new Error(`${provider}: ${j.error.message ?? JSON.stringify(j.error)}`); }
				const t: string = provider === 'ollama' ? (j.message?.content ?? '') : (j.choices?.[0]?.delta?.content ?? '');
				if (t) { full += t; onChunk(t); }
			} catch (e) { if (/^(ollama|openai):/.test((e as Error).message)) { throw e; } /* partial line */ }
		}
	}
	track(chatModel, messages.map(m => m.content).join(''), full);
	return full;
}

/** Models available on the provider (falls back to the configured chat model). */
export async function listModels(): Promise<string[]> {
	const { provider, baseUrl, chatModel } = cfg();
	const names = new Set<string>([chatModel]);
	try {
		const r = await fetch(provider === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`, { headers: await headers(), signal: AbortSignal.timeout(3000) });
		const j = await r.json() as { models?: { name: string }[]; data?: { id: string }[] };
		for (const m of j.models ?? []) { names.add(m.name); }
		for (const m of j.data ?? []) { names.add(m.id); }
	} catch { /* offline */ }
	return [...names];
}

/** Provider endpoint + auth headers for non-chat calls (images, audio, TTS). */
export async function aiEndpoint() { return { ...cfg(), headers: await headers() }; }

/** One non-streaming OpenAI-style call with native function calling. Returns content + tool_calls. */
export async function chatTools(wire: any[], tools: { name: string; description: string; parameters: unknown }[], token?: vscode.CancellationToken, model?: string): Promise<{ content: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }> {
	const { baseUrl } = cfg(); const chatModel = model || cfg().chatModel;
	const ac = new AbortController(); token?.onCancellationRequested(() => ac.abort());
	const r = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: await headers(), signal: ac.signal, body: JSON.stringify({ model: chatModel, messages: wire, tools: tools.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' }) });
	const t = await r.text(); if (!r.ok) { throw Object.assign(new Error(`Provider ${r.status}: ${t.slice(0, 300)}`), { status: r.status }); }
	const j = JSON.parse(t); if (j.error) { throw new Error(`Provider: ${j.error.message ?? JSON.stringify(j.error)}`); }
	const m = j.choices?.[0]?.message ?? {}; track(chatModel, JSON.stringify(wire).slice(0, 20000), m.content ?? '');
	return { content: m.content ?? '', tool_calls: m.tool_calls?.length ? m.tool_calls : undefined };
}
export function providerKind() { return cfg().provider; }
export function applyFilters(m: ChatMessage[]) { return filtered(m); }
