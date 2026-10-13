/*---------------------------------------------------------------------------------------------
 *  Web page fetch + readable-text extraction (no deps).
 *--------------------------------------------------------------------------------------------*/
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);

/** Turn HTML into readable markdown-ish text: drops scripts/nav/boilerplate, prefers <article>/<main>. */
export function readable(html: string, base?: string): { title: string; text: string; links: { text: string; url: string }[] } {
	const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim());
	let h = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|iframe|template|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
	const pick = (tag: string) => { const all = [...h.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(m => m[1]); return all.sort((a, b) => b.length - a.length)[0]; };
	const main = pick('article') ?? pick('main') ?? (/<body[^>]*>([\s\S]*)<\/body>/i.exec(h)?.[1] ?? h);
	h = (main.length > 500 ? main : h).replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
	const links: { text: string; url: string }[] = [];
	h = h.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, u: string, t: string) => { const tx = decode(t.replace(/<[^>]+>/g, '')).trim(); try { if (tx && links.length < 40) { links.push({ text: tx.slice(0, 80), url: new URL(decode(u), base).href }); } } catch { /* */ } return tx; });
	const text = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n\n${'#'.repeat(+n)} ${t}\n`)
		.replace(/<li[^>]*>/gi, '\n- ').replace(/<(p|div|section|br|tr|table|blockquote|pre)\b[^>]*>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ')
		.replace(/<[^>]+>/g, '').split('\n').map(l => decode(l).replace(/[ \t\u00a0]+/g, ' ').trim()).filter((l, i, a) => l || a[i - 1]).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	return { title, text, links };
}
export async function fetchPage(url: string, maxChars = 12000): Promise<{ url: string; title: string; text: string; links: { text: string; url: string }[] }> {
	if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
	const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 Axiora', accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
	if (!r.ok) { throw new Error(`HTTP ${r.status} for ${url}`); }
	const ct = r.headers.get('content-type') ?? ''; const raw = (await r.text()).slice(0, 3_000_000);
	if (!/html/i.test(ct)) { return { url: r.url, title: url, text: raw.slice(0, maxChars), links: [] }; }
	const x = readable(raw, r.url); return { url: r.url, ...x, text: x.text.slice(0, maxChars) };
}
