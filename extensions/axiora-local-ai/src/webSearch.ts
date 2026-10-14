/*---------------------------------------------------------------------------------------------
 *  @axiora /web - web search (DuckDuckGo HTML, no key) summarized by the local model.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { chat } from './llm';
import { chatCommands, SYS } from './util';
import { fetchPage } from './web';

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
		stream.progress(vscode.l10n.t("Searching the web…"));
		const res = await webSearch(req.prompt);
		if (!res.length) { stream.markdown(vscode.l10n.t("No web results (network blocked or no matches).")); return; }
		const n = vscode.workspace.getConfiguration('axiora.web').get<number>('readPages', 3);
		stream.progress(vscode.l10n.t("Reading top {0} pages…", Math.min(n, res.length)));
		const pages = await Promise.all(res.slice(0, n).map(r => fetchPage(r.url, 6000).then(p => p.text, () => '')));
		const ctx = res.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${pages[i] ? `Page text:\n${pages[i]}` : `Snippet: ${r.snippet}`}`).join('\n\n---\n\n');
		stream.markdown(vscode.l10n.t("_Read {0} of {1} result pages._\n\n", pages.filter(Boolean).length, res.length));
		await chat([{ role: 'system', content: SYS }, { role: 'user', content: `Answer using these web results (full page text where available), cite as [n].\n\n${ctx}\n\nQuestion: ${req.prompt}` }], s => stream.markdown(s), token);
		stream.markdown('\n\n' + res.map((r, i) => `${i + 1}. [${r.title}](${r.url})${pages[i] ? ' · read' : ''}`).join('\n'));
	});
}
