/*---------------------------------------------------------------------------------------------
 *  @docs: index external documentation sites locally (fetch pages, strip HTML, chunk, BM25-like
 *  keyword ranking) and answer with citations: "@axiora /docs <question>".
 *  Manage sources with "Docs: Add Documentation Source…" (crawls same-prefix links, max pages).
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { chatCommands, register, SYS } from './util';
import { chat } from './llm';

type Chunk = { url: string; title: string; text: string };
type Index = { name: string; root: string; chunks: Chunk[]; at: string };
export const strip = (h: string) => h.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const words = (s: string) => s.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
export function rank(chunks: Chunk[], q: string, k = 6): Chunk[] {
	const qs = [...new Set(words(q))]; const N = chunks.length || 1;
	const df = new Map<string, number>(); for (const c of chunks) { for (const w of new Set(words(c.text))) { if (qs.includes(w)) { df.set(w, (df.get(w) ?? 0) + 1); } } }
	return chunks.map(c => { const ws = words(c.text); const tf = new Map<string, number>(); ws.forEach(w => tf.set(w, (tf.get(w) ?? 0) + 1)); let s = 0; for (const w of qs) { const f = tf.get(w) ?? 0; if (f) { s += Math.log(1 + N / (df.get(w) ?? 1)) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * ws.length / 200)); } } return { c, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.c);
}
export function activate(ctx: vscode.ExtensionContext) {
	const dir = path.join(ctx.globalStorageUri.fsPath, 'docs'); fs.mkdirSync(dir, { recursive: true });
	const indexes = (): Index[] => fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
	register(ctx, 'axiora.docs.add', async () => {
		const root = await vscode.window.showInputBox({ prompt: 'Documentation URL to index (pages under this prefix are crawled)', placeHolder: 'https://docs.python.org/3/library/asyncio.html' }); if (!root) { return; }
		const name = await vscode.window.showInputBox({ prompt: 'Name', value: new URL(root).hostname }); if (!name) { return; }
		const max = vscode.workspace.getConfiguration('axiora.docs').get<number>('maxPages', 40);
		const prefix = root.replace(/[^/]*$/, ''); const seen = new Set<string>(); const queue = [root]; const chunks: Chunk[] = [];
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Indexing ${name}`, cancellable: true }, async (p, tok) => {
			while (queue.length && seen.size < max && !tok.isCancellationRequested) {
				const u = queue.shift()!; if (seen.has(u)) { continue; } seen.add(u);
				try {
					const r = await fetch(u, { headers: { 'user-agent': 'Axiora-Docs/1.0' } }); if (!r.ok || !/html|text/.test(r.headers.get('content-type') ?? '')) { continue; }
					const html = await r.text(); const title = strip(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? u);
					const text = strip(html); for (let i = 0; i < text.length; i += 1500) { chunks.push({ url: u, title, text: text.slice(i, i + 1700) }); }
					for (const m of html.matchAll(/href="([^"#]+)/g)) { try { const n = new URL(m[1], u).toString(); if (n.startsWith(prefix) && !seen.has(n)) { queue.push(n); } } catch { /* bad url */ } }
					p.report({ message: `${seen.size} pages`, increment: 100 / max });
				} catch { /* skip page */ }
			}
		});
		fs.writeFileSync(path.join(dir, `${name.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify({ name, root, chunks, at: new Date().toISOString() } satisfies Index));
		vscode.window.showInformationMessage(`Indexed ${seen.size} pages (${chunks.length} chunks) for "${name}". Ask with @axiora /docs.`);
	});
	register(ctx, 'axiora.docs.manage', async () => {
		const p = await vscode.window.showQuickPick(indexes().map(i => ({ label: i.name, description: `${i.chunks.length} chunks · ${i.root}`, detail: `indexed ${new Date(i.at).toLocaleString()}` })), { placeHolder: 'Documentation sources (select to remove)', canPickMany: true });
		for (const x of p ?? []) { fs.rmSync(path.join(dir, `${x.label.replace(/[^\w.-]+/g, '_')}.json`), { force: true }); }
	});
	chatCommands.set('docs', async (req, stream, token) => {
		const all = indexes(); if (!all.length) { stream.markdown('No documentation indexed yet. Run **Docs: Add Documentation Source…**.'); stream.button({ title: 'Add Documentation Source', command: 'axiora.docs.add' }); return; }
		const m = /^#(\S+)\s+/.exec(req.prompt); const pool = m ? all.filter(i => i.name.startsWith(m[1])) : all; const q = m ? req.prompt.slice(m[0].length) : req.prompt;
		const top = rank(pool.flatMap(i => i.chunks), q);
		if (!top.length) { stream.markdown('No matching passages in the indexed docs.'); return; }
		const ctxt = top.map((c, i) => `[${i + 1}] ${c.title} (${c.url})\n${c.text}`).join('\n\n');
		await chat([{ role: 'system', content: SYS }, { role: 'user', content: `Answer from these documentation excerpts; cite as [n].\n\n${ctxt}\n\nQuestion: ${q}` }], s => stream.markdown(s), token);
		stream.markdown('\n\n' + [...new Map(top.map(c => [c.url, c])).values()].map((c, i) => `${i + 1}. [${c.title}](${c.url})`).join('\n'));
	});
}
