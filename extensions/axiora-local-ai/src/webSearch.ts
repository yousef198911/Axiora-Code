/*---------------------------------------------------------------------------------------------
 *  @axiora /web - web search (DuckDuckGo HTML, no key) summarized by the local model.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chat } from './llm';
import { chatCommands, SYS } from './util';

export async function webSearch(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
	const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'Mozilla/5.0 Axiora' }, signal: AbortSignal.timeout(10000) });
	const html = await r.text();
	const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, '\'').trim();
	const out: { title: string; url: string; snippet: string }[] = [];
	const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) && out.length < 6) {
		let url = m[1]; const u = /uddg=([^&]+)/.exec(url); if (u) { url = decodeURIComponent(u[1]); }
		out.push({ url, title: strip(m[2]), snippet: strip(m[3]) });
	}
	return out;
}
export function activate(_ctx: vscode.ExtensionContext) {
	chatCommands.set('web', async (req, stream, token) => {
		stream.progress('Searching the web…');
		const res = await webSearch(req.prompt);
		if (!res.length) { stream.markdown('No web results (network blocked or no matches).'); return; }
		const ctx = res.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n');
		await chat([{ role: 'system', content: SYS }, { role: 'user', content: `Answer using these web results, cite as [n].\n\n${ctx}\n\nQuestion: ${req.prompt}` }], s => stream.markdown(s), token);
		stream.markdown('\n\n' + res.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join('\n'));
	});
}
