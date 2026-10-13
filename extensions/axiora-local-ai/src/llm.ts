/*---------------------------------------------------------------------------------------------
 *  Axiora Local AI - minimal model client (Ollama native API or OpenAI-compatible).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

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
	return h;
}

/** Fill-in-the-middle completion. */
export async function complete(prefix: string, suffix: string, model: string, maxTokens: number, signal: AbortSignal): Promise<string> {
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
	const r = await fetch(`${baseUrl}/completions`, {
		method: 'POST', headers: await headers(), signal,
		body: JSON.stringify({ model, prompt: prefix, suffix, max_tokens: maxTokens, temperature: 0.1 })
	});
	if (!r.ok) { throw new Error(`Provider ${r.status}: ${await r.text()}`); }
	const res = ((await r.json()) as { choices?: { text?: string }[] }).choices?.[0]?.text ?? '';
	track(model, prefix + suffix, res);
	return res;
}

/** Streaming chat. Calls onChunk for every text delta, returns full text. */
export async function chat(messages: ChatMessage[], onChunk: (s: string) => void, token?: vscode.CancellationToken, model?: string): Promise<string> {
	const { provider, baseUrl } = cfg();
	const chatModel = model || cfg().chatModel;
	const ac = new AbortController();
	token?.onCancellationRequested(() => ac.abort());
	const url = provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
	const r = await fetch(url, { method: 'POST', headers: await headers(), signal: ac.signal, body: JSON.stringify({ model: chatModel, messages, stream: true }) });
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
				const t: string = provider === 'ollama' ? (j.message?.content ?? '') : (j.choices?.[0]?.delta?.content ?? '');
				if (t) { full += t; onChunk(t); }
			} catch { /* partial line */ }
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
